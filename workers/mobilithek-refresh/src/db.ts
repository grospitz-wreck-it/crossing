import { createClient } from "@libsql/client";
import { config } from "./config.js";

let client: ReturnType<typeof createClient> | null = null;

export function getDb() {
  if (!client) {
    if (!config.tursoUrl || !config.tursoAuthToken) {
      throw new Error("Turso-Konfiguration fehlt");
    }

    client = createClient({
      url: config.tursoUrl,
      authToken: config.tursoAuthToken,
    });
  }

  return client;
}
