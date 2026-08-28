import { describe, it, expect } from 'vitest';
import { resolveEffectiveContextDocs } from './context-docs.js';

/**
 * Pure resolver unit tests — no I/O. Covers the ordering/dedup/tiebreak rules
 * `run-executor.ts` relies on (AC-26, AC-27, AC-28, EC-17, NFR-8).
 */
describe('resolveEffectiveContextDocs', () => {
  it('orders agent-direct documents first, in their configured order', () => {
    const result = resolveEffectiveContextDocs(
      [
        { path: 'specs/second.md', order: 1 },
        { path: 'specs/first.md', order: 0 },
      ],
      [],
    );
    expect(result).toEqual(['specs/first.md', 'specs/second.md']);
  });

  it('places each linked skill\'s documents after the agent\'s, in the AGENT\'s skill order', () => {
    const result = resolveEffectiveContextDocs(
      [{ path: 'specs/agent-doc.md', order: 0 }],
      [
        [{ path: 'docs/skill-a.md', order: 0 }],
        [{ path: 'docs/skill-b.md', order: 0 }],
      ],
    );
    expect(result).toEqual(['specs/agent-doc.md', 'docs/skill-a.md', 'docs/skill-b.md']);
  });

  it('dedups a path reached both directly and through a skill, keeping the EARLIEST position (AC-27)', () => {
    const result = resolveEffectiveContextDocs(
      [{ path: 'specs/shared.md', order: 0 }],
      [[{ path: 'specs/shared.md', order: 0 }, { path: 'docs/only-skill.md', order: 1 }]],
    );
    expect(result).toEqual(['specs/shared.md', 'docs/only-skill.md']);
  });

  it('excludes a globally disabled skill entirely — the caller never passes its links (AC-28)', () => {
    // The disabled skill's links are simply absent from the input, mirroring
    // how run-executor only ever resolves links for `enabledSkillsForPrompt`'s
    // output.
    const result = resolveEffectiveContextDocs([], [[{ path: 'docs/enabled-only.md', order: 0 }]]);
    expect(result).toEqual(['docs/enabled-only.md']);
  });

  it('breaks a tie on `order` by path, so two identical configurations resolve identically (EC-17, NFR-8)', () => {
    const result = resolveEffectiveContextDocs(
      [
        { path: 'specs/b.md', order: 0 },
        { path: 'specs/a.md', order: 0 },
      ],
      [],
    );
    expect(result).toEqual(['specs/a.md', 'specs/b.md']);
  });

  it('returns [] when nothing is attached anywhere', () => {
    expect(resolveEffectiveContextDocs([], [])).toEqual([]);
  });
});
