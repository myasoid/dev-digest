/**
 * scoring.test.ts — hermetic unit tests for the eval scorer.
 *
 * Covers the full Phase-1 matrix from the plan (Step 7):
 *   - Overlap boundaries: touching, adjacent-by-one, fully contained, identical.
 *   - Empty denominators → null for each of recall / precision / citation_accuracy.
 *   - One case holding both must_find and must_not_flag simultaneously.
 *   - A finding overlapping both kinds resolves to must_not_flag.
 *   - unlisted: 'forbid' with zero targets (negative control).
 *   - unlisted: 'forbid' with must_find targets (strict mode).
 *   - Extras under 'ignore' do NOT count as FP.
 *   - One finding spanning three must_find targets counts as ONE TP.
 *   - set-level scoreSet / scoreCases aggregation.
 *   - citation_accuracy from separate kept/dropped counts.
 */

import { describe, it, expect } from 'vitest';
import {
  linesIntersect,
  findingMatchesTarget,
  scoreCase,
  scoreSet,
  scoreCases,
  type ScoringCase,
  type CaseScore,
  type CitationInput,
} from './scoring.js';
import type { Finding } from '../../vendor/shared/contracts/findings.js';
import type { EvalTarget } from '../../vendor/shared/contracts/eval-run.js';

// ---------------------------------------------------------------------------
// Helpers — minimal fixture builders
// ---------------------------------------------------------------------------

