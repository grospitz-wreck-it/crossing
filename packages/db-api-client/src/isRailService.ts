/**
 * True only for railway service identifiers used by the Mobilithek snapshot.
 * The snapshot also contains bus routes whose product labels begin with "S"
 * (e.g. regional express buses S50/S60/S90). For ambiguous S-services, use
 * route-stop metadata as a cheap second signal before expensive OSM matching.
 */
const RAIL_SERVICE_PREFIX = /^(?:ICE|IC|EC|RE|RB|IRE|S\d|S$|MEX|RRX|FEX|WFB|ERB|NWB|ODEG|MRB|ABR|CAN|ALX|HLB|SWE|BRB|BOB|ALEX|VIA|DPN|FLX|TGV|RJ|NJ|EN|REX|WESTBAHN)(?:\d|$)/;

function normalizeService(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s._-]+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function isBusStyleStop(value: unknown): boolean {
  return /\b(?:mast\s*\d*|bussteig|bushaltestelle|ersatzhaltestelle)\b/i.test(String(value || ""));
}

export function isRailService(service: { category?: unknown; line?: unknown; route?: unknown }): boolean {
  const category = normalizeService(service.category);
  const line = normalizeService(service.line);
  if (!RAIL_SERVICE_PREFIX.test(category) && !RAIL_SERVICE_PREFIX.test(line)) return false;

  // "S" is overloaded in the Mobilithek feed: S-Bahn products and regional
  // bus lines both use it. A route containing multiple explicit bus-stop
  // markers is not a railway journey. Do not apply this heuristic to RB/RE/IC
  // etc.; replacement-service and unusual station names must not suppress them.
  const isAmbiguousSService = /^(?:S\d+)$/.test(category) || /^(?:S\d+)$/.test(line);
  const route = Array.isArray(service.route) ? service.route : [];
  if (isAmbiguousSService && route.filter(isBusStyleStop).length >= 2) return false;

  return true;
}
