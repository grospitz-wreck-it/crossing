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
    "# Nur setzen, falls eure Subscription einen Bearer/API-Token verlangt:",
    "# MOBILITHEK_TOKEN=",
  ].join("\n");
}
