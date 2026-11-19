/**
 * Read-only client for Deutsche Bahn OpenBoards.
 *
 * This module is intentionally not wired into the production forecast yet.
 * It performs no Turso writes: responses are cached in-process only.
 */

export type OpenBoardsDirection = "arrivals" | "departures";

export type OpenBoardsOptions = {
  /** ISO-8601 timestamp. Defaults to now. */
  timeStart?: string;
  /** Number of via stops requested from DB. */
  maxViaStops?: number;
  /** Maximum board entries per transport type. */
  maxEntriesPerTransportType?: number;
  /** Response language tags. */
  languages?: string[];
  /** Conservative EVA batch size; DB's documented maximum is not specified. */
  batchSize?: number;
};

export type OpenBoardsBatchResult = {
  evaNumbers: string[];
  direction: OpenBoardsDirection;
  data: unknown;
};

const BASE_URL =
  "https://apis.deutschebahn.com/db-api-marketplace/apis/open-boards/v1";
const REQUEST_TIMEOUT_MS = 6_000;
const CACHE_TTL_MS = 20_000;
const DEFAULT_BATCH_SIZE = 5;

// This is a per-runtime guard, not a distributed account-wide limiter.
// The low default rate leaves headroom below the Marketplace limit of 10 req/s.
const MIN_REQUEST_INTERVAL_MS = 125;
let nextRequestAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

const responseCache = new Map<
  string,
  { expiresAt: number; value: unknown }
>();
const MAX_CACHE_ENTRIES = 100;

function pruneResponseCache() {
  const now = Date.now();
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) responseCache.delete(key);
  }
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) break;
    responseCache.delete(oldestKey);
  }
}
const inFlight = new Map<string, Promise<unknown>>();

function credentials() {
  const clientId =
    process.env.DB_OPENBOARDS_CLIENT_ID || process.env.DB_CLIENT_ID;
  const apiKey =
    process.env.DB_OPENBOARDS_API_KEY || process.env.DB_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error(
      "OpenBoards credentials missing. Set DB_OPENBOARDS_CLIENT_ID and DB_OPENBOARDS_API_KEY.",
    );
  }

  return {
    "DB-Client-Id": clientId,
    "DB-Api-Key": apiKey,
  };
}

function acquireRequestSlot(): Promise<void> {
  const slot = requestQueue.then(async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  });

  requestQueue = slot.catch(() => undefined);
  return slot;
}

function uniqueEvas(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => String(value).trim()).filter(Boolean)),
  );
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function cacheKey(
  direction: OpenBoardsDirection,
  evaNumbers: string[],
  body: Record<string, unknown>,
) {
  return JSON.stringify({
    direction,
    evaNumbers: [...evaNumbers].sort(),
    body,
  });
}

export async function fetchOpenBoardsBoard(
  direction: OpenBoardsDirection,
  evaNumbersInput: string[],
  options: Omit<OpenBoardsOptions, "batchSize"> = {},
): Promise<unknown> {
  const evaNumbers = uniqueEvas(evaNumbersInput);
  if (!evaNumbers.length) return null;

  const body = {
    stopPlaceOrStation: { evaNumbers },
    // Stable within the short cache window so simultaneous/repeated callers\n    // share one board request instead of creating a new cache key every ms.\n    timeWindow: {\n      timeStart:\n        options.timeStart ||\n        new Date(Math.floor(Date.now() / CACHE_TTL_MS) * CACHE_TTL_MS).toISOString(),\n    },
    maxViaStops: options.maxViaStops ?? 5,
    maxEntriesPerTransportType: options.maxEntriesPerTransportType ?? 25,
    languages: options.languages ?? ["deu"],
  };

  pruneResponseCache();
  const key = cacheKey(direction, evaNumbers, body);
  const cached = responseCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    await acquireRequestSlot();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${BASE_URL}/${direction}`, {
        method: "POST",
        headers: {
          ...credentials(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(
          `OpenBoards ${direction} failed: HTTP ${response.status} ${response.statusText} - ${responseText.slice(0, 500)}`,
        );
      }

      let data: unknown;
      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        throw new Error("OpenBoards returned invalid JSON.");
      }

      responseCache.set(key, {
        expiresAt: Date.now() + CACHE_TTL_MS,
        value: data,
      });
      return data;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`OpenBoards timeout after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  })();

  inFlight.set(key, request);
  try {
    return await request;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Fetch multiple station boards in conservative EVA batches.
 * The API accepts an EVA-number array; the maximum array size is not stated
 * in the public docs, so the default batch size is deliberately small.
 */
export async function fetchOpenBoardsForStations(
  direction: OpenBoardsDirection,
  evaNumbersInput: string[],
  options: OpenBoardsOptions = {},
): Promise<OpenBoardsBatchResult[]> {
  const evaNumbers = uniqueEvas(evaNumbersInput);
  if (!evaNumbers.length) return [];

  const requestedBatchSize = Number(options.batchSize ?? DEFAULT_BATCH_SIZE);
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.max(1, Math.min(20, Math.floor(requestedBatchSize)))
    : DEFAULT_BATCH_SIZE;

  const { batchSize: _ignored, ...boardOptions } = options;
  const batches = chunks(evaNumbers, batchSize);

  return Promise.all(
    batches.map(async (batch) => ({
      evaNumbers: batch,
      direction,
      data: await fetchOpenBoardsBoard(direction, batch, boardOptions),
    })),
  );
}

/** Clears only this runtime's short-lived OpenBoards response cache. */
export function clearOpenBoardsMemoryCache() {
  responseCache.clear();
}
