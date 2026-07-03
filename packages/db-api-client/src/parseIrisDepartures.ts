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
    const raw =
      response?.[0]?.result?.data;

    if (!raw) {
      return [];
    }

    const parsed =
      JSON.parse(raw);

    const departures =
      parsed?.[1];

    if (
      !Array.isArray(
        departures
      )
    ) {
      return [];
    }

    return departures
      .map((ref: number) => {
        const dep =
          parsed?.[ref];
          
          console.log(
  "DEP KEYS",
  Object.keys(dep)
);

console.log(
  "RAW DEP",
  dep
);
        if (!dep) {
          return null;
        }

        const train =
          parsed?.[
            dep.train
          ];

        const line =
          typeof train?.line ===
          "number"
            ? parsed?.[
                train.line
              ]
            : train?.line;

        const category =
          typeof train?.category ===
          "number"
            ? parsed?.[
                train.category
              ]
            : train?.category;

        const journeyNumber =
          typeof train?.journeyNumber ===
          "number"
            ? parsed?.[
                train
                  .journeyNumber
              ]
            : train?.journeyNumber;

        const destination =
          typeof dep?.scheduledDestination ===
          "number"
            ? parsed?.[
                dep
                  .scheduledDestination
              ]
            : dep?.scheduledDestination;

        const delay =
          parsed?.[
            dep.departure
          ]?.delay ?? 0;
const platformRef =
  dep?.platform;

const platform =
  typeof platformRef ===
  "number"
    ? parsed?.[
        platformRef
      ]
    : platformRef;
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

                    const nameRef =
                      stop?.name;

                    return typeof nameRef ===
                      "number"
                      ? parsed?.[
                          nameRef
                        ]
                      : nameRef;
                  }
                )
                .filter(Boolean)
            : [];

        const result = {
  line:
    line ??
    "unknown",

  category:
    category ??
    "unknown",

  journeyNumber:
    Number(
      journeyNumber
    ) || 0,

  destination:
    destination ??
    "unknown",

  delay,

  route,

  platform,
};

        console.log(
          "PARSED DEPARTURE",
          result
        );

        return result;
      })
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