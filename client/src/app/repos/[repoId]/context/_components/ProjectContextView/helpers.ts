/**
 * Pure helpers for the Project Context page (N6). `now` is an injectable
 * parameter (defaulting to the real clock) so the relative-time formatting is
 * deterministic under test.
 */

/**
 * Coarse relative time, e.g. "just now", "5m ago", "3h ago", "2d ago". Caps
 * at days — the footer only ever needs "how stale is this list", not a
 * calendar date.
 */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  const diffMs = now.getTime() - then;
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
