import fs from "node:fs";
import path from "node:path";
import { config, validateConfig } from "./config.js";
import { loadDemandCrossings } from "./demand.js";
import { filterEventsByDemand } from "./filterDemand.js";
import { refreshOnce } from "./mobilithek.js";
import { ensureSchema } from "./schema.js";
import { writeSnapshot } from "./snapshot.js";

type DemandCrossing = Awaited<ReturnType<typeof loadDemandCrossings>>[number];

type SubscriptionProfile = {
  subscriptionId: string;
  targetMatches?: string[];
  error?: string;
};

const PROFILE_PATH = path.resolve(process.cwd(), "subscription-profiles.json");

function normalizeTarget(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\(westf\.?\)/g, "")
    .replace(/\bhbf\.?\b/g, "")
    .replace(/[.,/#!$%^&*;:{}=_`~()\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadProfiles(): SubscriptionProfile[] {
  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error(
      `Subscription-Profil fehlt: ${PROFILE_PATH}. Bitte zuerst profileSubscriptions.ts ausführen.`,
    );
  }

  const raw: unknown = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
  if (!Array.isArray(raw)) {
    throw new Error("Subscription-Profil hat ein ungültiges Format (Array erwartet)");
  }

  return raw.filter(
    (item): item is SubscriptionProfile =>
      !!item &&
      typeof item === "object" &&
      typeof (item as SubscriptionProfile).subscriptionId === "string" &&
      !(item as SubscriptionProfile).error &&
      Array.isArray((item as SubscriptionProfile).targetMatches),
  );
}

function getDemandTargets(demand: DemandCrossing[]): Set<string> {
  const targets = new Set<string>();

  for (const crossing of demand) {
    for (const value of [
      ...crossing.requiredRouteStops,
      ...crossing.observationStations,
    ]) {
      const normalized = normalizeTarget(value);
      if (normalized) targets.add(normalized);
    }
  }

  return targets;
}

function selectSubscriptionIdsForDemand(
  demand: DemandCrossing[],
): { ids: string[]; slots: number[]; uncovered: string[] } {
  const profiles = loadProfiles();
  const uncovered = getDemandTargets(demand);
  const selected = new Set<string>();
  const selectedSlots = new Set<number>();

  const candidates = profiles
    .map((profile) => {
      const slot = config.subscriptionIds.findIndex(
        (id) => id === profile.subscriptionId,
      );

      return {
        profile,
        slot,
        coverage: new Set(
          (profile.targetMatches || [])
            .map(normalizeTarget)
            .filter(Boolean),
        ),
      };
    })
    .filter((candidate) => candidate.slot >= 0);

  while (uncovered.size > 0) {
    let best: (typeof candidates)[number] | undefined;
    let bestHits = 0;

    for (const candidate of candidates) {
      if (selected.has(candidate.profile.subscriptionId)) continue;

      const hits = [...uncovered].filter((target) =>
        candidate.coverage.has(target),
      ).length;

      if (hits > bestHits) {
        best = candidate;
        bestHits = hits;
      }
    }

    if (!best || bestHits === 0) break;

    selected.add(best.profile.subscriptionId);
    selectedSlots.add(best.slot);

    for (const target of best.coverage) {
      uncovered.delete(target);
    }
  }

  return {
    ids: [...selected],
    slots: [...selectedSlots].sort((a, b) => a - b),
    uncovered: [...uncovered].sort(),
  };
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

  if (demand.length === 0) {
    console.log("[Mobilithek Worker] no demanded crossings; snapshot unchanged");
    return;
  }

  logDemand(demand);

  const selection = selectSubscriptionIdsForDemand(demand);
  const targetCount = getDemandTargets(demand).size;

  console.log(
    `[Mobilithek Worker] demand targets=${targetCount} ` +
      `selected subscription slots=${selection.slots.join(",") || "-"} ` +
      `count=${selection.ids.length}`,
  );

  if (selection.uncovered.length > 0) {
    console.error(
      `[Mobilithek Worker] UNMAPPED targets=${selection.uncovered.join(" | ")}`,
    );
    throw new Error(
      `Für den aktuellen Demand fehlen Mobilithek-Profile für ${selection.uncovered.length} Targets; Snapshot bleibt unverändert`,
    );
  }

  if (selection.ids.length === 0) {
    throw new Error(
      "Für die aktuell nachgefragten BÜs ist keine Mobilithek-Subscription gemappt; Snapshot bleibt unverändert",
    );
  }

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