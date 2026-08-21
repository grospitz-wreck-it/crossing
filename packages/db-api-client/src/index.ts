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

export type {
  MobilithekTrainEvent,
  MobilithekFeedKind,
} from "./mobilithekTimetable";
