/**
 * Hermetic unit tests for blast/service.ts pure helpers.
 *
 * Tests coverage for spec acceptance criteria:
 *   AC1 — per-symbol cap: 47 callers for sym A + 3 for sym B → both shown
 *   AC2 — partial index status propagation
 *   AC3 — staleness detection and explanation
 *   AC4 — degraded path (flag off / no index) returns status 'degraded'
 *   AC5 — depth-2 endpoint discovery (integration-level; see blast.it.test.ts)
 *   AC8 — counts reflect post-cap reality
 *
 * No DB — every function under test is pure or constructed with container mocks.
 */
import { describe, it, expect, vi } from 'vitest';
import type { BlastCallerRow, BlastChangedSymbol } from '@devdigest/shared';
import {
  buildSymbols,
  deriveStatus,
  deriveExplanation,
  MAX_SYMBOLS,
  MAX_CALLERS_PER_SYMBOL,
  BlastService,
} from './service.js';
import type { Container } from '../../platform/container.js';

// ---------------------------------------------------------------------------
// buildSymbols
// ---------------------------------------------------------------------------

function makeCaller(viaSymbol: string, rank: number, suffix = ''): BlastCallerRow {
  return {
    file: `src/caller${suffix}.ts`,
    symbol: `callerFn${suffix}`,
    viaSymbol,
    line: 10,
    rank,
  };
}

function makeSymbol(name: string, file = 'src/a.ts'): BlastChangedSymbol {
  return { file, name, kind: 'function' };
}

