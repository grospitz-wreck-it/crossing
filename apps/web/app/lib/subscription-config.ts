/**
 * Public subscription limits. The database flag subscription_config.premium_enabled
 * controls whether the package is actually offered to users.
 */
export const FREE_CROSSING_LIMIT = 3;

export const PREMIUM_CROSSING_PACKAGE = {
  additionalCrossings: 10,
  priceCents: 500,
  currency: "eur",
  durationDays: 365,
  enabled: true,
} as const;
