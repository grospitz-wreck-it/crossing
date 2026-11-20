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
export { filterEventsByDemand, getDemandMatches, getDemandMatchDetails } from "./filterDemand";
export { normalizeMobilithekProductCategory } from "./mobilithekTimetable";
export { getSnapshotThroughTrains } from "./getSnapshotThroughTrains";

export type {
  MobilithekTrainEvent,
  MobilithekFeedKind,
} from "./mobilithekTimetable";
export type { DemandCrossing } from "./filterDemand";
export type { SnapshotThroughTrain } from "./getSnapshotThroughTrains";

export { getSnapshotPrimaryTrains } from "./getSnapshotPrimaryTrains";
export type { SnapshotPrimaryTrain } from "./getSnapshotPrimaryTrains";

export {
  fetchOpenBoardsBoard,
  fetchOpenBoardsForStations,
  clearOpenBoardsMemoryCache,
} from "./openBoardsClient";
export type {
  OpenBoardsDirection,
  OpenBoardsOptions,
  OpenBoardsBatchResult,
} from "./openBoardsClient";
export {
  normalizeOpenBoardsBatch,
  normalizeOpenBoardsBatches,
} from "./openBoardsNormalizer";
export type { OpenBoardsStationObservation } from "./openBoardsNormalizer";

export {
  buildOpenBoardsQueueJobs,
  staggerOpenBoardsJobs,
} from "./openBoardsScheduler";
export type {
  OpenBoardsQueueJob,
  OpenBoardsQueueDemand,
} from "./openBoardsScheduler";

export {
  syncOpenBoardsQueue,
  claimNextOpenBoardsJob,
  reserveOpenBoardsRequestSlot,
  finishOpenBoardsJob,
} from "./openBoardsQueueStore";
export type { ClaimedOpenBoardsJob } from "./openBoardsQueueStore";

export {
  getOpenBoardsObservations,
  toTrainObservation,
} from "./openBoardsObservations";
