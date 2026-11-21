import { db } from "@/app/lib/db";

type MeasurementRow = {
  prediction_id: string;
  event_type: string;
  actual_at: string;
  phase_json: string | null;
  precision: string | null;
  is_test: number | string | null;
};

type Phase = {
  start?: string;
  end?: string;
  trains?: Array<{
    trainNumber?: string | number;
    line?: string;
  }>;
};

function parsePhase(value: unknown): Phase | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed as Phase : null;
  } catch {
    return null;
  }
}

function timestamp(value: unknown): number | null {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function trainFingerprint(phase: Phase | null): string {
  return (phase?.trains ?? [])
    .map((train) => {
      const line = String(train.line ?? "").trim().toUpperCase();
      const number = String(train.trainNumber ?? "").trim();
      return line || number ? `${line}:${number}` : "";
    })
    .filter(Boolean)
    .sort()
    .join("|");
}

export async function GET() {
  try {
    // Calibration is deliberately read-only and uses only exact,
    // non-test observations. Censored "at_least" observations must
    // never be treated as point measurements.
    const [measurementsResult, flagsResult] = await Promise.all([
      db.execute(`
        SELECT prediction_id, event_type, actual_at, phase_json, precision, is_test
        FROM measurements
        WHERE COALESCE(is_test, 0) = 0
          AND COALESCE(precision, 'exact') = 'exact'
          AND event_type IN ('close', 'open')
        ORDER BY id ASC
      `),
      db.execute(`
        SELECT prediction_id, flag
        FROM measurement_flags
      `),
    ]);

    const flagged = new Map<string, string[]>();
    for (const row of flagsResult.rows as Array<Record<string, unknown>>) {
      const id = String(row.prediction_id ?? "");
      const flag = String(row.flag ?? "");
      if (!id || !flag) continue;
      const current = flagged.get(id) ?? [];
      if (!current.includes(flag)) current.push(flag);
      flagged.set(id, current);
    }

    const grouped = new Map<string, {
      phase: Phase | null;
      close: number[];
      open: number[];
    }>();

    // Exact duplicate events are collapsed defensively. Distinct event
    // times are retained and make a prediction group ambiguous.
    const seen = new Set<string>();
    for (const row of measurementsResult.rows as unknown as MeasurementRow[]) {
      const id = String(row.prediction_id ?? "");
      const event = String(row.event_type ?? "");
      const at = timestamp(row.actual_at);
      if (!id || !at || (event !== "close" && event !== "open")) continue;

      const dedupeKey = `${id}|${event}|${at}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const current = grouped.get(id) ?? {
        phase: parsePhase(row.phase_json),
        close: [],
        open: [],
      };
      if (!current.phase) current.phase = parsePhase(row.phase_json);
      current[event].push(at);
      grouped.set(id, current);
    }

    const cycles: Array<Record<string, unknown>> = [];
    let ambiguous = 0;
    let incomplete = 0;
    let invalid = 0;
    let flaggedCount = 0;

    for (const [predictionId, group] of grouped) {
      if (group.close.length !== 1 || group.open.length !== 1) {
        if (group.close.length && group.open.length) ambiguous++;
        else incomplete++;
        continue;
      }

      const closeAt = group.close[0];
      const openAt = group.open[0];
      if (openAt <= closeAt) {
        invalid++;
        continue;
      }

      const predictedClose = timestamp(group.phase?.start);
      const predictedOpen = timestamp(group.phase?.end);
      if (predictedClose === null || predictedOpen === null || predictedOpen <= predictedClose) {
        invalid++;
        continue;
      }

      const flags = flagged.get(predictionId) ?? [];
      const isFlagged = flags.length > 0;
      if (isFlagged) flaggedCount++;

      const trainKey = trainFingerprint(group.phase);
      cycles.push({
        predictionId,
        predictedClose: new Date(predictedClose).toISOString(),
        actualClose: new Date(closeAt).toISOString(),
        predictedOpen: new Date(predictedOpen).toISOString(),
        actualOpen: new Date(openAt).toISOString(),
        predictedDurationSeconds: Math.round((predictedOpen - predictedClose) / 1000),
        actualDurationSeconds: Math.round((openAt - closeAt) / 1000),
        closeDeltaSeconds: Math.round((closeAt - predictedClose) / 1000),
        openDeltaSeconds: Math.round((openAt - predictedOpen) / 1000),
        trainKey,
        trains: group.phase?.trains ?? [],
        flags,
        eligibleForCalibration: !isFlagged && Boolean(trainKey),
      });
    }

    const eligible = cycles.filter((cycle) => cycle.eligibleForCalibration);
    const closeDeltas = eligible.map((cycle) => Number(cycle.closeDeltaSeconds));
    const openDeltas = eligible.map((cycle) => Number(cycle.openDeltaSeconds));
    const durationDeltas = eligible.map((cycle) =>
      Number(cycle.actualDurationSeconds) - Number(cycle.predictedDurationSeconds)
    );

    const patternMap = new Map<string, number[]>();
    for (const cycle of eligible) {
      const key = String(cycle.trainKey);
      const values = patternMap.get(key) ?? [];
      values.push(Number(cycle.actualDurationSeconds) - Number(cycle.predictedDurationSeconds));
      patternMap.set(key, values);
    }

    const patterns = Array.from(patternMap, ([trainKey, deltas]) => ({
      trainKey,
      samples: deltas.length,
      medianDurationDeltaSeconds: median(deltas),
    })).sort((a, b) => b.samples - a.samples);

    return Response.json({
      generatedAt: new Date().toISOString(),
      mode: "read-only-calibration",
      source: {
        precision: "exact",
        excludesTestMeasurements: true,
        excludesFlaggedFromCalibration: true,
        censoredMeasurementsUsed: false,
      },
      counts: {
        measurementGroups: grouped.size,
        completeValidCycles: cycles.length,
        eligibleCycles: eligible.length,
        ambiguousGroups: ambiguous,
        incompleteGroups: incomplete,
        invalidGroups: invalid,
        flaggedCompleteCycles: flaggedCount,
      },
      summary: {
        medianCloseDeltaSeconds: median(closeDeltas),
        medianOpenDeltaSeconds: median(openDeltas),
        medianDurationDeltaSeconds: median(durationDeltas),
        minimumSamplesForAutomaticCalibration: 20,
        automaticCalibrationReady: eligible.length >= 20,
      },
      patterns,
      cycles: cycles.sort((a, b) =>
        String(b.actualClose).localeCompare(String(a.actualClose))
      ),
    });
  } catch (error) {
    console.error("[MEASUREMENT CALIBRATION] failed:", error);
    return Response.json(
      { error: "Calibration data could not be loaded" },
      { status: 500 }
    );
  }
}