describe('buildSymbols', () => {
  it('AC1 — callerCount is the true pre-cap total (47), truncated is exact', () => {
    const symbols = [makeSymbol('processPayment'), makeSymbol('validateUser')];
    // repo-intel already capped: 20 callers for A (of 47 total), 3 for B.
    const callersForA: BlastCallerRow[] = Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) =>
      makeCaller('processPayment', 0.9 - i * 0.01, String(i)),
    );
    const callersForB: BlastCallerRow[] = Array.from({ length: 3 }, (_, i) =>
      makeCaller('validateUser', 0.5 - i * 0.01, `b${i}`),
    );
    // callerCounts carries the pre-cap totals as threaded from tryPersistentBlast.
    const callerCounts = { processPayment: 47, validateUser: 3 };

    const result = buildSymbols(symbols, [...callersForA, ...callersForB], callerCounts);

    expect(result.cappedSymbols).toHaveLength(2);
    const symA = result.cappedSymbols.find((s) => s.name === 'processPayment');
    const symB = result.cappedSymbols.find((s) => s.name === 'validateUser');

    expect(symA).toBeDefined();
    expect(symA!.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL); // 20 shown
    const countA = result.perSymbolCallerCounts.get('processPayment');
    expect(countA).toBeDefined();
    expect(countA!.total).toBe(47);        // true pre-cap total, not 20
    expect(countA!.truncated).toBe(true);  // 47 > 20

    expect(symB).toBeDefined();
    expect(symB!.callers).toHaveLength(3);
    const countB = result.perSymbolCallerCounts.get('validateUser');
    expect(countB!.total).toBe(3);
    expect(countB!.truncated).toBe(false); // 3 == 3, not truncated

    expect(result.symbolsTruncated).toBe(false);
  });

  it('exactly MAX_CALLERS_PER_SYMBOL callers — NOT truncated when callerCounts says 20', () => {
    // This is the case the old >= guess got wrong: exactly 20 callers is not a cap hit.
    const symbols = [makeSymbol('exactFn')];
    const callers: BlastCallerRow[] = Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) =>
      makeCaller('exactFn', 0.9 - i * 0.01, String(i)),
    );
    // callerCounts says the pre-cap total was exactly 20 — not truncated.
    const callerCounts = { exactFn: MAX_CALLERS_PER_SYMBOL };

    const result = buildSymbols(symbols, callers, callerCounts);
    const count = result.perSymbolCallerCounts.get('exactFn');
    expect(count!.total).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(count!.truncated).toBe(false); // 20 == 20, exact match: not truncated
  });

  it('no callerCounts (degraded path) — truncated is always false', () => {
    // Ripgrep/degraded path has no cap, so truncated must never be true.
    const symbols = [makeSymbol('ripgrepFn')];
    const callers: BlastCallerRow[] = Array.from({ length: MAX_CALLERS_PER_SYMBOL }, (_, i) =>
      makeCaller('ripgrepFn', 0.9 - i * 0.01, String(i)),
    );
    // No callerCounts — simulates the degraded path.
    const result = buildSymbols(symbols, callers, undefined);
    const count = result.perSymbolCallerCounts.get('ripgrepFn');
    expect(count!.total).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(count!.truncated).toBe(false); // degraded path: no cap applied
  });

  it('caps symbols at MAX_SYMBOLS (50), setting symbolsTruncated', () => {
    const symbols = Array.from({ length: MAX_SYMBOLS + 5 }, (_, i) =>
      makeSymbol(`sym${i}`, `src/file${i}.ts`),
    );
    const result = buildSymbols(symbols, []);
    expect(result.cappedSymbols).toHaveLength(MAX_SYMBOLS);
    expect(result.symbolsTruncated).toBe(true);
    expect(result.symbolCapHit).toBe(true);
  });

  it('symbol with no callers gets callerCount 0 and truncated false', () => {
    const symbols = [makeSymbol('lonelyFn')];
    const callerCounts = { lonelyFn: 0 };
    const result = buildSymbols(symbols, [], callerCounts);
    expect(result.cappedSymbols[0]!.callers).toHaveLength(0);
    const count = result.perSymbolCallerCounts.get('lonelyFn');
    expect(count!.total).toBe(0);
    expect(count!.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deriveStatus
// ---------------------------------------------------------------------------

describe('deriveStatus', () => {
  it('AC2 — partial index → status partial', () => {
    expect(deriveStatus(true, false, false)).toBe('partial');
  });

  it('AC3 — stale (indexedSha !== headSha) → status partial', () => {
    expect(deriveStatus(false, true, false)).toBe('partial');
  });

  it('any cap hit → status partial', () => {
    expect(deriveStatus(false, false, true)).toBe('partial');
  });

  it('no condition → ok', () => {
    expect(deriveStatus(false, false, false)).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// deriveExplanation
// ---------------------------------------------------------------------------

describe('deriveExplanation', () => {
  it('AC4 — flag_off degraded explanation matches MCP tool wording', () => {
    const exp = deriveExplanation('degraded', 'flag_off', false, null, false, false, false);
    expect(exp).toContain('REPO_INTEL_ENABLED');
    expect(exp).toContain('off');
  });

  it('AC4 — non-flag_off degraded includes reason and retry instructions', () => {
    const exp = deriveExplanation('degraded', 'no_data', false, null, false, false, false);
    expect(exp).toContain('no_data');
    expect(exp).toContain('resync');
  });

  it('AC3 — stale explanation names the short SHA', () => {
    const exp = deriveExplanation('partial', null, false, 'a1b2c3defgh', false, false, false);
    expect(exp).toContain('a1b2c3d'); // short form (7 chars)
  });

  it('AC2 — partial index explanation names the condition', () => {
    const exp = deriveExplanation('partial', null, true, null, false, false, false);
    expect(exp.toLowerCase()).toContain('partial');
  });

  it('caller cap explanation names the cap', () => {
    const exp = deriveExplanation('partial', null, false, null, false, false, true);
    expect(exp).toContain(String(MAX_CALLERS_PER_SYMBOL));
  });

  it('symbol cap explanation names the cap', () => {
    const exp = deriveExplanation('partial', null, false, null, true, false, false);
    expect(exp).toContain(String(MAX_SYMBOLS));
  });

  it('traversal truncation explanation mentions 200-file cap', () => {
    const exp = deriveExplanation('partial', null, false, null, false, true, false);
    expect(exp).toContain('200');
  });

  it('multiple conditions produce a combined explanation', () => {
    const exp = deriveExplanation('partial', null, true, 'sha123abcde', false, false, true);
    expect(exp).toContain('sha123a'); // stale SHA
    expect(exp).toContain('partial'); // partial index
    expect(exp).toContain(String(MAX_CALLERS_PER_SYMBOL)); // caller cap
  });
});

// ---------------------------------------------------------------------------
// BlastService — integration with mocked container (AC4, AC8)
// ---------------------------------------------------------------------------

function makeContainer(overrides: {
  pr?: Record<string, unknown> | null;
  repo?: Record<string, unknown> | null;
  prFiles?: Array<{ path: string }>;
  blastResult?: Record<string, unknown>;
  indexState?: Record<string, unknown>;
  reverseImporters?: { files: Map<string, number>; truncated: boolean };
  factsForFiles?: Array<{ filePath: string; endpoints: string[]; crons: string[] }>;
}): Container {
  return {
    reviewRepo: {
      getPull: vi.fn().mockResolvedValue(overrides.pr ?? null),
      getRepo: vi.fn().mockResolvedValue(overrides.repo ?? null),
      getPrFiles: vi.fn().mockResolvedValue(overrides.prFiles ?? []),
    },
    repoIntel: {
      getBlastRadius: vi.fn().mockResolvedValue(
        overrides.blastResult ?? {
          changedSymbols: [],
          callers: [],
          impactedEndpoints: [],
          degraded: false,
        },
      ),
      getIndexState: vi.fn().mockResolvedValue(
        overrides.indexState ?? {
          status: 'full',
          lastIndexedSha: 'abc1234',
          degraded: false,
        },
      ),
      getReverseImporters: vi.fn().mockResolvedValue(
        overrides.reverseImporters ?? { files: new Map(), truncated: false },
      ),
      getFactsForFiles: vi.fn().mockResolvedValue(overrides.factsForFiles ?? []),
    },
  } as unknown as Container;
}

describe('BlastService.getBlastMap', () => {
  it('AC4 — degraded blast result → status degraded, never empty symbols meaning "no index"', async () => {
    const container = makeContainer({
      pr: { id: 'pr-1', repoId: 'repo-1', headSha: 'aaa', workspaceId: 'ws-1' },
      repo: { id: 'repo-1' },
      prFiles: [{ path: 'src/payments.ts' }],
      blastResult: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'flag_off',
      },
      indexState: { status: 'degraded', lastIndexedSha: '', degraded: true, degradedReason: 'flag_off' },
    });

    const service = new BlastService(container);
    const result = await service.getBlastMap('ws-1', 'pr-1');

    expect(result.status).toBe('degraded');
    expect(result.reason).toBe('flag_off');
    expect(result.explanation).toContain('REPO_INTEL_ENABLED');
    // Never an empty symbols array meaning "no index" — status: 'degraded' is the signal
    expect(result.symbols).toEqual([]);
  });

  it('AC2 — partial index state → status partial', async () => {
    const container = makeContainer({
      pr: { id: 'pr-1', repoId: 'repo-1', headSha: 'abc1234', workspaceId: 'ws-1' },
      repo: { id: 'repo-1' },
      prFiles: [{ path: 'src/a.ts' }],
      blastResult: {
        changedSymbols: [{ file: 'src/a.ts', name: 'doThing', kind: 'function' }],
        callers: [],
        impactedEndpoints: [],
        degraded: false,
      },
      indexState: { status: 'partial', lastIndexedSha: 'abc1234', degraded: false },
    });

    const service = new BlastService(container);
    const result = await service.getBlastMap('ws-1', 'pr-1');

    expect(result.status).toBe('partial');
    expect(result.explanation).not.toBeNull();
    expect(result.explanation!.toLowerCase()).toContain('partial');
  });

  it('AC3 — stale SHA → stale: true, explanation names indexed SHA', async () => {
    const container = makeContainer({
      pr: { id: 'pr-1', repoId: 'repo-1', headSha: 'newsha999', workspaceId: 'ws-1' },
      repo: { id: 'repo-1' },
      prFiles: [{ path: 'src/a.ts' }],
      blastResult: {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: false,
      },
      indexState: { status: 'full', lastIndexedSha: 'oldsha1234abc', degraded: false },
    });

    const service = new BlastService(container);
    const result = await service.getBlastMap('ws-1', 'pr-1');

    expect(result.stale).toBe(true);
    expect(result.status).toBe('partial');
    expect(result.indexedSha).toBe('oldsha1234abc');
    expect(result.explanation).toContain('oldsha1'); // short form
  });

  it('AC8 — counts reflect post-cap reality', async () => {
    const container = makeContainer({
      pr: { id: 'pr-1', repoId: 'repo-1', headSha: 'abc1234', workspaceId: 'ws-1' },
      repo: { id: 'repo-1' },
      prFiles: [{ path: 'src/a.ts' }],
      blastResult: {
        changedSymbols: [
          { file: 'src/a.ts', name: 'symA', kind: 'function' },
          { file: 'src/a.ts', name: 'symB', kind: 'function' },
        ],
        callers: [
          { file: 'src/c.ts', symbol: 'callFn', viaSymbol: 'symA', line: 5, rank: 0.9 },
          { file: 'src/d.ts', symbol: 'other', viaSymbol: 'symB', line: 8, rank: 0.7 },
        ],
        impactedEndpoints: [],
        degraded: false,
        factsByFile: {
          'src/c.ts': { endpoints: ['GET /api/data'], crons: [] },
        },
      },
      indexState: { status: 'full', lastIndexedSha: 'abc1234', degraded: false },
      factsForFiles: [{ filePath: 'src/c.ts', endpoints: ['GET /api/data'], crons: [] }],
    });

    const service = new BlastService(container);
    const result = await service.getBlastMap('ws-1', 'pr-1');

    expect(result.counts.symbols).toBe(2);
    expect(result.counts.callers).toBe(2);
    expect(result.status).toBe('ok');
  });

  it('throws NotFoundError when PR not found', async () => {
    const container = makeContainer({ pr: null });
    const service = new BlastService(container);
    await expect(service.getBlastMap('ws-1', 'pr-missing')).rejects.toThrow('Pull request not found');
  });
});
