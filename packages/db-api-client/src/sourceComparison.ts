/**
 * Cross-source comparison model.
 *
 * OpenBoards is the canonical station observation for this comparison.
 * Timetables and Mobilithek are evidence providers only: they are never
 * promoted to a second or third canonical train-event collection.
 *
 * This module is diagnostic-only. It does not write snapshots or alter
 * production matching/forecast logic.
 */

export type CanonicalStationObservation = {
  key: string;
  source: "db_openboards";
  station: {
    eva: string;
  };
  event: {
    kind: "arrival" | "departure";
    scheduledAt: string | null;
    observedAt: string;
    timeStatus: string | null;
  };
  train: {
    journeyId: string | null;
    journeyNumber: string | null;
    line: string | null;
    category: string | null;
    origin: string | null;
    destination: string | null;
  };
  platform: string | null;
  cancelled: boolean | null;
  raw: unknown;
};

export type SupportingEvidence = {
  source: "db_timetables" | "mobilithek";
  kind: "arrival" | "departure";
  sourceRecordId: string | null;
  stationEva: string | null;
  journeyNumber: string | null;
  line: string | null;
  scheduledAt: string | null;
  actualAt: string | null;
  platform: string | null;
  cancelled: boolean | null;
};

export type EvidenceMatch = {
  evidence: SupportingEvidence;
  matchedBy: Array<"journey_number" | "line" | "scheduled_time">;
  scheduledDeltaSeconds: number | null;
};

export type ComparedStationObservation = CanonicalStationObservation & {
  support: {
    dbTimetables: EvidenceMatch[];
    mobilithek: EvidenceMatch[];
  };
};

function clean(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const result = String(value).trim();
  return result || null;
}

function lineToken(value: string | null): string | null {
  if (!value) return null;
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

function timeDeltaSeconds(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const left = Date.parse(a);
  const right = Date.parse(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.round((left - right) / 1000);
}

function compareEvidence(
  observation: CanonicalStationObservation,
  evidence: SupportingEvidence,
): EvidenceMatch | null {
  if (evidence.stationEva && evidence.stationEva !== observation.station.eva) {
    return null;
  }
  if (evidence.kind !== observation.event.kind) return null;

  const matchedBy: EvidenceMatch["matchedBy"] = [];
  const leftNumber = observation.train.journeyNumber;
  const rightNumber = evidence.journeyNumber;

  if (leftNumber && rightNumber && leftNumber === rightNumber) {
    matchedBy.push("journey_number");
  } else {
    // Without a shared train number we deliberately do not infer a match
    // from line/time alone; those fields are not globally unique.
    return null;
  }

  const leftLine = lineToken(observation.train.line);
  const rightLine = lineToken(evidence.line);
  if (leftLine && rightLine) {
    if (leftLine !== rightLine) return null;
    matchedBy.push("line");
  }

  const delta = timeDeltaSeconds(
    observation.event.scheduledAt,
    evidence.scheduledAt,
  );
  if (delta !== null) {
    if (Math.abs(delta) > 180) return null;
    matchedBy.push("scheduled_time");
  }

  return {
    evidence,
    matchedBy,
    scheduledDeltaSeconds: delta,
  };
}

export function compareStationObservations(
  observations: CanonicalStationObservation[],
  timetableEvidence: SupportingEvidence[],
  mobilithekEvidence: SupportingEvidence[],
): ComparedStationObservation[] {
  return observations.map((observation) => ({
    ...observation,
    support: {
      dbTimetables: timetableEvidence
        .map((evidence) => compareEvidence(observation, evidence))
        .filter((match): match is EvidenceMatch => Boolean(match)),
      mobilithek: mobilithekEvidence
        .map((evidence) => compareEvidence(observation, evidence))
        .filter((match): match is EvidenceMatch => Boolean(match)),
    },
  }));
}

export function toCanonicalOpenBoardsObservation(input: {
  id: unknown;
  eva: unknown;
  direction: unknown;
  time: unknown;
  scheduledTime: unknown;
  timeType: unknown;
  line: unknown;
  category: unknown;
  journeyNumber: unknown;
  journeyId: unknown;
  origin: unknown;
  destination: unknown;
  platform: unknown;
  cancelled: unknown;
  raw: unknown;
}): CanonicalStationObservation | null {
  const eva = clean(input.eva);
  const observedAt = clean(input.time);
  const direction = clean(input.direction);
  if (!eva || !observedAt || (direction !== "arrivals" && direction !== "departures")) {
    return null;
  }

  const timestamp = Date.parse(observedAt);
  if (!Number.isFinite(timestamp)) return null;

  return {
    key: clean(input.id) ?? [
      eva,
      direction,
      clean(input.journeyId) ?? clean(input.journeyNumber) ?? "unknown",
      observedAt,
    ].join(":"),
    source: "db_openboards",
    station: { eva },
    event: {
      kind: direction === "arrivals" ? "arrival" : "departure",
      scheduledAt: clean(input.scheduledTime),
      observedAt: new Date(timestamp).toISOString(),
      timeStatus: clean(input.timeType),
    },
    train: {
      journeyId: clean(input.journeyId),
      journeyNumber: clean(input.journeyNumber),
      line: clean(input.line),
      category: clean(input.category),
      origin: clean(input.origin),
      destination: clean(input.destination),
    },
    platform: clean(input.platform),
    cancelled: typeof input.cancelled === "boolean" ? input.cancelled : null,
    raw: input.raw,
  };
}

export function toTimetableEvidence(input: {
  id: unknown;
  eva: unknown;
  journeyNumber: unknown;
  line: unknown;
  scheduledTime: unknown;
  actualTime: unknown;
  kind: "arrival" | "departure";
  platform: unknown;
  cancelled: unknown;
}): SupportingEvidence {
  return {
    source: "db_timetables",
    kind: input.kind,
    sourceRecordId: clean(input.id),
    stationEva: clean(input.eva),
    journeyNumber: clean(input.journeyNumber),
    line: clean(input.line),
    scheduledAt: clean(input.scheduledTime),
    actualAt: clean(input.actualTime),
    platform: clean(input.platform),
    cancelled: typeof input.cancelled === "boolean" ? input.cancelled : null,
  };
}

export function toMobilithekEvidence(input: {
  id: unknown;
  stationEva: unknown;
  journeyNumber: unknown;
  line: unknown;
  scheduledTime: unknown;
  actualTime: unknown;
  kind: "arrival" | "departure";
  platform?: unknown;
  cancelled?: unknown;
}): SupportingEvidence {
  return {
    source: "mobilithek",
    kind: input.kind,
    sourceRecordId: clean(input.id),
    stationEva: clean(input.stationEva),
    journeyNumber: clean(input.journeyNumber),
    line: clean(input.line),
    scheduledAt: clean(input.scheduledTime),
    actualAt: clean(input.actualTime),
    platform: clean(input.platform),
    cancelled: typeof input.cancelled === "boolean" ? input.cancelled : null,
  };
}
