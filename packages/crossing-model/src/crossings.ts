import type { Crossing } from "./types";

/**
 * Legacy static registry intentionally kept empty.
 * Runtime crossings come exclusively from the database registry.
 */
export const crossings: Crossing[] = [];
