import fs from "fs";
import { createClient } from "@libsql/client";

function loadEnv(path) {
  const text = fs.readFileSync(path, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    let [, key, value] = match;

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
       (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadEnv("apps/web/.env.local");

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  throw new Error("TURSO_DATABASE_URL oder TURSO_AUTH_TOKEN fehlt.");
}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const files = [
  "apps/web/sql/005_crossing_registry.sql",
  "apps/web/sql/006_railway_station_catalog.sql",
  "migrations/20260823_crossing_locations.sql",
];

for (const file of files) {
  console.log(`\n=== APPLY ${file} ===`);

  const sql = fs.readFileSync(file, "utf8");

  // PRAGMA / Transaktionshüllen entfernen.
  const cleaned = sql
    .replace(/^\s*PRAGMA[^;]*;\s*$/gim, "")
    .replace(/^\s*BEGIN TRANSACTION;\s*$/gim, "")
    .replace(/^\s*COMMIT;\s*$/gim, "");

  const statements = cleaned
    .split(";")
    .map(s => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    const firstLine = statement
      .split("\n")
      .map(x => x.trim())
      .find(Boolean) || "";

    console.log(`→ ${firstLine.slice(0, 120)}`);

    await db.execute(statement);
  }

  console.log(`OK: ${file}`);
}

console.log("\n=== VERIFY TABLES ===");

const tables = [
  "railway_stations",
  "crossing_station_links",
  "railway_station_catalog",
  "crossing_locations",
];

for (const table of tables) {
  const result = await db.execute({
    sql: `
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = ?
      LIMIT 1
    `,
    args: [table],
  });

  console.log(
    `${table}: ${result.rows.length ? "OK" : "MISSING"}`
  );
}

console.log("\n=== VERIFY COUNTS ===");

for (const table of tables) {
  const result = await db.execute(
    `SELECT COUNT(*) AS count FROM ${table}`
  );

  console.log(`${table}: ${result.rows[0].count}`);
}

console.log("\nDONE");
