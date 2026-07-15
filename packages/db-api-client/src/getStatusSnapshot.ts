export async function getStatusSnapshot(
    crossing: Crossing
) {

    const rawDepartures =
        await getDepartures(
            crossing.eva
        );

    const departures =
        parseIrisDepartures(
            rawDepartures
        );

    const throughTrains =
        await getThroughTrains(
            crossing
        );

    const contexts =
        await Promise.all([
            ...haltende Züge...,
            ...throughTrains...
        ]);

    return {
        departures,
        throughTrains,
        contexts,
    };
}