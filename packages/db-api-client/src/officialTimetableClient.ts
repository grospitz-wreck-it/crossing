// Offizieller Client für die DB API Marketplace "Timetables v1"-API.
//
// WICHTIG: Diese API liefert zwei getrennte Ressourcen, die manuell
// zusammengeführt werden müssen:
//
//   /plan/{eva}/{date}/{hour}  -> reiner Sollfahrplan, OHNE Verspätungen
//   /fchg/{eva}                -> alle aktuellen Änderungen (Verspätung,
//                                  Gleiswechsel, Ausfall, geänderter Laufweg)
//                                  für die Station, für die aktuelle Zeit
//                                  bis mehrere Stunden im Voraus
//
// Nur wenn beide Antworten anhand des <s id="..."> zusammengeführt werden,
// bekommt man tatsächliche (verspätete) Zeiten. Das war in der Vorversion
// dieses Projekts (route_old.ts) nicht der Fall - dort wurde ausschließlich
// /plan/ abgefragt, weshalb dort nie echte Verspätungen berücksichtigt wurden.
//
// Beide Endpunkte benötigen einen genehmigten Zugang im DB API Marketplace
// (https://developers.deutschebahn.com) für das Produkt "Timetables".
// Zugangsdaten werden als DB-Client-Id / DB-Api-Key Header mitgeschickt.

const BASE_URL =
  "https://apis.deutschebahn.com/db-api-marketplace/apis/timetables/v1";

function dbHeaders() {
  const clientId = process.env.DB_CLIENT_ID;
  const apiKey = process.env.DB_API_KEY;

  if (!clientId || !apiKey) {
    throw new Error(
      "DB_CLIENT_ID / DB_API_KEY fehlen. Bitte in apps/web/.env.local setzen " +
        "(Zugangsdaten aus dem DB API Marketplace für das Produkt 'Timetables')."
    );
  }

  return {
    "DB-Client-Id": clientId,
    "DB-Api-Key": apiKey,
  };
}

// DB erwartet Datum/Stunde in der Form YYMMDD / HH, in der Zeitzone,
// in der der jeweilige Bahnhof betrieben wird (praktisch: Europe/Berlin).
// Wir bilden das bewusst über Intl mit expliziter Zeitzone ab, statt über
// getUTCHours(), damit das auch während der Sommerzeit stimmt.
function formatDateHour(date: Date): {
  date: string;
  hour: string;
} {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return {
    date: `${get("year")}${get("month")}${get("day")}`,
    hour: get("hour") === "24" ? "00" : get("hour"),
  };
}

async function fetchXml(
  url: string,
  label: string
): Promise<string> {
  const res = await fetch(url, {
    headers: dbHeaders(),
    cache: "no-store",
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `${label} fehlgeschlagen: ${res.status} ${res.statusText} - ${text.slice(
        0,
        200
      )}`
    );
  }

  return text;
}

// Holt den Sollfahrplan für eine EVA-Nummer für die aktuelle Stunde und die
// folgende Stunde (damit auch Züge kurz nach der vollen Stunde nicht fehlen).
export async function fetchPlanXml(
  eva: string,
  hoursAhead = 4 // statt 2 – Puffer für Anfragen kurz vor voller Stunde
): Promise<string[]> {
  const now = Date.now();
  const requests = Array.from(
    { length: hoursAhead },
    (_, i) => new Date(now + i * 60 * 60 * 1000)
  ).map((date) => {
    const { date: d, hour: h } = formatDateHour(date);
    return fetchXml(`${BASE_URL}/plan/${eva}/${d}/${h}`, `plan/${eva}/${d}/${h}`);
  });
  return Promise.all(requests);
}

// Holt alle aktuellen Änderungen (Verspätungen, Ausfälle, Gleiswechsel) für
// eine EVA-Nummer. Deckt laut DB-Dokumentation den Zeitraum "jetzt bis
// mehrere Stunden in die Zukunft" ab - ein separater Aufruf pro Stunde ist
// hier (anders als bei /plan/) nicht nötig.
export async function fetchChangesXml(
  eva: string
): Promise<string> {
  return fetchXml(`${BASE_URL}/fchg/${eva}`, `fchg/${eva}`);
}
