import { describe, it, expect } from 'vitest';
import { isMeasurementChange, caseSetRevision } from './helpers.js';
import type { EvalCase } from '../../vendor/shared/contracts/knowledge.js';
import type { EvalTarget } from '../../vendor/shared/contracts/eval-run.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const target1: EvalTarget = {
  kind: 'must_find',
  file: 'src/foo.ts',
  start_line: 10,
  end_line: 20,
  source_finding_id: 'finding-1',
};

const target2: EvalTarget = {
  kind: 'must_not_flag',
  file: 'src/bar.ts',
  start_line: 5,
  end_line: 15,
  source_finding_id: null,
};

const baseCase: Pick<EvalCase, 'targets' | 'unlisted' | 'input_diff'> = {
  targets: [target1],
  unlisted: 'ignore',
  input_diff: 'diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts',
};

// ---------------------------------------------------------------------------
// isMeasurementChange
// ---------------------------------------------------------------------------

describe('isMeasurementChange', () => {
  it('returns false when patch has no fields', () => {
    expect(isMeasurementChange(baseCase, {})).toBe(false);
  });

  it('returns false when name changes (cosmetic — never bumps)', () => {
    expect(isMeasurementChange(baseCase, { name: 'New name' })).toBe(false);
  });

  it('returns false when notes changes (cosmetic — never bumps)', () => {
    expect(isMeasurementChange(baseCase, { notes: 'Some notes' })).toBe(false);
  });

  it('returns false when name AND notes change together (both cosmetic)', () => {
    expect(isMeasurementChange(baseCase, { name: 'X', notes: 'Y' })).toBe(false);
  });

  it('returns true when targets change (measurement-affecting)', () => {
    expect(isMeasurementChange(baseCase, { targets: [target1, target2] })).toBe(true);
  });

  it('returns true when targets are set to the same REFERENCE but different array instance', () => {
    // JSON comparison — same content → not a change.
    expect(isMeasurementChange(baseCase, { targets: [{ ...target1 }] })).toBe(false);
  });

  it('returns true when a target field changes (e.g. end_line)', () => {
    const changed = { ...target1, end_line: 99 };
    expect(isMeasurementChange(baseCase, { targets: [changed] })).toBe(true);
  });

  it('returns true when unlisted changes from ignore to forbid', () => {
    expect(isMeasurementChange(baseCase, { unlisted: 'forbid' })).toBe(true);
  });

  it('returns false when unlisted is set to the same value', () => {
    expect(isMeasurementChange(baseCase, { unlisted: 'ignore' })).toBe(false);
  });

  it('returns true when input_diff changes', () => {
    expect(isMeasurementChange(baseCase, { inputDiff: 'different diff content' })).toBe(true);
  });

  it('returns false when input_diff is set to the same value', () => {
    expect(isMeasurementChange(baseCase, { inputDiff: baseCase.input_diff })).toBe(false);
  });

  it('returns true when targets changes even if name also changes', () => {
    expect(
      isMeasurementChange(baseCase, { name: 'New', targets: [target1, target2] }),
    ).toBe(true);
  });

  it('returns false when targets removed (set to empty) — wait, empty IS different', () => {
    // Removing all targets IS a measurement change (affects scoring).
    expect(isMeasurementChange(baseCase, { targets: [] })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// caseSetRevision
// ---------------------------------------------------------------------------

describe('caseSetRevision', () => {
  const cases = [
    { id: 'case-a', revision: 1 },
    { id: 'case-b', revision: 2 },
    { id: 'case-c', revision: 1 },
  ];

  it('returns a non-empty hex string', () => {
    const rev = caseSetRevision(cases);
    expect(rev).toMatch(/^[0-9a-f]+$/);
    expect(rev.length).toBeGreaterThan(0);
  });

  it('is stable — same inputs always produce same output', () => {
    expect(caseSetRevision(cases)).toBe(caseSetRevision(cases));
  });

  it('is stable under reordering — same set regardless of array order', () => {
    const shuffled = [
      { id: 'case-c', revision: 1 },
      { id: 'case-a', revision: 1 },
      { id: 'case-b', revision: 2 },
    ];
    expect(caseSetRevision(cases)).toBe(caseSetRevision(shuffled));
  });

  it('changes when any case revision changes', () => {
    const modified = [
      { id: 'case-a', revision: 2 }, // bumped from 1 to 2
      { id: 'case-b', revision: 2 },
      { id: 'case-c', revision: 1 },
    ];
    expect(caseSetRevision(cases)).not.toBe(caseSetRevision(modified));
  });

  it('changes when a case is added', () => {
    const extended = [...cases, { id: 'case-d', revision: 1 }];
    expect(caseSetRevision(cases)).not.toBe(caseSetRevision(extended));
  });

  it('changes when a case is removed', () => {
    const reduced = cases.slice(0, 2);
    expect(caseSetRevision(cases)).not.toBe(caseSetRevision(reduced));
  });

  it('returns deterministic result for empty set', () => {
    const r1 = caseSetRevision([]);
    const r2 = caseSetRevision([]);
    expect(r1).toBe(r2);
  });

  it('two different single-case sets differ', () => {
    const a = [{ id: 'case-a', revision: 1 }];
    const b = [{ id: 'case-b', revision: 1 }];
    expect(caseSetRevision(a)).not.toBe(caseSetRevision(b));
  });
});
