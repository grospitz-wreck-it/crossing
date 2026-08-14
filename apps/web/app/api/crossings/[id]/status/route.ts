import { getStationTimetable } from "../../../../../../../packages/db-api-client/src/getStationTimetable";
import { getThroughTrains } from "../../../../../../../packages/db-api-client/src/getThroughTrains";
import { getDivertedTrains } from "../../../../../../../packages/db-api-client/src/getDivertedTrains";
import { getReroutedTrains } from "../../../../../../../packages/db-api-client/src/getReroutedTrains";
import { getCrossingDirection } from "../../../../../../../packages/prediction-engine/src/getCrossingDirection";
import { crossings } from "../../../../../../../packages/crossing-model/src/crossings";
import { withMemoryCache } from "../../../../../../../packages/db-api-client/src/memoryCache";

// Diese Route nutzt ausschließlich die offizielle DB API Marketplace
// "Timetables v1"-API (plan + fchg, siehe getStationTimetable.ts /
// parseOfficialTimetable.ts). Die frühere bahn.expert-Anbindung
// (irisDepartures, journeyFind, journeyPosition/GPS, getTrainContext) wird
// hier nicht mehr verwendet - Details siehe README-TIMETABLE-MIGRATION.md.
//
// SICHERHEITSHINWEIS: Diese Vorhersage basiert auf Fahrplan- und
// Verspätungsdaten, nicht auf einer amtlichen Bahnübergangssteuerung. Sie
// darf nicht als alleinige Sicherheitsinstanz für das Überqueren eines
// Bahnübergangs verwendet oder beworben werden.

