import { config, validateConfig } from "./config.js";
import { loadDemandCrossings } from "./demand.js";
import { filterEventsByDemand } from "./filterDemand.js";
import { refreshOnce } from "./mobilithek.js";
import { ensureSchema } from "./schema.js";
import { writeSnapshot } from "./snapshot.js";

async function main() {
  const startedAt = new Date().toISOString();

  console.log("[Mobilithek Worker] starting");

  validateConfig();

  await ensureSchema();

  const demand = await loadDemandCrossings();

  console.log(`[Mobilithek Worker] demanded crossings=${demand.length}`);

  // Ohne aktive Nutzung gibt es keinen Grund, einen Deutschland-Snapshot
  // in Turso zu halten. Vorhandene Daten bleiben unangetastet.
  if (demand.length === 0) {
    console.log(
      "[Mobilithek Worker] no demanded crossings; snapshot unchanged",
    );
    return;
  }

  const result = await refreshOnce();
  const demandedEvents = filterEventsByDemand(result.events, demand);

  console.log(
    `[Mobilithek Worker] subscriptions=${result.subscriptionCount} ` +
      `successful=${result.successful} ` +
      `failed=${result.failed} ` +
      `parsedEvents=${result.parsedEvents} ` +
      `rawAccepted=${result.eventCount} ` +
      `demandedEvents=${demandedEvents.length}`,
  );

  // FAIL-SAFE: bei komplettem Ausfall oder ohne verwertbare Nachfrage
  // wird der bestehende Snapshot NICHT gelöscht.
  if (result.successful === 0) {
    throw new Error(
      "Keine Mobilithek-Subscription erfolgreich verarbeitet; Snapshot bleibt unverändert",
    );
  }

  if (demandedEvents.length === 0) {
    throw new Error(
      "Mobilithek lieferte keine Zugdaten für die aktuell nachgefragten BÜs; Snapshot bleibt unverändert",
    );
  }

  await writeSnapshot(demandedEvents, startedAt, {
    subscriptionCount: result.subscriptionCount,
    successful: result.successful,
    failed: result.failed,
  });

  const byDay = new Map<string, number>();

  for (const item of demandedEvents) {
    const date = item.event.actualTime.toISOString().slice(0, 10);
    byDay.set(date, (byDay.get(date) || 0) + 1);
  }

  console.log("[Mobilithek Worker] demanded event date distribution:");

  for (const [date, count] of [...byDay.entries()].sort()) {
    console.log(`  ${date}: ${count}`);
  }

  console.log("[Mobilithek Worker] refresh successful");
}

main().catch((error) => {
  console.error("[Mobilithek Worker] fatal", error);
  process.exit(1);
});
