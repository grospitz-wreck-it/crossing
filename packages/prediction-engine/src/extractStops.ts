export type Stop = {
  eva: string;
  name: string;
};

export function extractStops(rawJourneyData: string): Stop[] {
  const stops: Stop[] = [];

  const evaRegex = /"800\d{4,7}"/g;

  const matches = rawJourneyData.match(evaRegex);

  if (!matches) {
    return stops;
  }

  const seen = new Set<string>();

  for (const match of matches) {
    const eva = match.replace(/"/g, "");

    if (seen.has(eva)) {
      continue;
    }

    seen.add(eva);

    stops.push({
      eva,
      name: "",
    });
  }

  return stops;
}