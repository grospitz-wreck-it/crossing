import { config, validateConfig } from "./config.js";
import { refreshOnce } from "./mobilithek.js";
import { ensureSchema } from "./schema.js";
import { writeSnapshot } from "./snapshot.js";

async function main() {
  const startedAt = new Date().toISOString();

  console.log("[Mobilithek Worker] starting");

  validateConfig();

  await ensureSchema();

  const result = await refreshOnce();

  console.log(
    `[Mobilithek Worker] subscriptions=${result.subscriptionCount} ` +
    `successful=${result.successful} ` +
    `failed=${result.failed} ` +
    `events=${result.eventCount}`,
  );

  // FAIL-SAFE:
  // Bei komplettem Ausfall oder einem leeren Ergebnis
  // wird der bestehende Snapshot NICHT gelöscht.
  if (result.successful === 0) {
    throw new Error(
      "Keine Mobilithek-Subscription erfolgreich verarbeitet; Snapshot bleibt unverändert",
    );
  }

  if (result.events.length === 0) {
    throw new Error(
      "Mobilithek lieferte 0 verwertbare Zugdaten; Snapshot bleibt unverändert",
    );
  }

  await writeSnapshot(result.events, startedAt);

  console.log("[Mobilithek Worker] refresh successful");
}

main().catch((error) => {
  console.error("[Mobilithek Worker] fatal", error);
  process.exit(1);
});
