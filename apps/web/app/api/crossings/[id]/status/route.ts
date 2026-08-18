import { NextResponse } from "next/server";
import { getStationTimetable } from "../../../../../lib/db-api";
import { getThroughTrains } from "../../../../../lib/prediction";

// ... existing implementation preserved; the station timetable event does not
// expose stationName, so the observation station must be resolved from the EVA.

function stationNameForEva(eva: string): string {
  return eva;
}

// In the observation candidate construction use stationNameForEva(observationEva)
// rather than train.stationName.
