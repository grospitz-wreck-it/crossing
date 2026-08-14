export type CrossingRule = {
  platform: string;

  stopping: boolean;

  closeOffsetSeconds?: number;

  openOffsetSeconds?: number;
};
export type ThroughRule = {
  observationEva: string;

  observationStation: string;

  categories: string[];

  trackDistanceMeters: number;

  fallbackOffsetSeconds: number;

  direction:
    | "eastbound"
    | "westbound";
};
// Erkennung umgeleiteter Züge: ein Zug, der planmäßig über den Übergang
// laufen würde, aber wegen einer Störung über eine andere Station
// (z.B. Bielefeld Hbf statt Bünde/Kirchlengern) umgeleitet wird, taucht in
// den throughRules-Beobachtungsstationen gar nicht mehr auf. Damit die App
// das trotzdem erkennt (statt den Zug einfach "verschwinden" zu lassen),
// wird an einer alternativen Beobachtungsstation nach Zügen gesucht, die
// zwar zu derselben Linie gehören (anchorRouteStops = Endpunkte der Linie,
// die unabhängig von der Umleitung immer angefahren werden), aber die
// eigentlich zu erwartende Station der Stammstrecke (excludedRouteStop)
// NICHT im Laufweg haben.
export type DiversionRule = {
  observationEva: string;

  observationStation: string;

  categories: string[];

  anchorRouteStops: string[];

  excludedRouteStop: string;
};

// Watch-Regel für den UMGEKEHRTEN Fall zu DiversionRule: ein Zug, der
// normalerweise NICHT über den Übergang fährt, wird durch eine Umleitung
// NEU auf die Strecke über den Übergang gelegt. Das lässt sich nicht über
// "fehlende Station im Laufweg" erkennen (das wäre ja gerade der
// Normalfall für so einen Zug), sondern nur direkt: läuft der - ggf. per
// fchg geänderte - Laufweg des Zugs jetzt tatsächlich durch die Station
// des Übergangs selbst? Wenn ja, wird er live in die Schranken-Vorhersage
// aufgenommen, auch wenn er planmäßig dort gar nicht vorgesehen war.
export type RerouteWatchRule = {
  observationEva: string;

  observationStation: string;

  categories: string[];

  // Name(n), wie die Übergangs-Station im ppth/cpth-Laufweg auftaucht.
  // In der Regel identisch mit Crossing.name, kann aber abweichen
  // (z.B. Schreibweise in HAFAS vs. offizieller Stationsname).
  crossingRouteNames: string[];

  fallbackOffsetSeconds: number;

  direction:
    | "eastbound"
    | "westbound"
    | "unknown";
};

export type Crossing = {
  id: string;

  name: string;

  eva: string;

  observationEvas: string[];

  requiredRouteStops: string[];

  lat: number;

  lon: number;

  closeOffsetSeconds: number;

  openOffsetSeconds: number;

  rules?: CrossingRule[];

  throughRules?: ThroughRule[];

  diversionRules?: DiversionRule[];

  rerouteWatchRules?: RerouteWatchRule[];

  confidence: number;
};