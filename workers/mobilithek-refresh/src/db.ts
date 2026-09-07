import { createClient, type Client } from "@libsql/client/web";

export interface WorkerDbEnv {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
}

let client: Client | null = null;
let configuredUrl = "";

export function configureDb(env: WorkerDbEnv) {
  const url = env.TURSO_DATABASE_URL?.trim();
  const authToken = env.TURSO_AUTH_TOKEN?.trim();

  if (!url || !authToken) {
    throw new Error("Turso-Konfiguration fehlt");
  }

  if (!client || configuredUrl !== url) {
    client = createClient({ url, authToken });
    configuredUrl = url;
  }
}

export function getDb(): Client {
  if (!client) {
    throw new Error("Turso-Client ist noch nicht konfiguriert");
  }

  return client;
}
