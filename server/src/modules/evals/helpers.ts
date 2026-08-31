import { createHash } from 'node:crypto';
import type { EvalCase } from '../../vendor/shared/contracts/knowledge.js';
import type { EvalTarget, EvalUnlistedPolicy } from '../../vendor/shared/contracts/eval-run.js';

/**
 * Pure helpers for the evals module — no I/O, deterministic given inputs.
 *
 * `isMeasurementChange` mirrors `isConfigChange` (agents/helpers.ts) but for
 * eval cases: only changes that affect scoring bump the revision.
 *
 * `caseSetRevision` produces a fingerprint over the set that the trend chart
 * breaks its line on — stable under reordering, changes when any case's
 * revision changes (gap 6).
 */

export interface MeasurementPatch {
  name?: string;
  notes?: string | null;
  targets?: EvalTarget[];
  unlisted?: EvalUnlistedPolicy;
  inputDiff?: string;
}

/**
 * True when a patch changes a MEASUREMENT-AFFECTING field for an eval case.
 *
 * Only `input_diff`, `targets`, and `unlisted` affect scoring; a case rename
 * or notes edit is cosmetic and must NOT bump `revision` — the trend chart
 * must not break its line on cosmetic edits (criterion 11).
 *
 * Copies the shape of `isConfigChange` (agents/helpers.ts:70) but NOT its
 * field list — the two domains are different.
 */
export function isMeasurementChange(
  existing: Pick<EvalCase, 'targets' | 'unlisted' | 'input_diff'>,
  patch: MeasurementPatch,
): boolean {
  if (patch.inputDiff !== undefined && patch.inputDiff !== existing.input_diff) return true;
  if (patch.unlisted !== undefined && patch.unlisted !== existing.unlisted) return true;
  if (patch.targets !== undefined) {
    // Compare by stable JSON — order matters (targets are an ordered array).
    if (JSON.stringify(patch.targets) !== JSON.stringify(existing.targets)) return true;
  }
  return false;
}

/**
 * Stable fingerprint over a set's (case_id, revision) pairs.
 *
 * Properties:
 *   - Stable under reordering — pairs are sorted before hashing.
 *   - Changes when ANY case's revision changes.
 *   - Changes when cases are added or removed.
 *
 * The trend chart BREAKS its line at any point where case_set_revision
 * changes, so the fingerprint must be deterministic and content-driven only.
 */
export function caseSetRevision(cases: Array<{ id: string; revision: number }>): string {
  const pairs = [...cases]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => `${c.id}:${c.revision}`)
    .join('|');
  return createHash('sha256').update(pairs).digest('hex').slice(0, 16);
}
