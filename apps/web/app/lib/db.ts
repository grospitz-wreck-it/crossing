import { createClient, type Client } from "@libsql/client";
import { OpenLocationCode } from "open-location-code";

// open-location-code v1 exposes these helpers statically. The admin crossing
// resolver historically uses an instance, so provide a small compatibility
// bridge without changing the resolver API.
const OLC = OpenLocationCode as any;
const OLCP = OLC.prototype as any;
for (const method of ["isValid", "isShort", "isFull", "decode", "recoverNearest"]) {
  if (typeof OLC[method] === "function" && typeof OLCP[method] !== "function") {
    OLCP[method] = OLC[method];
  }
}

let client: Client | undefined;

function getClient(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url || !authToken) {
    throw new Error(
      "Turso-Datenbank ist nicht konfiguriert: TURSO_DATABASE_URL und TURSO_AUTH_TOKEN werden benötigt.",
    );
  }

  client = createClient({ url, authToken });
  return client;
}

// Keep the existing `db.execute(...)` API used throughout the app while
// avoiding database-client initialization during `next build`.
export const db = new Proxy({} as Client, {
  get(_target, property, receiver) {
    const value = Reflect.get(getClient(), property, receiver);
    return typeof value === "function" ? value.bind(getClient()) : value;
  },
});
