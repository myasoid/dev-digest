/**
 * Hermetic unit tests for PrBriefService — signal assembly + degrade paths,
 * against a fully mocked Container (no DB, no LLM, no network).
 *
 * Covers:
 *   AC-2  — exactly one structured LLM call per generation
 *   AC-11 — Intent/Blast absent → generates from what's present, records signals_used
 *   AC-12 — no linked issue / no matching specs → generates, marks those inputs absent
 *   AC-13 — signals_used reflects partial inputs
 */
import { describe, it, expect, vi } from 'vitest';
import type { Container } from '../../platform/container.js';
import type { PullRow } from '../reviews/repository.js';
import { PrBriefService } from './service.js';

const BRIEF_MODEL_OUTPUT = {
  what: 'Adds rate limiting to the refresh route.',
  why: 'Prevent abuse of an AI-generation endpoint.',
  risk_level: 'medium' as const,
  risks: [],
  review_focus: [],
};

function makePull(overrides: Partial<PullRow> = {}): PullRow {
  return {
    id: 'pr-1',
    workspaceId: 'ws-1',
    repoId: 'repo-1',
    number: 1,
    title: 'Add rate limiting',
    author: 'octocat',
    branch: 'feat/rate-limit',
    base: 'main',
    headSha: 'sha-current',
    body: null,
    additions: 10,
    deletions: 2,
    filesCount: 1,
    status: 'open',
    lastReviewedSha: null,
    openedAt: null,
    updatedAt: null,
    ...overrides,
  } as unknown as PullRow;
}

function makeDiff() {
  return {
    raw: '',
    files: [
      {
        path: 'src/rate-limit.ts',
        additions: 10,
        deletions: 2,
        hunks: [{ file: 'src/rate-limit.ts', oldStart: 1, oldLines: 0, newStart: 1, newLines: 10, newLineNumbers: [1] }],
      },
    ],
  };
}

/** A container satisfying everything PrBriefService AND the BlastService it
 *  constructs internally might touch. Individual tests override pieces. */
function makeContainer(overrides: {
  intent?: unknown;
  cachedBrief?: unknown;
  upsertBrief?: ReturnType<typeof vi.fn>;
  blastPr?: Record<string, unknown> | null;
  blastRepo?: Record<string, unknown> | null;
  llmResult?: unknown;
  ticketFetcherResolve?: ReturnType<typeof vi.fn>;
} = {}): Container {
  const upsertBrief = overrides.upsertBrief ?? vi.fn().mockResolvedValue(undefined);
  const completeStructured = vi.fn().mockResolvedValue({
    data: overrides.llmResult ?? BRIEF_MODEL_OUTPUT,
    tokensIn: 100,
    tokensOut: 50,
    costUsd: 0.01,
  });

  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn().mockResolvedValue([]),
        })),
      })),
    },
    reviewRepo: {
      getIntent: vi.fn().mockResolvedValue(overrides.intent),
      getBrief: vi.fn().mockResolvedValue(overrides.cachedBrief),
      upsertBrief,
      // Read by the internally-constructed BlastService.
      getPull: vi.fn().mockResolvedValue(overrides.blastPr ?? null),
      getRepo: vi.fn().mockResolvedValue(overrides.blastRepo ?? null),
      getPrFiles: vi.fn().mockResolvedValue([]),
    },
    repoIntel: {
      getBlastRadius: vi.fn().mockResolvedValue({
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: false,
      }),
      getIndexState: vi.fn().mockResolvedValue({ status: 'full', lastIndexedSha: 'sha-current', degraded: false }),
      getReverseImporters: vi.fn().mockResolvedValue({ files: new Map(), truncated: false }),
      getFactsForFiles: vi.fn().mockResolvedValue([]),
    },
    ticketFetcher: {
      resolve: overrides.ticketFetcherResolve ?? vi.fn().mockResolvedValue(null),
    },
    github: vi.fn().mockRejectedValue(new Error('no token')),
    llm: vi.fn().mockResolvedValue({ completeStructured }),
  } as unknown as Container;
}

