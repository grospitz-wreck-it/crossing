export function journeyUsesCrossing(
  stops: string[],
  markers: string[]
) {
  const matches =
    markers.filter(
      (marker) =>
        stops.includes(
          marker
        )
    );

  return (
    matches.length >= 2
  );
}