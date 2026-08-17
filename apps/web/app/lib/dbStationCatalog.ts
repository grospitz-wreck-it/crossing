import { createRequire } from "node:module";

type DbStation = {
  type: "station";
  id: string;
  additionalIds?: string[];
  name: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  address?: {
    city?: string;
    zipcode?: string;
    street?: string;
  };
  federalState?: string;
  ril100?: string;
  ril100Identifiers?: Array<{
    rilIdentifier: string;
    isMain?: boolean;
  }>;
};

const require = createRequire(import.meta.url);
let catalog: DbStation[] | null = null;

export function getDbStations(): DbStation[] {
  if (catalog) return catalog;
  try {
    const pkg = require("db-stations");
    const stations = pkg?.stations || pkg?.data || pkg?.default || [];
    catalog = Array.isArray(stations) ? stations : [];
  } catch {
    catalog = [];
  }
  return catalog!;
}

export function normalizeStation(station: DbStation) {
  return {
    eva: station.id,
    name: station.name,
    lat: station.location?.latitude ?? null,
    lon: station.location?.longitude ?? null,
    city: station.address?.city ?? null,
    federalState: station.federalState ?? null,
    ril100: station.ril100 ?? station.ril100Identifiers?.find((x) => x.isMain)?.rilIdentifier ?? null,
  };
}