function mkFinding(file: string, start: number, end: number): Finding {
  return {
    id: `f-${file}-${start}-${end}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'Fixture finding',
    file,
    start_line: start,
    end_line: end,
    rationale: 'test',
    confidence: 1,
  };
}

function mkTarget(
  kind: 'must_find' | 'must_not_flag',
  file: string,
  start: number,
  end: number,
): EvalTarget {
  return {
    kind,
    file,
    start_line: start,
    end_line: end,
    source_finding_id: null,
  };
}

function mkCase(
  targets: EvalTarget[],
  findings: Finding[],
  unlisted: 'ignore' | 'forbid' = 'ignore',
  dropped: Finding[] = [],
): ScoringCase {
  return { targets, findings, unlisted, dropped };
}

// ---------------------------------------------------------------------------
// linesIntersect — primitive boundary tests
// ---------------------------------------------------------------------------

describe('linesIntersect', () => {
  it('identical ranges intersect', () => {
    expect(linesIntersect(10, 20, 10, 20)).toBe(true);
  });

  it('fully contained range intersects', () => {
    expect(linesIntersect(10, 20, 12, 15)).toBe(true);
    expect(linesIntersect(12, 15, 10, 20)).toBe(true);
  });

  it('partially overlapping ranges intersect', () => {
    // [5,15] ∩ [10,20] = [10,15] — overlap on lines 10-15
    expect(linesIntersect(5, 15, 10, 20)).toBe(true);
    expect(linesIntersect(10, 20, 5, 15)).toBe(true);
  });

  it('touching ranges intersect (share exactly one line)', () => {
    // [1,10] and [10,20] share line 10
    expect(linesIntersect(1, 10, 10, 20)).toBe(true);
    expect(linesIntersect(10, 20, 1, 10)).toBe(true);
  });

  it('adjacent-by-one ranges do NOT intersect', () => {
    // [1,9] and [10,20] share zero lines
    expect(linesIntersect(1, 9, 10, 20)).toBe(false);
    expect(linesIntersect(10, 20, 1, 9)).toBe(false);
  });

  it('disjoint ranges do not intersect', () => {
    expect(linesIntersect(1, 5, 10, 15)).toBe(false);
    expect(linesIntersect(10, 15, 1, 5)).toBe(false);
  });

  it('single-line ranges on same line intersect', () => {
    expect(linesIntersect(5, 5, 5, 5)).toBe(true);
  });

  it('single-line ranges on different lines do not intersect', () => {
    expect(linesIntersect(5, 5, 6, 6)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// findingMatchesTarget — match rule
// ---------------------------------------------------------------------------

describe('findingMatchesTarget', () => {
  it('same file, identical range → match', () => {
    const f = mkFinding('src/a.ts', 10, 20);
    const t = mkTarget('must_find', 'src/a.ts', 10, 20);
    expect(findingMatchesTarget(f, t)).toBe(true);
  });

  it('different files → no match even if lines are identical', () => {
    const f = mkFinding('src/a.ts', 10, 20);
    const t = mkTarget('must_find', 'src/b.ts', 10, 20);
    expect(findingMatchesTarget(f, t)).toBe(false);
  });

  it('same file, touching ranges → match', () => {
    const f = mkFinding('src/a.ts', 1, 10);
    const t = mkTarget('must_find', 'src/a.ts', 10, 20);
    expect(findingMatchesTarget(f, t)).toBe(true);
  });

  it('same file, adjacent-by-one → no match', () => {
    const f = mkFinding('src/a.ts', 1, 9);
    const t = mkTarget('must_find', 'src/a.ts', 10, 20);
    expect(findingMatchesTarget(f, t)).toBe(false);
  });

  it('title/severity/category NOT matched — changing them does not affect match', () => {
    const f = mkFinding('src/a.ts', 10, 20);
    const t: EvalTarget = {
      kind: 'must_find',
      file: 'src/a.ts',
      start_line: 10,
      end_line: 20,
      source_finding_id: null,
      // deliberately different display fields
      severity: 'CRITICAL',
      category: 'security',
      title: 'Completely different title',
    };
    expect(findingMatchesTarget(f, t)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreCase — per-case scoring
// ---------------------------------------------------------------------------

describe('scoreCase — basic must_find', () => {
  it('finding matches must_find target → TP, pass', () => {
    const f = mkFinding('src/a.ts', 10, 20);
    const t = mkTarget('must_find', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([t], [f]));
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
    expect(result.recall_num).toBe(1);
    expect(result.recall_den).toBe(1);
    expect(result.pass).toBe(true);
    expect(result.missed).toHaveLength(0);
    expect(result.violations).toHaveLength(0);
  });

  it('no findings → all must_find targets missed, FN', () => {
    const t = mkTarget('must_find', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([t], []));
    expect(result.tp).toBe(0);
    expect(result.fp).toBe(0);
    expect(result.recall_num).toBe(0);
    expect(result.recall_den).toBe(1);
    expect(result.pass).toBe(false);
    expect(result.missed).toHaveLength(1);
  });

  it('must_find target not covered by any finding → missed (FN)', () => {
    const f = mkFinding('src/a.ts', 1, 5);
    const t = mkTarget('must_find', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([t], [f]));
    expect(result.missed).toContain(t);
    expect(result.pass).toBe(false);
  });
});

describe('scoreCase — must_not_flag', () => {
  it('finding matches must_not_flag → FP, violation, fail', () => {
    const f = mkFinding('src/a.ts', 10, 20);
    const t = mkTarget('must_not_flag', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([t], [f]));
    expect(result.fp).toBe(1);
    expect(result.tp).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.reason).toBe('must_not_flag');
    expect(result.violations[0]!.target).toBe(t);
    expect(result.violations[0]!.finding).toBe(f);
  });

  it('finding does NOT match must_not_flag (different file) → not FP under ignore', () => {
    const f = mkFinding('src/b.ts', 10, 20);
    const t = mkTarget('must_not_flag', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([t], [f]));
    expect(result.fp).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it('zero targets, no findings → pass (pure negative control in ignore mode)', () => {
    const result = scoreCase(mkCase([], []));
    expect(result.pass).toBe(true);
    expect(result.tp).toBe(0);
    expect(result.fp).toBe(0);
  });
});

describe('scoreCase — mixed must_find + must_not_flag', () => {
  it('must_not_flag wins over must_find when finding overlaps both', () => {
    // Finding at [10,20] overlaps both targets on the same file/range.
    const f = mkFinding('src/a.ts', 10, 20);
    const mf = mkTarget('must_find', 'src/a.ts', 10, 20);
    const mnf = mkTarget('must_not_flag', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([mf, mnf], [f]));
    // Resolved as must_not_flag → FP, not TP
    expect(result.tp).toBe(0);
    expect(result.fp).toBe(1);
    expect(result.recall_num).toBe(0); // must_find not matched
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.reason).toBe('must_not_flag');
    expect(result.missed).toContain(mf);
    expect(result.pass).toBe(false);
  });

  it('separate findings: one matches must_find, another matches must_not_flag', () => {
    const fGood = mkFinding('src/a.ts', 10, 20);
    const fBad = mkFinding('src/a.ts', 30, 40);
    const mf = mkTarget('must_find', 'src/a.ts', 10, 20);
    const mnf = mkTarget('must_not_flag', 'src/a.ts', 30, 40);
    const result = scoreCase(mkCase([mf, mnf], [fGood, fBad]));
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1);
    expect(result.recall_num).toBe(1);
    expect(result.recall_den).toBe(1);
    // pass = false because fp > 0
    expect(result.pass).toBe(false);
  });

  it('all must_find matched AND no must_not_flag triggered → pass', () => {
    const fGood = mkFinding('src/a.ts', 10, 20);
    const mf = mkTarget('must_find', 'src/a.ts', 10, 20);
    const mnf = mkTarget('must_not_flag', 'src/a.ts', 50, 60);
    const result = scoreCase(mkCase([mf, mnf], [fGood]));
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
    expect(result.pass).toBe(true);
  });
});

describe('scoreCase — one finding spanning multiple must_find targets = ONE TP', () => {
  it('single wide finding covers three must_find targets → tp=1, recall_num=3', () => {
    // Finding spans lines 1-100; three separate must_find targets all within that range.
    const f = mkFinding('src/a.ts', 1, 100);
    const t1 = mkTarget('must_find', 'src/a.ts', 10, 15);
    const t2 = mkTarget('must_find', 'src/a.ts', 30, 35);
    const t3 = mkTarget('must_find', 'src/a.ts', 50, 55);
    const result = scoreCase(mkCase([t1, t2, t3], [f]));
    // One finding → ONE TP (not three), but all three targets are matched.
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
    expect(result.recall_num).toBe(3);
    expect(result.recall_den).toBe(3);
    expect(result.missed).toHaveLength(0);
    expect(result.pass).toBe(true);
  });
});

describe('scoreCase — unlisted policy', () => {
  it("unlisted: 'ignore' — extra finding is NOT a FP", () => {
    const f = mkFinding('src/a.ts', 10, 20);
    const mf = mkTarget('must_find', 'src/a.ts', 30, 40);
    const result = scoreCase(mkCase([mf], [f], 'ignore'));
    // f matches no target; under 'ignore' it is not FP
    expect(result.fp).toBe(0);
    // mf was not matched → miss
    expect(result.missed).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
  });

  it("unlisted: 'forbid' with zero targets — every finding is FP (negative control)", () => {
    const f1 = mkFinding('src/a.ts', 10, 20);
    const f2 = mkFinding('src/b.ts', 1, 5);
    const result = scoreCase(mkCase([], [f1, f2], 'forbid'));
    // No targets, so both findings are unmatched FPs.
    expect(result.fp).toBe(2);
    expect(result.tp).toBe(0);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.violations.every((v) => v.reason === 'unlisted')).toBe(true);
    expect(result.violations.every((v) => v.target === null)).toBe(true);
  });

  it("unlisted: 'forbid' with no findings → pass (agent stayed quiet)", () => {
    const result = scoreCase(mkCase([], [], 'forbid'));
    expect(result.pass).toBe(true);
    expect(result.fp).toBe(0);
    expect(result.violations).toHaveLength(0);
  });

  it("unlisted: 'forbid' with must_find + extra unmatched finding — extra is FP (strict mode)", () => {
    const fGood = mkFinding('src/a.ts', 10, 20);
    const fExtra = mkFinding('src/a.ts', 50, 60);
    const mf = mkTarget('must_find', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([mf], [fGood, fExtra], 'forbid'));
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(1); // fExtra is unmatched in a 'forbid' case
    expect(result.recall_num).toBe(1);
    expect(result.pass).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.reason).toBe('unlisted');
  });

  it("unlisted: 'ignore' with extra unmatched findings → no violations, does not fail", () => {
    const fPlanted = mkFinding('src/a.ts', 10, 20);
    const fExtra1 = mkFinding('src/a.ts', 50, 60);
    const fExtra2 = mkFinding('src/b.ts', 1, 5);
    const mf = mkTarget('must_find', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([mf], [fPlanted, fExtra1, fExtra2], 'ignore'));
    expect(result.tp).toBe(1);
    expect(result.fp).toBe(0);
    expect(result.pass).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Empty denominator → null (never 0) — per-case and set-level
// ---------------------------------------------------------------------------

describe('empty denominators → null', () => {
  it('recall is null when no must_find targets exist', () => {
    // Only must_not_flag targets — recall denominator is 0
    const t = mkTarget('must_not_flag', 'src/a.ts', 10, 20);
    const result = scoreCase(mkCase([t], []));
    expect(result.recall_den).toBe(0);
    // At set level, recall must be null
    const set = scoreSet([result], [{ kept: 5, dropped: 0 }]);
    expect(set.recall).toBeNull();
  });

  it('precision is null when TP + FP === 0', () => {
    // No findings at all; must_find target unmatched → FN only, no TP, no FP
    const t = mkTarget('must_find', 'src/a.ts', 10, 20);
    const cs = scoreCase(mkCase([t], []));
    const set = scoreSet([cs], [{ kept: 0, dropped: 0 }]);
    expect(cs.tp).toBe(0);
    expect(cs.fp).toBe(0);
    expect(set.precision).toBeNull();
  });

  it('citation_accuracy is null when Σ(kept+dropped) === 0', () => {
    const cs = scoreCase(mkCase([], []));
    const set = scoreSet([cs], [{ kept: 0, dropped: 0 }]);
    expect(set.citation_accuracy).toBeNull();
  });

  it('all three are null for a pure negative-control set with no findings', () => {
    // Zero targets, forbid policy, no findings → passes but all metrics null
    const cs = scoreCase(mkCase([], [], 'forbid'));
    const set = scoreSet([cs], [{ kept: 0, dropped: 0 }]);
    expect(set.recall).toBeNull();
    expect(set.precision).toBeNull();
    expect(set.citation_accuracy).toBeNull();
    expect(set.cases_passed).toBe(1); // passes because no FP
  });
});

// ---------------------------------------------------------------------------
// citation_accuracy — computed from kept/dropped counts (not from scorer)
// ---------------------------------------------------------------------------

describe('citation_accuracy', () => {
  it('all findings kept → citation_accuracy = 1.0', () => {
    const set = scoreSet([], [{ kept: 5, dropped: 0 }]);
    expect(set.citation_accuracy).toBeCloseTo(1.0);
  });

  it('half kept → citation_accuracy = 0.5', () => {
    const set = scoreSet([], [{ kept: 4, dropped: 4 }]);
    expect(set.citation_accuracy).toBeCloseTo(0.5);
  });

  it('sums across multiple cases', () => {
    // Case 1: kept=3, dropped=1 → 3/4; Case 2: kept=1, dropped=1 → 1/2
    // Total: 4/6 ≈ 0.667
    const set = scoreSet([], [
      { kept: 3, dropped: 1 },
      { kept: 1, dropped: 1 },
    ]);
    expect(set.citation_accuracy).toBeCloseTo(4 / 6);
  });

  it('all findings dropped → citation_accuracy = 0 (not null)', () => {
    // Denominator > 0 (6), numerator 0 → 0.0, not null
    const set = scoreSet([], [{ kept: 0, dropped: 6 }]);
    expect(set.citation_accuracy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Set-level aggregation via scoreCases
// ---------------------------------------------------------------------------

describe('scoreCases — set-level aggregation', () => {
  it('two passing cases → cases_passed=2', () => {
    const mf1 = mkTarget('must_find', 'src/a.ts', 10, 20);
    const mf2 = mkTarget('must_find', 'src/b.ts', 5, 15);
    const case1 = mkCase([mf1], [mkFinding('src/a.ts', 10, 20)]);
    const case2 = mkCase([mf2], [mkFinding('src/b.ts', 5, 15)]);
    const set = scoreCases([case1, case2], [
      { kept: 2, dropped: 0 },
      { kept: 1, dropped: 1 },
    ]);
    expect(set.cases_passed).toBe(2);
    expect(set.cases_total).toBe(2);
    expect(set.recall).toBeCloseTo(1.0);
    expect(set.precision).toBeCloseTo(1.0);
    expect(set.citation_accuracy).toBeCloseTo(3 / 4);
  });

  it('mixed passing and failing cases → correct counts', () => {
    // Case 1: passes (must_find matched, no FP)
    const mf = mkTarget('must_find', 'src/a.ts', 10, 20);
    const case1 = mkCase([mf], [mkFinding('src/a.ts', 10, 20)]);
    // Case 2: fails (must_not_flag hit)
    const mnf = mkTarget('must_not_flag', 'src/b.ts', 5, 15);
    const case2 = mkCase([mnf], [mkFinding('src/b.ts', 5, 15)]);
    const set = scoreCases([case1, case2], [
      { kept: 1, dropped: 0 },
      { kept: 1, dropped: 0 },
    ]);
    expect(set.cases_passed).toBe(1);
    expect(set.cases_total).toBe(2);
    // recall: 1 must_find matched / 1 total → 1.0
    expect(set.recall).toBeCloseTo(1.0);
    // precision: tp=1, fp=1 → 0.5
    expect(set.precision).toBeCloseTo(0.5);
    expect(set.per_case).toHaveLength(2);
  });

  it('single must_not_flag case → recall is null at set level', () => {
    const mnf = mkTarget('must_not_flag', 'src/a.ts', 10, 20);
    const c = mkCase([mnf], []); // no findings, no FP
    const set = scoreCases([c], [{ kept: 0, dropped: 0 }]);
    expect(set.recall).toBeNull();
    expect(set.cases_passed).toBe(1); // passes: zero FP
  });

  it('recall counts targets not findings — finding spanning 3 targets = recall_num 3', () => {
    const f = mkFinding('src/a.ts', 1, 100);
    const t1 = mkTarget('must_find', 'src/a.ts', 10, 15);
    const t2 = mkTarget('must_find', 'src/a.ts', 30, 35);
    const t3 = mkTarget('must_find', 'src/a.ts', 50, 55);
    const c = mkCase([t1, t2, t3], [f]);
    const set = scoreCases([c], [{ kept: 1, dropped: 0 }]);
    // recall_num=3, recall_den=3 → 1.0
    expect(set.recall).toBeCloseTo(1.0);
    // tp=1 (one finding resolved), fp=0 → precision=1.0
    expect(set.precision).toBeCloseTo(1.0);
  });
});
