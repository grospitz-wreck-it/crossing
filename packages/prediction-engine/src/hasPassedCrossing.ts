export function hasPassedCrossing(
  currentStop: string,
  crossingStop: string,
  stops: string[]
) {
  const currentIndex =
    stops.indexOf(currentStop);

  const crossingIndex =
    stops.indexOf(crossingStop);

  if (
    currentIndex === -1 ||
    crossingIndex === -1
  ) {
    return false;
  }

  return (
    currentIndex >
    crossingIndex
  );
}