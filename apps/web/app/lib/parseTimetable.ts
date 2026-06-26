import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  ignoreAttributes: false,
});

export function parseTimetable(
  xml: string
) {
  const data = parser.parse(xml);

  const services =
    data?.timetable?.s;

  if (!services) {
    return [];
  }

  const rows = Array.isArray(
    services
  )
    ? services
    : [services];

  return rows.map((s: any) => {
    const arrivalPath =
      s.ar?.["@_ppth"];

    const departurePath =
      s.dp?.["@_ppth"];

    return {
      id: s["@_id"],

      trainNumber:
        s.tl?.["@_n"],

      line:
        s.ar?.["@_l"] ??
        s.dp?.["@_l"],

      arrival:
        s.ar?.["@_pt"],

      departure:
        s.dp?.["@_pt"],

      platform:
        s.ar?.["@_pp"] ??
        s.dp?.["@_pp"],

      arrivalPath,

      departurePath,

      arrivalStations:
        arrivalPath
          ? arrivalPath.split("|")
          : [],

      departureStations:
        departurePath
          ? departurePath.split("|")
          : [],
    };
  });
}