describe('PrBriefService.getCached', () => {
  it('reads through to the repository, never calls the model', async () => {
    const container = makeContainer();
    const service = new PrBriefService(container);
    const brief = await service.getCached('pr-1');
    expect(container.reviewRepo.getBrief).toHaveBeenCalledWith('pr-1');
    expect(brief).toBeUndefined();
    expect(container.llm).not.toHaveBeenCalled();
  });
});

describe('PrBriefService.generate', () => {
  it('AC-2 — makes exactly one structured LLM call and persists keyed to the current head SHA', async () => {
    const container = makeContainer({
      intent: {
        intent: 'Adds rate limiting',
        in_scope: [],
        out_of_scope: [],
        confidence: 'high',
        signals_used: [],
        risk_areas: [],
        head_sha: 'sha-current',
      },
      blastPr: { id: 'pr-1', repoId: 'repo-1', headSha: 'sha-current', workspaceId: 'ws-1' },
      blastRepo: { id: 'repo-1' },
    });
    const service = new PrBriefService(container);
    const pull = makePull();
    const brief = await service.generate('ws-1', pull, { owner: 'acme', name: 'app', clonePath: null }, makeDiff() as never);

    const llmInstance = await (container.llm as unknown as (p: string) => Promise<{ completeStructured: ReturnType<typeof vi.fn> }>)('openai');
    expect(llmInstance.completeStructured).toHaveBeenCalledTimes(1);
    expect(brief.head_sha).toBe('sha-current');
    expect(container.reviewRepo.upsertBrief).toHaveBeenCalledWith('pr-1', expect.objectContaining({ head_sha: 'sha-current' }));
  });

  it('AC-11 — no cached Intent and no Blast map → still generates, records which inputs were used', async () => {
    const container = makeContainer({
      intent: undefined,
      blastPr: null, // BlastService.getBlastMap throws NotFoundError → degrade
    });
    const service = new PrBriefService(container);
    const pull = makePull({ body: null });
    const brief = await service.generate('ws-1', pull, { owner: 'acme', name: 'app', clonePath: null }, makeDiff() as never);

    expect(brief.signals_used).toContain('diff_shape');
    expect(brief.signals_used).not.toContain('intent');
    expect(brief.signals_used).not.toContain('blast');
    expect(container.reviewRepo.upsertBrief).toHaveBeenCalledTimes(1);
  });

  it('AC-12 — no linked issue and no matching specs resolve → still generates, marks those inputs absent', async () => {
    const container = makeContainer({
      blastPr: null,
      ticketFetcherResolve: vi.fn().mockResolvedValue(null),
    });
    const service = new PrBriefService(container);
    const pull = makePull({ body: 'See #999 and specs/does-not-exist.md for details.' });
    const brief = await service.generate('ws-1', pull, { owner: 'acme', name: 'app', clonePath: null }, makeDiff() as never);

    expect(brief.signals_used).toContain('body');
    expect(brief.signals_used.some((s) => s.startsWith('resolved:'))).toBe(false);
    expect(brief.signals_used.some((s) => s.startsWith('linked_issue:'))).toBe(false);
  });

  it('AC-13 — signals_used distinguishes a fully-present generation from a partial one', async () => {
    const fullContainer = makeContainer({
      intent: { intent: 'x', in_scope: [], out_of_scope: [], confidence: 'high', signals_used: [], risk_areas: [], head_sha: 'sha-current' },
      blastPr: { id: 'pr-1', repoId: 'repo-1', headSha: 'sha-current', workspaceId: 'ws-1' },
      blastRepo: { id: 'repo-1' },
    });
    const partialContainer = makeContainer({ intent: undefined, blastPr: null });

    const fullBrief = await new PrBriefService(fullContainer).generate(
      'ws-1',
      makePull({ body: null }),
      { owner: 'acme', name: 'app', clonePath: null },
      makeDiff() as never,
    );
    const partialBrief = await new PrBriefService(partialContainer).generate(
      'ws-1',
      makePull({ body: null }),
      { owner: 'acme', name: 'app', clonePath: null },
      makeDiff() as never,
    );

    expect(fullBrief.signals_used.length).toBeGreaterThan(partialBrief.signals_used.length);
  });
});
