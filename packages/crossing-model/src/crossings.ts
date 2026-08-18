import type {
  Crossing,
} from "./types";

export const crossings: Crossing[] = [
  {
    id: "kirchlengern",
    name: "Kirchlengern",
    eva: "8003288",
    observationEvas: [
      "8003288",
      "8000059",
      "8000036",
      "8000152",
      "8000294",
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
        platform: "2",
        stopping: true,
        openOffsetSeconds: 110,
      },
      {
        platform: "1",
        stopping: true,
        openOffsetSeconds: 0,
      },
    ],
    throughRules: [
      {
        observationEva: "8000294",
        observationStation: "Osnabrück Hbf",
        categories: ["ICE"],
        fallbackOffsetSeconds: 1500,
        trackDistanceMeters: 0,
        direction: "westbound",
      },
      {
        observationEva: "8000059",
        observationStation: "Bünde (Westf)",
        categories: ["ICE"],
        fallbackOffsetSeconds: 300,
        trackDistanceMeters: 0,
        direction: "westbound",
      },
      {
        observationEva: "8000059",
        observationStation: "Bünde (Westf)",
        categories: ["ICE"],
        fallbackOffsetSeconds: 300,
        trackDistanceMeters: 0,
        direction: "eastbound",
      },
      {
        observationEva: "8000152",
        observationStation: "Hannover Hbf",
        categories: ["ICE"],
        fallbackOffsetSeconds: 2400,
        trackDistanceMeters: 0,
        direction: "eastbound",
      },
    ],
    diversionRules: [
      {
        observationEva: "8000036",
        observationStation: "Bielefeld Hbf",
        categories: ["ICE"],
        anchorRouteStops: [
          "Osnabrück Hbf",
          "Hannover Hbf",
        ],
        excludedRouteStop: "Bünde (Westf)",
      },
    ],
    rerouteWatchRules: [
      {
        observationEva: "8000036",
        observationStation: "Bielefeld Hbf",
        categories: ["ICE", "IC", "RE"],
        crossingRouteNames: ["Kirchlengern"],
        fallbackOffsetSeconds: 1200,
        direction: "unknown",
      },
    ],
    confidence: 0.85,
  },
];