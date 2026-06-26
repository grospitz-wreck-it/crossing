export function parseDbTime(
  value: string
) {
  const yy = Number(
    value.slice(0, 2)
  );

  const mm = Number(
    value.slice(2, 4)
  );

  const dd = Number(
    value.slice(4, 6)
  );

  const hh = Number(
    value.slice(6, 8)
  );

  const mi = Number(
    value.slice(8, 10)
  );

  return new Date(
    2000 + yy,
    mm - 1,
    dd,
    hh,
    mi
  );
}
export function getNextTrain(
  trains: any[]
) {
  const now = Date.now();

  const parsed = trains
    .map((train) => {
      const value =
        train.arrival;

      const yy = Number(
        value.slice(0, 2)
      );

      const mm = Number(
        value.slice(2, 4)
      );

      const dd = Number(
        value.slice(4, 6)
      );

      const hh = Number(
        value.slice(6, 8)
      );

      const mi = Number(
        value.slice(8, 10)
      );

      const arrival =
  parseDbTime(value);

      return {
        ...train,
        arrivalDate:
          arrival,
      };
    })
    .filter(
      (t) =>
        t.arrivalDate.getTime() >
        now
    )
    .sort(
      (a, b) =>
        a.arrivalDate.getTime() -
        b.arrivalDate.getTime()
    );

  return parsed[0];
}