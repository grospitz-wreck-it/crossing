import type {
  Crossing,
} from "./types";

export const crossings: Crossing[] = [
  {
    id: "kirchlengern",

    name: "Kirchlengern",

    eva: "8003288",

    observationEvas: [
      "8003288", // Kirchlengern
      "8000059", // Bünde(Westf)
      "8000252", // Minden(Westf)
      "8000036", // Bielefeld Hbf
      "8000152", // Hannover Hbf
      "8000294", // Osnabrück Hbf
    ],
requiredRouteStops: [
  "Osnabrück Hbf",
  "Bünde(Westf)",
  "Minden(Westf)",
  "Hannover Hbf",
],
    lat: 52.196944,
    lon: 8.642139,

    closeOffsetSeconds: 80,
    openOffsetSeconds: 20,

    rules: [
      {
        // Halt Richtung Lübbecke/Rahden.
        platform: "2",
        stopping: true,
        openOffsetSeconds: 110,
      },

      {
        // Halt Richtung Herford/Bielefeld.
        platform: "1",
        stopping: true,
        openOffsetSeconds: 0,
      },
    ],

    confidence: 0.85,
  },
];