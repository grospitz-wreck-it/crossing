const cache = new Map<
  string,
  {
    expires: number;
    value: unknown;
    promise?: Promise<unknown>;
  }
>();

export async function withMemoryCache<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();

  const cached = cache.get(key);

  // Cache-Treffer
  if (
    cached &&
    cached.expires > now &&
    cached.value !== undefined
  ) {
    console.log("[CACHE HIT]", key);

    return cached.value as T;
  }

  // Läuft bereits?
  if (cached?.promise) {
    console.log(
      "[CACHE WAIT]",
      key
    );

    return cached.promise as Promise<T>;
  }

  console.log(
    "[CACHE MISS]",
    key
  );

  const promise = loader();

  cache.set(key, {
    expires: now + ttlMs,
    value: undefined,
    promise,
  });

  try {
    const value = await promise;

    cache.set(key, {
      expires:
        Date.now() + ttlMs,
      value,
    });

    console.log(
      "[CACHE STORE]",
      key
    );

    return value;
  } catch (error) {
    cache.delete(key);

    console.log(
      "[CACHE ERROR]",
      key
    );

    throw error;
  }
}

export function clearMemoryCache() {
  cache.clear();

  console.log(
    "[CACHE CLEARED]"
  );
}