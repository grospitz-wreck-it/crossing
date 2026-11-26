/**
 * True only for railway service identifiers used by the Mobilithek snapshot.
 * The snapshot table also contains bus journeys (numeric lines, R-/X-/SB-
 * routes, etc.). Those must never enter the railway crossing matcher.
 * Match the product/category first and fall back to the public train line code.
 */
const RAIL_SERVICE_PREFIX = /^(?:ICE|IC|EC|RE|RB|IRE|S\d|S$|MEX|RRX|FEX|WFB|ERB|NWB|ODEG|MRB|ABR|CAN|ALX|HLB|SWE|BRB|BOB|ALEX|VIA|DPN|FLX|TGV|RJ|NJ|EN|REX|WESTBAHN)(?:\d|$)/;

function normalizeService(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s._-]+/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function isRailService(service: { category?: unknown; line?: unknown }): boolean {
  const category = normalizeService(service.category);
  const line = normalizeService(service.line);
  return RAIL_SERVICE_PREFIX.test(category) || RAIL_SERVICE_PREFIX.test(line);
}
