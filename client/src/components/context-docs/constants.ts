/**
 * NFR-3 (proposed) — amber at >= 25,000 estimated tokens for the attached
 * set, red at >= 50,000. Advisory only; named constants here so re-tuning
 * after a look at `FEATURE_MODELS` / a real `.devdigest` (per the spec's
 * Open questions) is a one-file edit with no structural consequence.
 */
export const TOKEN_WARNING_AMBER = 25_000;
export const TOKEN_WARNING_RED = 50_000;

export type TokenTier = "ok" | "amber" | "red";
