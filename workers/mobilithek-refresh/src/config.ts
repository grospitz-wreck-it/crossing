const subscriptionIds = Array.from({ length: 15 }, (_, index) => {
  const key =
    index === 0
      ? "MOBILITHEK_SUBSCRIPTION_ID"
      : `MOBILITHEK_SUBSCRIPTION_ID_${index + 1}`;

  return process.env[key]?.trim().replace(/^"|"$/g, "").trim() || "";
}).filter(Boolean);

export const config = {
  mobilithekUrl:
    process.env.MOBILITHEK_SUBSCRIPTION_URL?.trim() ||
    "https://mobilithek.info:8443/mobilithek/api/v1.0/container/subscription",

  subscriptionIds: Array.from(new Set(subscriptionIds)),

  p12Base64: process.env.MOBILITHEK_CLIENT_P12_BASE64?.trim() || "",

  p12Password: process.env.MOBILITHEK_P12_PASSWORD || "",

  tursoUrl: process.env.TURSO_DATABASE_URL?.trim() || "",

  tursoAuthToken: process.env.TURSO_AUTH_TOKEN?.trim() || "",

  refreshIntervalSeconds: Number(
    process.env.MOBILITHEK_REFRESH_INTERVAL_SECONDS || "300",
  ),
};

export function validateConfig() {
  const missing: string[] = [];

  if (!config.subscriptionIds.length) {
    missing.push("MOBILITHEK_SUBSCRIPTION_ID*");
  }

  if (!config.p12Base64) {
    missing.push("MOBILITHEK_CLIENT_P12_BASE64");
  }

  if (!config.tursoUrl) {
    missing.push("TURSO_DATABASE_URL");
  }

  if (!config.tursoAuthToken) {
    missing.push("TURSO_AUTH_TOKEN");
  }

  if (missing.length) {
    throw new Error(
      `Mobilithek Worker: fehlende Environment Variables: ${missing.join(", ")}`,
    );
  }
}
