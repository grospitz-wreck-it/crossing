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

    // Reihenfolge ist bewusst gewählt: getThroughTrains() dedupliziert
    // pro Zug (category+journeyNumber) und die zuletzt verarbeitete Regel
    // gewinnt. Näher am Übergang liegende, damit genauere Beobachtungs-
    // stationen stehen deshalb weiter unten in der Liste.
    throughRules: [
  {
    // Berlin → Amsterdam, früher Beobachtungspunkt.
    // TODO KALIBRIERUNG: fallbackOffsetSeconds ist eine grobe Schätzung
    // (Fahrzeit Osnabrück Hbf -> Kirchlengern lt. Fahrplanlage, NICHT
    // gemessen). Vor produktivem Einsatz mit echten Ist-Zeiten
    // (Ankunft/Abfahrt-Differenz zu Kirchlengern über mehrere Fahrten)
    // gegenprüfen und anpassen. Da diese Station weiter entfernt liegt,
    // wird sie unten von der Bünde-Regel überschrieben, sobald der Zug
    // dort ebenfalls erkannt wird - dient v.a. für längeren Vorlauf.
    observationEva: "8000294",
    observationStation: "Osnabrück Hbf",
    categories: ["ICE"],

    fallbackOffsetSeconds: 1500, // ca. 25 Min., UNGEPRÜFTE SCHÄTZUNG

    trackDistanceMeters: 0,

    direction: "westbound",
  },
  {
    // Berlin → Amsterdam, später/genauerer Beobachtungspunkt.
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

    // Erkennung von Umleitungen: normalerweise fährt die ICE-Linie
    // Berlin<->Amsterdam über Osnabrück Hbf <-> Bünde (Westf) <->
    // Hannover Hbf, also über Kirchlengern. Bei Störungen wird teils über
    // Bielefeld Hbf umgeleitet - dann taucht der Zug in keiner der
    // throughRules-Beobachtungsstationen mehr auf. Um das trotzdem zu
    // erkennen, wird an Bielefeld Hbf nach ICE-Zügen gesucht, die zwar zur
    // selben Linie gehören (Osnabrück Hbf + Hannover Hbf im Laufweg), aber
    // OHNE "Bünde (Westf)" - das ist das Indiz für eine aktuelle
    // Umleitung an diesem Zug.
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

    // Umgekehrter Fall zu diversionRules: Züge, die NORMALERWEISE NICHT
    // über Kirchlengern fahren, aber durch eine Umleitung jetzt doch. Das
    // lässt sich nur direkt prüfen (läuft der aktuelle Laufweg durch
    // "Kirchlengern"?), nicht über requiredRouteStops, weil solche Züge ja
    // sonst mit ganz anderen Linien/Zielen unterwegs sind.
    // TODO KALIBRIERUNG: fallbackOffsetSeconds (Bielefeld Hbf ->
    // Kirchlengern) ist eine grobe, UNGEPRÜFTE Schätzung basierend auf
    // Streckenlänge. Bitte mit echten Beobachtungen abgleichen, sobald
    // mal eine Umleitung live beobachtet werden kann.
    rerouteWatchRules: [
      {
        observationEva: "8000036",
        observationStation: "Bielefeld Hbf",

        // Bewusst nicht nur ICE: bei Umleitungen können auch andere
        // Zuggattungen (IC, RE) betroffen sein.
        categories: ["ICE", "IC", "RE"],

        crossingRouteNames: ["Kirchlengern"],

        fallbackOffsetSeconds: 1200, // ca. 20 Min., UNGEPRÜFTE SCHÄTZUNG

        direction: "unknown",
      },
    ],

    confidence: 0.85,
  },
];