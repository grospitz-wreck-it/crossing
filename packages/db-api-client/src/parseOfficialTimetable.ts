import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "s" || name === "m",
});

// DB-Zeitformat: YYMMDDHHmm (Europe/Berlin, lokale Zeit des Bahnhofs)
export function parseDbTime(value?: string): Date | null {
  if (!value || value.length < 10) {
    return null;
  }

  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  const hh = Number(value.slice(6, 8));
  const mi = Number(value.slice(8, 10));

  // Ziffern sind Berlin-Ortszeit, unabhängig davon, in welcher Zeitzone
  // dieser Node-Prozess selbst läuft (Codespaces/Server laufen meist in
  // UTC). Deshalb NICHT `new Date(y, m, d, h, min)` verwenden - das würde
  // die Ziffern als lokale Prozess-Zeit interpretieren.
  //
  // Stattdessen: Ziffern zunächst probeweise als UTC annehmen, dann für
  // genau dieses Datum den echten Berlin-Offset (CET = +1 im Winter,
  // CEST = +2 im Sommer) ermitteln und rausrechnen.
  const guessUtc = Date.UTC(2000 + yy, mm - 1, dd, hh, mi);

  const offsetName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(guessUtc))
    .find((p) => p.type === "timeZoneName")?.value;

  const offsetHours = offsetName?.includes("+2") ? 2 : 1;

  return new Date(guessUtc - offsetHours * 60 * 60 * 1000);
}

type RawStopEvent = {
  scheduledTime?: string;
  changedTime?: string;
  scheduledPlatform?: string;
  changedPlatform?: string;
  scheduledPath?: string;
  changedPath?: string;
  line?: string;
  cancelled?: boolean;
};

type RawStop = {
  id: string;
  category?: string;
  journeyNumber?: string;
  administration?: string;
  arrival?: RawStopEvent;
  departure?: RawStopEvent;
};

// Liest sowohl ein /plan/-Dokument als auch ein /fchg/-Dokument in die
// gleiche Zwischenstruktur ein. Bei /fchg/ sind i.d.R. nur "ct"/"cp"/"cpth"
// (geänderte Werte) gesetzt, "pt"/"pp"/"ppth" fehlen dort meist - deshalb
// gibt es hier zwei separate Felder statt eines gemergten.
function parseTimetableDocument(xml: string): Map<string, RawStop> {
  const result = new Map<string, RawStop>();

  let data: any;

  try {
    data = parser.parse(xml);
  } catch {
    return result;
  }

  const stops = data?.timetable?.s;

  if (!Array.isArray(stops)) {
    return result;
  }

  for (const s of stops) {
    const id = s?.["@_id"];

    if (!id) {
      continue;
    }

    const tl = s.tl;

    const toEvent = (el: any): RawStopEvent | undefined => {
      if (!el) {
        return undefined;
      }

      return {
        scheduledTime: el["@_pt"],
        changedTime: el["@_ct"],
        scheduledPlatform: el["@_pp"],
        changedPlatform: el["@_cp"],
        scheduledPath: el["@_ppth"],
        changedPath: el["@_cpth"],
        line: el["@_l"],
        cancelled: el["@_cs"] === "c",
      };
    };

    result.set(id, {
      id,
      category: tl?.["@_c"],
      journeyNumber: tl?.["@_n"],
      administration: tl?.["@_o"],
      arrival: toEvent(s.ar),
      departure: toEvent(s.dp),
    });
  }

  return result;
}

export type OfficialTrainEvent = {
  id: string;
  eva: string;

  category: string;
  line: string;
  journeyNumber: number;
  administration: string;

  platform?: string;
  cancelled: boolean;

  // Vollständiger, aus Ankunfts- + Abfahrtslaufweg zusammengesetzter
  // Streckenverlauf (Stationsnamen), analog zum "route"-Feld, das die
  // bisherige bahn.expert-Anbindung geliefert hat.
  route: string[];
  origin?: string;
  destination?: string;

  // Die für diese Station relevante Zeit: Ankunft falls vorhanden,
  // sonst Abfahrt (z.B. am Startbahnhof einer Fahrt).
  scheduledTime: Date;
  actualTime: Date;
  delayMinutes: number;

  scheduledArrival?: Date;
  actualArrival?: Date;
  scheduledDeparture?: Date;
  actualDeparture?: Date;
};

function mergeEvent(
  plan?: RawStopEvent,
  changes?: RawStopEvent
) {
  if (!plan && !changes) {
    return undefined;
  }

  const scheduled = parseDbTime(plan?.scheduledTime);
  const actual =
    parseDbTime(changes?.changedTime) ?? scheduled;

  const platform =
    changes?.changedPlatform ?? plan?.scheduledPlatform;

  const path =
    changes?.changedPath ?? plan?.scheduledPath;

  return {
    scheduled,
    actual,
    platform,
    path: path ? path.split("|") : [],
    cancelled: Boolean(changes?.cancelled),
  };
}

// Führt ein /plan/-Dokument (kann mehrere Stunden umfassen, einfach
// concatenieren) mit dem /fchg/-Dokument der Station zusammen.
export function mergeStationTimetable(
  eva: string,
  planXmls: string[],
  changesXml: string
): OfficialTrainEvent[] {
  const planStops = new Map<string, RawStop>();

  for (const xml of planXmls) {
    for (const [id, stop] of parseTimetableDocument(xml)) {
      planStops.set(id, stop);
    }
  }

  const changeStops = parseTimetableDocument(changesXml);

  const events: OfficialTrainEvent[] = [];

  for (const [id, plan] of planStops) {
    const changes = changeStops.get(id);

    const arrival = mergeEvent(plan.arrival, changes?.arrival);
    const departure = mergeEvent(
      plan.departure,
      changes?.departure
    );

    const relevant = arrival ?? departure;

    if (!relevant?.actual) {
      continue;
    }

    const line =
      changes?.departure?.line ??
      plan.departure?.line ??
      changes?.arrival?.line ??
      plan.arrival?.line ??
      (plan.category && plan.journeyNumber
        ? `${plan.category} ${plan.journeyNumber}`
        : "unknown");

    const route = [
      ...(arrival?.path ?? []),
      ...(departure?.path ?? []),
    ];

    const delayMinutes = relevant.scheduled
      ? Math.max(
          0,
          Math.round(
            (relevant.actual.getTime() -
              relevant.scheduled.getTime()) /
              60000
          )
        )
      : 0;

    events.push({
      id,
      eva,

      category: plan.category ?? "",
      line: String(line),
      journeyNumber: Number(plan.journeyNumber) || 0,
      administration: plan.administration ?? "",

      platform: relevant.platform,
      cancelled: Boolean(
        arrival?.cancelled || departure?.cancelled
      ),

      route,
      origin: arrival?.path?.[0],
      destination: departure?.path?.[departure.path.length - 1],

      scheduledTime: relevant.scheduled ?? relevant.actual,
      actualTime: relevant.actual,
      delayMinutes,

      scheduledArrival: arrival?.scheduled ?? undefined,
      actualArrival: arrival?.actual ?? undefined,
      scheduledDeparture: departure?.scheduled ?? undefined,
      actualDeparture: departure?.actual ?? undefined,
    });
  }

  return events.sort(
    (a, b) => a.actualTime.getTime() - b.actualTime.getTime()
  );
}
