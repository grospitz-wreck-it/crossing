import https from "node:https";

const DEFAULT_BASE_URL = "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription";

export type MobilithekConfig = {
  subscriptionId: string;
  baseUrl: string;
  token?: string;
};

export function getMobilithekConfigs(): MobilithekConfig[] {
  const ids = [
    process.env.MOBILITHEK_SUBSCRIPTION_ID,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_2,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_3,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_4,
    process.env.MOBILITHEK_SUBSCRIPTION_ID_5,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return [...new Set(ids)].map((subscriptionId) => ({
    subscriptionId,
    baseUrl: process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() || DEFAULT_BASE_URL,
    token: process.env.MOBILITHEK_TOKEN?.trim() || undefined,
  }));
}

export function getMobilithekConfig(): MobilithekConfig | null {
  return getMobilithekConfigs()[0] || null;
}

function getP12Options() {
  const base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  if (!base64) return null;

  const pfx = Buffer.from(base64, "base64");
  if (!pfx.length) throw new Error("MOBILITHEK_CLIENT_P12_BASE64 is empty or invalid");

  return {
    pfx,
    passphrase: process.env.MOBILITHEK_P12_PASSWORD || undefined,
  };
}

export async function fetchMobilithekSubscription(
  config: MobilithekConfig,
  options: { signal?: AbortSignal } = {},
) {
  const url = new URL(config.baseUrl);
  url.searchParams.set("subscriptionID", config.subscriptionId);

  const headers: Record<string, string> = {
    accept: "application/json, application/xml, text/plain, */*",
    "user-agent": "Crossings/1.0 (meineschranke.com)",
  };

  if (config.token) {
    headers.authorization = `Bearer ${config.token}`;
  }

  const p12 = getP12Options();

  // Node's fetch/undici does not expose client certificates in the same way as
  // https.request. Use the native HTTPS agent when a PKCS#12 client cert is configured.
  if (p12) {
    return await new Promise<{
      status: number;
      contentType: string;
      body: string;
    }>((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: "GET",
          headers,
          pfx: p12.pfx,
          passphrase: p12.passphrase,
          timeout: 15000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            const body = Buffer.concat(chunks).toString("utf8");
            const status = response.statusCode || 0;
            const contentType = response.headers["content-type"] || "";

            if (status < 200 || status >= 300) {
              reject(new Error(`Mobilithek HTTP ${status}: ${body.slice(0, 500)}`));
              return;
            }

            resolve({ status, contentType, body });
          });
        },
      );

      request.on("timeout", () => request.destroy(new Error("Mobilithek request timed out")));
      request.on("error", reject);

      if (options.signal) {
        const abort = () => request.destroy(new Error("Mobilithek request aborted"));
        if (options.signal.aborted) abort();
        else options.signal.addEventListener("abort", abort, { once: true });
      }

      request.end();
    });
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    cache: "no-store",
    signal: options.signal,
  });

  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Mobilithek HTTP ${response.status}: ${body.slice(0, 500)}`);
  }

  return {
    status: response.status,
    contentType,
    body,
  };
}

export function getMobilithekEnvTemplate() {
  return [
    "# Mobilithek subscriptions",
    "MOBILITHEK_SUBSCRIPTION_ID=1024488922196914176",
    "MOBILITHEK_SUBSCRIPTION_ID_2=1024488211727953920",
    "MOBILITHEK_SUBSCRIPTION_ID_3=1024486200127131648",
    `MOBILITHEK_SUBSCRIPTION_URL=${DEFAULT_BASE_URL}`,
    "# PKCS#12 / mTLS",
    "# MOBILITHEK_CLIENT_P12_BASE64=",
    "# MOBILITHEK_P12_PASSWORD=",
    "# Optional Bearer token:",
    "# MOBILITHEK_TOKEN=",
  ].join("\n");
}
