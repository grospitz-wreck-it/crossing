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
      "8000059", // Bünde (Westf)
      "8000036", // Bielefeld Hbf
      "8000152", // Hannover Hbf
      "8000294", // Osnabrück Hbf
    ],

    requiredRouteStops: [
      "Osnabrück Hbf",
      "Bünde (Westf)",
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

    throughRules: [
  {
    // Berlin → Amsterdam
    observationEva: "8000059",
    observationStation: "Bünde (Westf)",
    categories: ["ICE"],

    // ca. 5 Minuten von Bünde bis Kirchlengern
    fallbackOffsetSeconds: 300,

    trackDistanceMeters: 0,

    direction: "westbound",
  },
  {
    // Amsterdam → Berlin
    observationEva: "8000152",
    observationStation: "Hannover Hbf",
    categories: ["ICE"],

    // ca. 40 Minuten Hannover → Kirchlengern
    fallbackOffsetSeconds: 2400,

    trackDistanceMeters: 0,

    direction: "eastbound",
  },
],

    confidence: 0.85,
  },
];