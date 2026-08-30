/* comparability.ts — pure function classifying whether two EvalSuiteRun inputs
   can be presented as a like-for-like comparison. Plain function, not a hook.
   Criterion 9 and 11 — see spec §Scoring and plan Step 26. */

import type { EvalRunInputs } from "@devdigest/shared";

/** Classification result for a pair of eval suite runs. */
export type ComparabilityResult =
  | { kind: "like-for-like" }
  | { kind: "skills-changed" }
  | { kind: "case-set-changed" };

/**
 * Classifies two EvalRunInputs triples for comparability.
 *
 * Rules (in priority order):
 * 1. Different `case_set_revision` → REFUSE to present as like-for-like prompt
 *    comparison. The trend chart breaks at this boundary (criterion 11).
 * 2. Different `skill_versions` at equal `agent_version` → say the skills
 *    changed; do not present as same-prompt runs (criterion 9).
 * 3. All three equal → like-for-like.
 *
 * Note: two runs may have the same agent_version AND different skill bodies —
 * that is the gap-5 scenario. The skills-changed result surfaces it.
 */
export function comparability(a: EvalRunInputs, b: EvalRunInputs): ComparabilityResult {
  // Rule 1: case set changed → refuse like-for-like (criterion 11)
  if (a.case_set_revision !== b.case_set_revision) {
    return { kind: "case-set-changed" };
  }

  // Rule 2: skill versions differ → say so (criterion 9)
  if (!skillVersionsEqual(a.skill_versions, b.skill_versions)) {
    return { kind: "skills-changed" };
  }

  // All three equal → like-for-like
  return { kind: "like-for-like" };
}

/** Deep-equality check on skill version arrays (order-insensitive). */
function skillVersionsEqual(
  a: EvalRunInputs["skill_versions"],
  b: EvalRunInputs["skill_versions"],
): boolean {
  if (a.length !== b.length) return false;
  const normalize = (sv: EvalRunInputs["skill_versions"]) =>
    [...sv].sort((x, y) => x.skill_id.localeCompare(y.skill_id));
  const na = normalize(a);
  const nb = normalize(b);
  return na.every(
    (x, i) => x.skill_id === nb[i]!.skill_id && x.version === nb[i]!.version,
  );
}
