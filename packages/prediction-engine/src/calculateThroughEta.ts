export type ThroughEtaInput = {
  trackDistanceMeters: number;

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
    fallbackOffsetSeconds,
    livePosition,
  } = input;

  // Solange wir noch keine
  // GPS-ETA berechnen,
  // verwenden wir den
  // bekannten Offset.
  if (
    !livePosition ||
    !livePosition.speed ||
    livePosition.speed < 5
  ) {
    return {
      etaSeconds:
        fallbackOffsetSeconds,

      confidence: 0.5,

      method: "fallback",
    };
  }

  // GPS ist vorhanden.
  // Die eigentliche Berechnung
  // folgt im nächsten Schritt.
  return {
    etaSeconds:
      fallbackOffsetSeconds,

    confidence: 0.75,

    method: "gps",
  };
}