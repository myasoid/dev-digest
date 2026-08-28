/**
 * Pure resolver for a run's EFFECTIVE Project Context document set — no I/O,
 * no DB, no filesystem. `run-executor.ts` supplies the already-fetched links
 * (agent-direct + each linked, globally-enabled skill's, already filtered to
 * `enabled` the same way `enabledSkillsForPrompt` filters skills) and reads
 * the resulting paths itself; this file only decides ORDER.
 *
 * See specs/2026-08-25-project-context.md → "The effective document set".
 */

export interface ContextDocOrderable {
  path: string;
  order: number;
}

/**
 * Resolve the effective, ordered, deduped list of document paths.
 *
 * - Agent-direct links first, in the agent's configured order (AC-26).
 * - Then each linked, globally-enabled skill's links, in the AGENT's skill
 *   order (the order `skillLinksPerSkill` is passed in) — a globally
 *   disabled skill contributes nothing, because the caller only ever passes
 *   the links of skills it already filtered to `enabled` (AC-28).
 * - The same path reached from two places is injected once, at its
 *   EARLIEST position (AC-27) — the agent's own attachment is never demoted
 *   by a skill that happens to carry the same document.
 * - Ties on `order` within one owner break on `path` (EC-17, NFR-8): two
 *   identical configurations resolve to a byte-identical order.
 */
export function resolveEffectiveContextDocs(
  agentLinks: readonly ContextDocOrderable[],
  skillLinksPerSkill: readonly (readonly ContextDocOrderable[])[],
): string[] {
  const orderedPaths = (links: readonly ContextDocOrderable[]): string[] =>
    [...links].sort((a, b) => a.order - b.order || a.path.localeCompare(b.path)).map((l) => l.path);

  const candidates = [
    ...orderedPaths(agentLinks),
    ...skillLinksPerSkill.flatMap((links) => orderedPaths(links)),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of candidates) {
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
