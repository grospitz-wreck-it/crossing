import { calculateEta } from "./calculateEta";

export type ThroughEtaInput = {
  crossingLat: number;
  crossingLon: number;

  fallbackOffsetSeconds: number;

  livePosition: {
    latitude: number;
    longitude: number;
    speed: number;
  } | null;
};

export type ThroughEtaResult = {
  etaSeconds: number;

  confidence: number;

  method:
    | "gps"
    | "fallback";
};

export function calculateThroughEta(
  input: ThroughEtaInput
): ThroughEtaResult {
  const {
    crossingLat,
    crossingLon,
    fallbackOffsetSeconds,
    livePosition,
  } = input;

  // Kein GPS oder Zug steht -> Fahrplanfallback
  if (
    !livePosition ||
    livePosition.speed <= 5
  ) {
    return {
      etaSeconds: fallbackOffsetSeconds,
      confidence: 0.6,
      method: "fallback",
    };
  }

  const eta =
    calculateEta(
      livePosition.latitude,
      livePosition.longitude,
      crossingLat,
      crossingLon,
      livePosition.speed
    );

  return {
    etaSeconds: Math.max(
      0,
      Math.round(eta.etaMinutes * 60)
    ),
    confidence: 0.95,
    method: "gps",
  };
}