let cachedResponse: any = null;
let cacheTimestamp = 0;
const CACHE_TTL = 0;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const now = Date.now();

  if (cachedResponse && now - cacheTimestamp < CACHE_TTL) {
    return Response.json(cachedResponse);
  }

  const crossing = crossings.find((c) => c.id === id);

  if (!crossing) {
    return Response.json(
      { error: "Crossing not found" },
      { status: 404 }
    );
  }

  const trains: any[] = [];

  // --- Züge, die am Übergang selbst halten (eva === crossing.eva) ---
  try {
    const localEvents = await getStationTimetable(crossing.eva, 4);

    for (const train of localEvents) {
      if (train.cancelled) {
        continue;
      }

      // TODO: Aktuell gelten alle Züge auf Bahnsteiggleis 1 oder 2 als
      // haltend. Sobald wagenscharfe / haltbezogene Daten verfügbar sind,
      // sollte diese Heuristik ersetzt werden.
      const isStoppingTrain =
        train.platform === "1" || train.platform === "2";

      const crossingTime = train.actualTime;
      const etaSeconds = Math.floor(
        (crossingTime.getTime() - Date.now()) / 1000
      );

      trains.push({
        id: `${train.category}-${train.journeyNumber}-${train.id}`,

        line: train.line,
        category: train.category,
        journeyNumber: train.journeyNumber,

        origin: train.origin,
        destination: train.destination,

        platform: train.platform,
        isStoppingTrain,

        direction: getCrossingDirection(train.route),
        directionLabel: train.destination
          ? `Richtung ${train.destination}`
          : null,

        delayMinutes: train.delayMinutes,

        crossingTime: crossingTime.toISOString(),
        arrival: crossingTime.toISOString(),
        etaSeconds,
      });
    }
  } catch (error) {
    console.error("Failed to load local timetable:", error);

    return Response.json({
      crossing: {
        id: crossing.id,
        name: crossing.name,
        lat: crossing.lat,
        lon: crossing.lon,
      },
      state: "UNKNOWN",
      nextCloseIn: 0,
      nextOpenIn: 0,
      phase: null,
      closureCount: 0,
      closures: [],
      trainCount: 0,
      trains: [],
      divertedTrains: [],
    });
  }

  // --- ICE-Durchfahrten (kein eigener Halt am Übergang) ---
  const throughTrains = await withMemoryCache(
    `through-${crossing.id}`,
    5000,
    () => getThroughTrains(crossing)
  );

  // Züge, die planmäßig zur Kirchlengern-Linie gehören, aber aktuell
  // z.B. über Bielefeld umgeleitet sind - tauchen NICHT in trains/closures
  // auf, werden aber informativ mitgeliefert (siehe DivertedTrain).
  const divertedTrains = await withMemoryCache(
    `diverted-${crossing.id}`,
    5000,
    () => getDivertedTrains(crossing)
  );

  // Züge, die normalerweise NICHT über den Übergang fahren, aber gerade
  // dorthin umgeleitet werden - diese MÜSSEN in die Schranken-Vorhersage
  // (trains/closures) einfließen, im Gegensatz zu divertedTrains.
  const reroutedTrains = await withMemoryCache(
    `rerouted-${crossing.id}`,
    5000,
    () => getReroutedTrains(crossing)
  );

  const existingKeys = new Set(
    trains.map((t) => `${t.category}-${t.journeyNumber}`)
  );

  for (const train of reroutedTrains) {
    const key = `${train.category}-${train.journeyNumber}`;

    if (existingKeys.has(key)) {
      // Bereits über die reguläre Erkennung erfasst (sollte praktisch
      // nicht vorkommen, da Bielefeld nicht auf der Stammstrecke liegt,
      // aber sicherheitshalber keine Duplikate).
      continue;
    }

    const crossingTime = new Date(train.crossingTime);
    const etaSeconds = Math.floor(
      (crossingTime.getTime() - Date.now()) / 1000
    );

    trains.push({
      id: `${train.category}-${train.journeyNumber}-rerouted`,

      line: train.line,
      category: train.category,
      journeyNumber: train.journeyNumber,

      origin: train.origin,
      destination: train.destination,

      // Keine bekannte Bahnsteigzuordnung -> fällt in route.ts unten auf
      // die Standard-Offsets des Übergangs zurück (nicht auf eine
      // platform-spezifische Regel).
      platform: undefined,
      isStoppingTrain: false,

      direction: train.direction,
      directionLabel: "Umleitung",

      delayMinutes: train.delayMinutes,

      crossingTime: crossingTime.toISOString(),
      arrival: crossingTime.toISOString(),
      etaSeconds,

      estimatedFrom: {
        observationStation: train.observationStation,
        observationActualTime: train.observationActualTime,
        fallbackOffsetSeconds: train.fallbackOffsetSeconds,
      },

      rerouted: true,
      note: train.note,
    });
  }

  for (const train of throughTrains) {
    const crossingTime = new Date(train.crossingTime);
    const etaSeconds = Math.floor(
      (crossingTime.getTime() - Date.now()) / 1000
    );

    trains.push({
      id: `${train.category}-${train.journeyNumber}`,

      line: train.line,
      category: train.category,
      journeyNumber: train.journeyNumber,

      origin: train.origin,
      destination: train.destination,

      platform:
        train.direction === "westbound"
          ? "1"
          : train.direction === "eastbound"
          ? "2"
          : undefined,

      isStoppingTrain: false,

      direction: train.direction,
      directionLabel: "Durchfahrt",

      delayMinutes: train.delayMinutes,

      crossingTime: crossingTime.toISOString(),
      arrival: crossingTime.toISOString(),
      etaSeconds,

      // Zur Nachvollziehbarkeit: worauf die Schätzung beruht.
      estimatedFrom: {
        observationStation: train.observationStation,
        observationActualTime: train.observationActualTime,
        fallbackOffsetSeconds: train.fallbackOffsetSeconds,
      },
    });
  }

  trains.sort(
    (a, b) =>
      new Date(a.crossingTime).getTime() -
      new Date(b.crossingTime).getTime()
  );

  const upcoming = trains.filter((t) => t.etaSeconds > 0);

  const MERGE_GAP_SECONDS = 30;

  const closures: { start: Date; end: Date; trains: any[] }[] = [];

  for (const train of upcoming) {
    const crossingTime = new Date(train.crossingTime);

    let closeOffset = crossing.closeOffsetSeconds;
    let openOffset = crossing.openOffsetSeconds;

    const rule = (crossing as any).rules?.find(
      (rule: any) =>
        rule.platform === train.platform &&
        rule.stopping === train.isStoppingTrain
    );

    if (rule) {
      closeOffset = rule.closeOffsetSeconds ?? closeOffset;
      openOffset = rule.openOffsetSeconds ?? openOffset;
    }

    const closeAt = new Date(
      crossingTime.getTime() - closeOffset * 1000
    );
    const openAt = new Date(
      crossingTime.getTime() + openOffset * 1000
    );

    const last = closures[closures.length - 1];

    if (
      !last ||
      closeAt.getTime() > last.end.getTime() + MERGE_GAP_SECONDS * 1000
    ) {
      closures.push({ start: closeAt, end: openAt, trains: [train] });
    } else {
      if (openAt.getTime() > last.end.getTime()) {
        last.end = openAt;
      }
      last.trains.push(train);
    }
  }

  const nextClosure = closures[0];
  const MAX_LOOKAHEAD_MINUTES = 30;

  const visibleClosures = closures.filter(
    (closure) =>
      closure.start.getTime() <=
      Date.now() + MAX_LOOKAHEAD_MINUTES * 60 * 1000
  );

  let state = "OPEN";
  let nextCloseIn = 0;
  let nextOpenIn = 0;
  let phaseStart: string | null = null;
  let phaseEnd: string | null = null;

  if (nextClosure) {
    phaseStart = nextClosure.start.toISOString();
    phaseEnd = nextClosure.end.toISOString();

    const nowMs = Date.now();

    if (nowMs < nextClosure.start.getTime()) {
      state = "OPEN";
      nextCloseIn = Math.floor(
        (nextClosure.start.getTime() - nowMs) / 1000
      );
    } else if (nowMs < nextClosure.end.getTime()) {
      state = "CLOSED";
      nextOpenIn = Math.floor(
        (nextClosure.end.getTime() - nowMs) / 1000
      );
    }
  }

  const response = {
    crossing: {
      id: crossing.id,
      name: crossing.name,
      lat: crossing.lat,
      lon: crossing.lon,
    },

    state,
    nextCloseIn,
    nextOpenIn,

    phase: nextClosure
      ? {
          start: phaseStart,
          end: phaseEnd,
          durationMinutes: Math.round(
            (nextClosure.end.getTime() - nextClosure.start.getTime()) /
              60000
          ),
          trainCount: nextClosure.trains.length,
          trains: nextClosure.trains,
        }
      : null,

    closureCount: visibleClosures.length,

    closures: visibleClosures.map((closure) => ({
      start: closure.start.toISOString(),
      end: closure.end.toISOString(),
      durationMinutes: Math.round(
        (closure.end.getTime() - closure.start.getTime()) / 60000
      ),
      trainCount: closure.trains.length,
      trains: closure.trains,
    })),

    trainCount: trains.length,
    trains,

    divertedTrains,
  };

  cachedResponse = response;
  cacheTimestamp = Date.now();

  return Response.json(response);
}