import { createClient } from "@libsql/client";
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

export const db =
  createClient({
    url:
      process.env
        .TURSO_DATABASE_URL!,

    authToken:
      process.env
        .TURSO_AUTH_TOKEN!,
  });