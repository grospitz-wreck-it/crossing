import { config, validateConfig } from "./config.js";
import { loadDemandCrossings } from "./demand.js";
import { filterEventsByDemand } from "./filterDemand.js";
import { refreshOnce } from "./mobilithek.js";
import { ensureSchema } from "./schema.js";
import { writeSnapshot } from "./snapshot.js";

// Subscription inventory for the current Mobilithek account.
// Slots refer to the environment variables consumed by config.ts:
//   0 = MOBILITHEK_SUBSCRIPTION_ID
//   2 = MOBILITHEK_SUBSCRIPTION_ID_3
//   4 = MOBILITHEK_SUBSCRIPTION_ID_5
//
// Kirchlengern uses the smallest useful combination found in the one-time
// profiling run: slot 0 covers the observation EVAs plus Bünde/Bielefeld;
// slot 4 covers Osnabrück Hbf; slot 2 covers Hannover Hbf.
//
// IMPORTANT: there is deliberately no fallback to config.subscriptionIds.
// Unknown demand therefore fails closed instead of downloading Germany.
function selectSubscriptionIdsForDemand(
  demand: Array<{ id: string }>,
): { ids: string[]; slots: number[] } {
  const slots = new Set<number>();

  for (const crossing of demand) {
    if (crossing.id.toLowerCase() === "kirchlengern") {
      slots.add(0);
      slots.add(4);
      slots.add(2);
    }
  }

  const selectedSlots = [...slots].sort((a, b) => a - b);
  const ids = selectedSlots
    .map((slot) => config.subscriptionIds[slot])
    .filter((id): id is string => Boolean(id));

  return { ids, slots: selectedSlots };
}

async function main() {
  const startedAt = new Date().toISOString();

  console.log("[Mobilithek Worker] starting");
  validateConfig();
  await ensureSchema();

  const demand = await loadDemandCrossings();
  console.log(`[Mobilithek Worker] demanded crossings=${demand.length}`);

  if (demand.length === 0) {
    console.log("[Mobilithek Worker] no demanded crossings; snapshot unchanged");
    return;
  }

  const selection = selectSubscriptionIdsForDemand(demand);

  if (selection.ids.length === 0) {
    throw new Error(
      "Für die aktuell nachgefragten BÜs ist keine Mobilithek-Subscription gemappt; Snapshot bleibt unverändert",
    );
  }

  console.log(
    `[Mobilithek Worker] selected subscription slots=${selection.slots.join(",")} ` +
      `count=${selection.ids.length}`,
  );

  const result = await refreshOnce(selection.ids);
  const demandedEvents = filterEventsByDemand(result.events, demand);

  console.log(
    `[Mobilithek Worker] subscriptions=${result.subscriptionCount} ` +
      `successful=${result.successful} ` +
      `failed=${result.failed} ` +
      `parsedEvents=${result.parsedEvents} ` +
      `rawAccepted=${result.eventCount} ` +
      `demandedEvents=${demandedEvents.length}`,
  );

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
