import {
  fetchPlanXml,
  fetchChangesXml,
} from "./officialTimetableClient";

import {
  mergeStationTimetable,
  OfficialTrainEvent,
} from "./parseOfficialTimetable";

// Ersetzt getDepartures()/parseIrisDepartures() (bahn.expert) 1:1 durch die
// offizielle Timetables-v1-API. Liefert für eine EVA-Nummer alle Züge der
// aktuellen + folgenden Stunde, inklusive echter (gemergter) Verspätungen.
export async function getStationTimetable(
  eva: string,
  hoursAhead = 4
): Promise<OfficialTrainEvent[]> {
  const [planXmls, changesXml] = await Promise.all([
    fetchPlanXml(eva, hoursAhead),
    fetchChangesXml(eva),
  ]);

  return mergeStationTimetable(eva, planXmls, changesXml);
}
