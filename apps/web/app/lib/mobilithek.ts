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

function getClientCertificateOptions(): https.AgentOptions | null {
  const p12Base64 = process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim();
  if (!p12Base64) return null;

  const passphrase = process.env.MOBILITHEK_P12_PASSWORD?.trim();
  if (!passphrase) {
    throw new Error("MOBILITHEK_P12_PASSWORD is required when MOBILITHEK_CLIENT_P12_BASE64 is configured");
  }

  return {
    pfx: Buffer.from(p12Base64, "base64"),
    passphrase,
    rejectUnauthorized: true,
  };
}

function requestWithMtls(
  url: URL,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<{ status: number; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const agentOptions = getClientCertificateOptions();
    const agent = agentOptions ? new https.Agent(agentOptions) : undefined;

    const request = https.request(
      url,
      {
        method: "GET",
        headers,
        agent,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
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

    request.on("error", reject);

    if (signal) {
      if (signal.aborted) {
        request.destroy(new Error("Mobilithek request aborted"));
        return;
      }
      signal.addEventListener("abort", () => request.destroy(new Error("Mobilithek request aborted")), { once: true });
    }

    request.end();
  });
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

  // Mobilithek requires mutual TLS. Fall back to native fetch only when no
  // client certificate is configured, which keeps local diagnostics useful.
  if (process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim()) {
    return requestWithMtls(url, headers, options.signal);
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
    "MOBILITHEK_CLIENT_P12_BASE64=",
    "MOBILITHEK_P12_PASSWORD=",
    "# Nur setzen, falls zusätzlich ein Bearer/API-Token verlangt wird:",
    "# MOBILITHEK_TOKEN=",
  ].join("\n");
}
