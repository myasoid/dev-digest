/* helpers.ts — pure formatting helpers for the eval dashboard components.
   Plain functions (no hooks) — can be called anywhere including non-React code. */

/**
 * Format a nullable metric as a percentage string.
 * Returns `na` when the value is null/undefined — never "0%" for an empty
 * denominator (criterion 6: null metrics must not render as 0%).
 */
export function pct(v: number | null | undefined, na: string): string {
  if (v == null) return na;
  return `${(v * 100).toFixed(1)}%`;
}
