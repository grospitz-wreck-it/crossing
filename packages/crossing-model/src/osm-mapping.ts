import type { CrossingOSMMapping } from "./osm";

/**
 * Temporary seed point for the OSM integration.
 *
 * The actual OSM IDs must be populated by the importer; we intentionally do
 * not invent IDs here. An empty mapping means the legacy forecast path stays
 * authoritative for that crossing.
 */
export const crossingOSMMapping: Record<string, CrossingOSMMapping> = {};
