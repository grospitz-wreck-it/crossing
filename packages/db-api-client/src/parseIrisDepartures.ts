export type IrisDeparture = {
  line: string;
  category: string;
  journeyNumber: number;
  destination: string;
  delay: number;
  route: string[];
  platform?: string;
};

export function parseIrisDepartures(
  response: any
): IrisDeparture[] {
  try {
    const raw = response?.[0]?.result?.data;

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    const departures = parsed?.[1];

    if (!Array.isArray(departures)) {
      return [];
    }

    const resolve = (value: any): any => {
      if (typeof value === "number") {
        return parsed?.[value];
      }

      return value;
    };

    return departures
      .map((ref: number) => {
        const dep = parsed?.[ref];

        if (!dep) {
          return null;
        }

        const train = parsed?.[dep.train];

        // ICE/IC nutzen teilweise customLine statt line
        const category =
  String(
    resolve(train?.category) ?? ""
  );

const journeyNumber =
  Number(
    resolve(train?.journeyNumber)
  ) || 0;

// Fernverkehr nutzt häufig customLine
// ("ICE 78", "IC 2215", ...)
// Regionalverkehr nutzt line.
let line =
  resolve(train?.line);

if (
  !line &&
  train?.customLine != null
) {
  line = resolve(
    train.customLine
  );
}

// Falls customLine nur eine Zahl ist,
// aber der Name im Train-Objekt steckt.
if (
  (!line ||
    /^\d+$/.test(
      String(line)
    )) &&
  typeof train?.name ===
    "number"
) {
  line = resolve(
    train.name
  );
}

// Letzter Fallback
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
          resolve(dep?.platform) != null
            ? String(
                resolve(dep?.platform)
              )
            : undefined;

        const delay =
          parsed?.[
            dep.departure
          ]?.delay ?? 0;

        const routeRefs =
          parsed?.[
            dep.route
          ];

        const route = Array.isArray(
          routeRefs
        )
          ? routeRefs
              .map(
                (stopRef: number) => {
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
    line ?? "unknown"
  ),

          category:
  String(
    category ?? "unknown"
  ),

          journeyNumber,

          destination:
            destination ??
            "unknown",

          delay,

          route,

          platform,
        };
      })
      .filter(Boolean) as IrisDeparture[];

  } catch (error) {
    console.error(
      "parseIrisDepartures failed",
      error
    );

    return [];
  }
}