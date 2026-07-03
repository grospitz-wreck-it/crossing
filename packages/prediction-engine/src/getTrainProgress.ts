export function getTrainProgress(
  route: string[],
  destination: string
) {
  const destinationIndex =
    route.indexOf(
      destination
    );

  if (
    destinationIndex < 0
  ) {
    return null;
  }

  return {
    destinationIndex,
    stopCount:
      route.length,
  };
}