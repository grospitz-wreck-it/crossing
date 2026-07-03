export function getCrossingDirection(
  route: string[]
) {
  const bünde =
    route.indexOf(
      "Bünde (Westf)"
    );

  const osnabrück =
    route.indexOf(
      "Osnabrück Hbf"
    );

  const herford =
    route.indexOf(
      "Herford"
    );

  if (
    bünde >= 0 &&
    osnabrück >= 0
  ) {
    return bünde < osnabrück
      ? "westbound"
      : "eastbound";
  }

  if (
    herford >= 0 &&
    bünde >= 0
  ) {
    return herford < bünde
      ? "westbound"
      : "eastbound";
  }

  return "unknown";
}