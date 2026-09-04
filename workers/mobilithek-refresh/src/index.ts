import { config, validateConfig } from "./config.js";
import { loadDemandCrossings } from "./demand.js";
import { filterEventsByDemand } from "./filterDemand.js";
import { refreshOnce } from "./mobilithek.js";
import { ensureSchema } from "./schema.js";
import { writeSnapshot } from "./snapshot.js";

type DemandCrossing = {
  id: string;
  requiredRouteStops: string[];
  categories: string[];
  observationStations: string[];
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(values: string[], needles: string[]): boolean {
  const normalizedValues = values.map(normalize);
  return needles.some((needle) => {
    const target = normalize(needle);
    return normalizedValues.some(
      (value) => value === target || value.includes(target) || target.includes(value),
    );
  });
}

/**
 * Account-specific Mobilithek inventory derived from the one-time profiling run.
 *
 * The important part is that selection is driven by the demand's stations/EVAs,
 * not by crossing IDs. There is intentionally no fallback to all configured
 * subscriptions: an unmapped demand fails closed.
 *
 * Current profiled coverage:
 *   slot 0 -> observation EVAs + Bünde/Bielefeld
 *   slot 4 -> Osnabrück Hbf
 *   slot 2 -> Hannover Hbf
 */
function selectSubscriptionIdsForDemand(
  demand: DemandCrossing[],
): { ids: string[]; slots: number[] } {
  const slots = new Set<number>();

  const observationEvas = [
    "8003288",
    "8000059",
    "8000036",
    "8000152",
    "8000294",
  ];

  for (const crossing of demand) {
    if (
      hasAny(crossing.observationStations, observationEvas) ||
      hasAny(crossing.observationStations, ["Bünde", "Bielefeld", "Bielefeld Hbf"]) ||
      hasAny(crossing.requiredRouteStops, ["Bünde", "Bünde (Westf)", "Bielefeld", "Bielefeld Hbf"])
    ) {
      slots.add(0);
    }

    if (
      hasAny(crossing.requiredRouteStops, ["Osnabrück", "Osnabrück Hbf"]) ||
      hasAny(crossing.observationStations, ["Osnabrück", "Osnabrück Hbf"])
    ) {
      slots.add(4);
    }

    if (
      hasAny(crossing.requiredRouteStops, ["Hannover", "Hannover Hbf"]) ||
      hasAny(crossing.observationStations, ["Hannover", "Hannover Hbf"])
    ) {
      slots.add(2);
    }
  }

  const selectedSlots = [...slots].sort((a, b) => a - b);
  const ids = selectedSlots
    .map((slot) => config.subscriptionIds[slot])
    .filter((id): id is string => Boolean(id));

  return { ids, slots: selectedSlots };
}

function logDemand(demand: DemandCrossing[]): void {
  for (const crossing of demand) {
    console.log(
      `[Mobilithek Worker] demand ${crossing.id}: ` +
        `routeStops=${crossing.requiredRouteStops.join(" | ") || "-"} ` +
        `observationStations=${crossing.observationStations.join(" | ") || "-"}`,
    );
  }
}

async function main() {
  const startedAt = new Date().toISOString();

  console.log("[Mobilithek Worker] starting");
  validateConfig();
  await ensureSchema();

  const demand = await loadDemandCrossings();
  console.log(`[Mobilithek Worker] demanded crossings=${demand.length}`);
  logDemand(demand);

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
