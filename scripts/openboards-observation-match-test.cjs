const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const { findMatchingOpenBoardsObservation } = require("../.tmp/openboards-match-test/packages/db-api-client/src/openBoardsObservations.js");

const candidate = {
  observationEva: "8003288",
  observationDirection: "departures",
  observationScheduledTime: "2026-11-21T10:00:00.000Z",
  line: "RB 71",
  journeyNumber: 12345,
};
const baseObservation = {
  source: "openboards",
  journeyId: "db-journey-12345",
  evaNumber: "8003288",
  direction: "departures",
  eventTime: "2026-11-21T10:01:00.000Z",
  scheduledTime: "2026-11-21T10:00:00.000Z",
  timeType: "PREVIEW",
  line: "RB71",
  category: "RB",
  journeyNumber: 12345,
  viaEvas: [],
  routeEvas: [],
  routeNames: [],
  cancelled: false,
  observedAt: "2026-11-21T09:59:00.000Z",
};

assert(findMatchingOpenBoardsObservation(candidate, [baseObservation]) === baseObservation,
  "Expected an exact station/train/time match");
assert(findMatchingOpenBoardsObservation({ ...candidate, observationEva: "8000001" }, [baseObservation]) === null,
  "A different station must not match");
assert(findMatchingOpenBoardsObservation({ ...candidate, observationDirection: "arrivals" }, [baseObservation]) === null,
  "A different event direction must not match");
assert(findMatchingOpenBoardsObservation({ ...candidate, journeyNumber: 999 }, [baseObservation]) === null,
  "A different journey number must not match");
assert(findMatchingOpenBoardsObservation({ ...candidate, line: "RE 6" }, [baseObservation]) === null,
  "A different line must not match");
assert(findMatchingOpenBoardsObservation({ ...candidate, observationScheduledTime: "2026-11-21T10:04:00.000Z" }, [baseObservation]) === null,
  "A scheduled-time difference above three minutes must not match");
assert(findMatchingOpenBoardsObservation({ ...candidate, observationDirection: "unknown" }, [baseObservation]) === null,
  "Unknown direction must not be matched speculatively");

const realObservation = { ...baseObservation, timeType: "REAL", eventTime: "2026-11-21T10:00:30.000Z" };
assert(findMatchingOpenBoardsObservation(candidate, [baseObservation, realObservation]) === realObservation,
  "REAL observation must be preferred over PREVIEW");

console.log("OpenBoards-to-Mobilithek strict matching tests OK");
