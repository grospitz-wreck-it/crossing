export type IrisDeparture = {
  line: string;
  category: string;
  journeyNumber: number;

  administration: string;
  initialDepartureDate: [string, string];

  destination: string;
  delay: number;
  route: string[];
  platform?: string;
};

export function parseIrisDepartures(
  response: any
): IrisDeparture[] {
  try {
    const raw =
      response?.[1]?.result?.data;

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(raw);
console.log(
  "Departure count:",
  parsed?.[1]?.length
);
    const departures =
      parsed?.[1];

    if (
      !Array.isArray(
        departures
      )
    ) {
      return [];
    }

    const resolve = (
      value: any
    ): any => {
      if (
        typeof value ===
        "number"
      ) {
        return parsed?.[
          value
        ];
      }

      return value;
    };

    return departures
      .map(
        (ref: number) => {
          const dep =
            parsed?.[ref];

          if (!dep) {
            return null;
          }

          const train =
            parsed?.[
              dep.train
            ];

          const category =
            String(
              resolve(
                train?.category
              ) ?? ""
            );

          const journeyNumber =
            Number(
              resolve(
                train?.journeyNumber
              )
            ) || 0;

          const administration =
            String(
              resolve(
                train?.admin
              ) ?? ""
            );

          let line =
            resolve(
              train?.line
            );

          if (
            !line &&
            train?.customLine !=
              null
          ) {
            line =
              resolve(
                train.customLine
              );
          }

          if (
            (!line ||
              /^\d+$/.test(
                String(line)
              )) &&
            typeof train?.name ===
              "number"
          ) {
            line =
              resolve(
                train.name
              );
          }

          if (
            !line &&
            category &&
            journeyNumber
          ) {
            line =
              `${category} ${journeyNumber}`;
          }

          const destination =
            resolve(
              dep?.scheduledDestination
            );

          const platform =
            resolve(
              dep?.platform
            ) != null
              ? String(
                  resolve(
                    dep.platform
                  )
                )
              : undefined;

          const departure =
            parsed?.[
              dep.departure
            ];

          const delay =
            departure?.delay ??
            0;

          const scheduledTime =
            parsed?.[
              departure
                ?.scheduledTime
            ];

          const initialDepartureDate =
            Array.isArray(
              scheduledTime
            )
              ? (scheduledTime as [
                  string,
                  string,
                ])
              : [
                  "Date",
                  "",
                ];

          const routeRefs =
            parsed?.[
              dep.route
            ];

          const route =
            Array.isArray(
              routeRefs
            )
              ? routeRefs
                  .map(
                    (
                      stopRef: number
                    ) => {
                      const stop =
                        parsed?.[
                          stopRef
                        ];

                      return resolve(
                        stop?.name
                      );
                    }
                  )
                  .filter(Boolean)
              : [];

          return {
            line:
              String(
                line ??
                  "unknown"
              ),

            category,

            journeyNumber,

            administration,

            initialDepartureDate,

            destination:
              destination ??
              "unknown",

            delay,

            route,

            platform,
          };
        }
      )
      .filter(
        Boolean
      ) as IrisDeparture[];
  } catch (error) {
    console.error(
      "parseIrisDepartures failed",
      error
    );

    return [];
  }
}