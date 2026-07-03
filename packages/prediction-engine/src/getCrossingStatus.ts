export type CrossingState =
  | "OPEN"
  | "CLOSING"
  | "CLOSED";

export function getCrossingStatus(
  etaMinutes: number
): CrossingState {
  if (etaMinutes <= 1) {
    return "CLOSED";
  }

  if (etaMinutes <= 3) {
    return "CLOSING";
  }

  return "OPEN";
}