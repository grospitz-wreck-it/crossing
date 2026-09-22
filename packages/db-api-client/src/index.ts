export * from "./bahnExpert";
export * from "./journey";
export async function getNextTrainEta() {
  const now = new Date();

  return new Date(
    now.getTime() + 5 * 60 * 1000
  );
}
export {
  classifyFeed,
  parseBody,
  parseGtfsRtTripUpdates,
  filterMobilithekTrains,
} from "./mobilithekTimetable";
export { filterEventsByDemand, getDemandMatches } from "./filterDemand";
export { getSnapshotThroughTrains } from "./getSnapshotThroughTrains";

export type {
  MobilithekTrainEvent,
  MobilithekFeedKind,
} from "./mobilithekTimetable";
export type { DemandCrossing } from "./filterDemand";
export type { SnapshotThroughTrain } from "./getSnapshotThroughTrains";

export { getSnapshotPrimaryTrains } from "./getSnapshotPrimaryTrains";
export type { SnapshotPrimaryTrain } from "./getSnapshotPrimaryTrains";
