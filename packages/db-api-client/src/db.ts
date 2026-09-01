import { createClient } from "@libsql/client";

// Server-side Turso client used by database-backed helpers in this package.
// Keep the connection details in environment variables; never hard-code them.
export const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});
