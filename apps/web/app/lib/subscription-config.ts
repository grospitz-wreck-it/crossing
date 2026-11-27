/**
 * Public subscription limits and the launch state.
 * Keep checkout disabled until the available crossing catalogue is ready.
 */
export const FREE_CROSSING_LIMIT = 3;

export const PREMIUM_CROSSING_PACKAGE = {
  additionalCrossings: 10,
  priceCents: 500,
  currency: "eur",
  durationDays: 365,
  enabled: false,
} as const;
