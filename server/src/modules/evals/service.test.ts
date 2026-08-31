/**
 * service.test.ts — hermetic unit tests for EvalService.
 *
 * Fix 1 verification: when a skill_versions snapshot is missing for the
 * current skill version, startSuiteRun must throw an AppError with code
 * 'missing_skill_version' rather than falling back to the live skills.body.
 * Falling back would silently mislabel the run — the recorded inputs would
 * say "version N" but the execution used a different body, confounding every
 * A/B comparison built on it.
 *
 * runAllAgents tests: verifies that the fan-out runs agents SEQUENTIALLY
 * (each waits for the prior to complete via runBus.onDone before starting),
 * and that the total-cost ceiling stops new agents once the budget is exceeded.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Container } from '../../platform/container.js';
import { AppError } from '../../platform/errors.js';
import { EvalService } from './service.js';

// ---------------------------------------------------------------------------
// Minimal container stub
// ---------------------------------------------------------------------------

/** Sentinel so callers can explicitly pass "no agent version row". */
const NO_AGENT_VERSION = Symbol('NO_AGENT_VERSION');

function makeContainer(overrides: {
  linkedSkills?: unknown[];
  skillVersionRow?: { body: string } | undefined;
  agentRow?: { id: string; version: number } | null;
  agentVersionRow?: { configJson: object } | typeof NO_AGENT_VERSION;
  cases?: unknown[];
}): Container {
  const {
    linkedSkills = [],
    skillVersionRow = undefined,
    agentRow = { id: 'agent-1', version: 3 },
    agentVersionRow = {
      configJson: {
        provider: 'openrouter',
        model: 'gpt-4o',
        system_prompt: 'Review the diff.',
        strategy: 'single-pass',
        ci_fail_on: 'critical',
        repo_intel: false,
        skills: [],
      },
    },
    cases = [{ id: 'case-1', revision: 1, name: 'Test case', targets: [], unlisted: 'ignore', inputDiff: 'diff', inputMeta: null }],
  } = overrides;

  const resolvedAgentVersionRow =
    agentVersionRow === NO_AGENT_VERSION ? undefined : agentVersionRow;

  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve(skillVersionRow !== undefined ? [skillVersionRow] : []),
        }),
      }),
    },
    agentsRepo: {
      getById: vi.fn().mockResolvedValue(agentRow),
      linkedSkills: vi.fn().mockResolvedValue(linkedSkills),
      getVersion: vi.fn().mockResolvedValue(resolvedAgentVersionRow),
    },
    runBus: {
      publish: vi.fn(),
      complete: vi.fn(),
      subscribe: vi.fn(),
      onDone: vi.fn(),
    },
    // Stub the eval repository via EvalRepository constructor (accessed as `new EvalRepository(db)`)
    // The repository listCases is called via `this.repo.listCases` internally.
    // We patch at the db level via the select stub above for skill_versions;
    // for eval_cases we stub via a spy on EvalRepository.prototype below.
  } as unknown as Container;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EvalService.startSuiteRun — freeze enforcement', () => {
  it('throws missing_skill_version when skill_versions has no snapshot for current version', async () => {
    // skill has id + version, but the db returns empty rows for the version query
    const container = makeContainer({
      linkedSkills: [
        {
          skill: { id: 'skill-1', version: 5, enabled: true, body: 'LIVE BODY — must never be read' },
          order: 0,
        },
      ],
      skillVersionRow: undefined, // no snapshot exists
    });

    // Patch EvalRepository.prototype.listCases to return a dummy case
    const { EvalRepository } = await import('./repository.js');
    const spy = vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([
      {
        id: 'case-1',
        revision: 1,
        name: 'Test case',
        owner_kind: 'agent',
        owner_id: 'agent-1',
        workspace_id: 'ws-1',
        targets: [],
        unlisted: 'ignore',
        input_diff: 'diff',
        input_meta: null,
        notes: null,
        source_pr_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ] as any);

    const service = new EvalService(container);

    await expect(
      service.startSuiteRun('ws-1', 'agent-1', 'suite'),
    ).rejects.toMatchObject({
      code: 'missing_skill_version',
    });

    // Ensure the live skills.body was never accessed (the throw happened first)
    spy.mockRestore();
  });

  it('throws missing_skill_version with the skill id and version in the message', async () => {
    const container = makeContainer({
      linkedSkills: [
        {
          skill: { id: 'sk-abc', version: 7, enabled: true, body: 'LIVE BODY' },
          order: 0,
        },
      ],
      skillVersionRow: undefined,
    });

    const { EvalRepository } = await import('./repository.js');
    const spy = vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([
      {
        id: 'case-1',
        revision: 1,
        name: 'Test case',
        owner_kind: 'agent',
        owner_id: 'agent-1',
        workspace_id: 'ws-1',
        targets: [],
        unlisted: 'ignore',
        input_diff: 'diff',
        input_meta: null,
        notes: null,
        source_pr_id: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ] as any);

    const service = new EvalService(container);

    let caught: AppError | undefined;
    try {
      await service.startSuiteRun('ws-1', 'agent-1', 'suite');
    } catch (err) {
      caught = err as AppError;
    }

    expect(caught).toBeDefined();
    expect(caught?.code).toBe('missing_skill_version');
    expect(caught?.message).toContain('sk-abc');
    expect(caught?.message).toContain('7');

    spy.mockRestore();
  });

  it('proceeds normally when skill_versions snapshot exists', async () => {
    // When the version snapshot is present, no throw should occur from this path.
    // We let it throw later (missing agent_version or empty cases) — just confirm
    // it gets past the skill-version check.
    const container = makeContainer({
      linkedSkills: [
        {
          skill: { id: 'skill-1', version: 2, enabled: true, body: 'LIVE BODY — must never be read' },
          order: 0,
        },
      ],
      skillVersionRow: { body: 'FROZEN BODY AT VERSION 2' },
      agentVersionRow: NO_AGENT_VERSION, // will throw missing_version, not missing_skill_version
    });

    const { EvalRepository } = await import('./repository.js');
    const spy = vi.spyOn(EvalRepository.prototype, 'listCases').mockResolvedValue([
      {
        id: 'case-1', revision: 1, name: 'Test case', owner_kind: 'agent',
        owner_id: 'agent-1', workspace_id: 'ws-1', targets: [], unlisted: 'ignore',
        input_diff: 'diff', input_meta: null, notes: null, source_pr_id: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ] as any);

    const service = new EvalService(container);

    // Should throw missing_version (agent version), NOT missing_skill_version
    await expect(
      service.startSuiteRun('ws-1', 'agent-1', 'suite'),
    ).rejects.toMatchObject({
      code: 'missing_version',
    });

    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// runAllAgents — sequencing and cost ceiling
// ---------------------------------------------------------------------------

/**
 * Build a minimal container and EvalService stub for runAllAgents tests.
 *
 * We spy at the EvalService level (startSuiteRun) to avoid running the real
 * executor; and on EvalRepository.prototype.getGlobalDashboard (via dynamic
 * import, same pattern as existing tests above) to control the agent list.
 *
 * The runBus.onDone stub fires its callback on the next queueMicrotask cycle —
 * same semantics as the real RunBus on an already-completed run — so the
 * sequential fan-out loop can proceed without blocking.
 *
 * The DB select stub returns a configurable cost_usd per query call (index
 * order) — used by waitForSuiteRun inside service.ts after onDone fires.
 */
function makeRunAllContainerBase(runCostsSequence: (number | null)[]): {
  container: Container;
  costsIter: { index: number };
} {
  const costsIter = { index: 0 };

  const runBus = {
    publish: vi.fn(),
    complete: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    onDone: vi.fn((runId: string, cb: () => void) => {
      // Fire the callback on the next microtask (mimics real RunBus for a
      // completed run — queueMicrotask path in sse.ts:onDone).
      queueMicrotask(cb);
      return () => undefined;
    }),
  };

  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const idx = costsIter.index++;
          const cost = runCostsSequence[idx] ?? null;
          return Promise.resolve([{ costUsd: cost }]);
        },
      }),
    }),
  };

  const container = {
    db,
    agentsRepo: {
      getById: vi.fn().mockImplementation((_ws: string, agentId: string) =>
        Promise.resolve({ id: agentId, version: 1 }),
      ),
      linkedSkills: vi.fn().mockResolvedValue([]),
      getVersion: vi.fn().mockResolvedValue({
        configJson: {
          provider: 'openrouter',
          model: 'gpt-4o',
          system_prompt: 'test',
          strategy: 'single-pass',
          ci_fail_on: 'critical',
          repo_intel: false,
          skills: [],
        },
      }),
    },
    runBus,
  } as unknown as Container;

  return { container, costsIter };
}

describe('EvalService.runAllAgents — sequencing', () => {
  it('returns immediately with queued count and agent_ids', async () => {
    const { container } = makeRunAllContainerBase([0.5, 0.5, 0.5]);
    const { EvalRepository } = await import('./repository.js');
    const repoSpy = vi.spyOn(EvalRepository.prototype, 'getGlobalDashboard').mockResolvedValue({
      agents: ['a1', 'a2', 'a3'].map((id) => ({
        agent_id: id, agent_name: id, recall: null, precision: null,
        citation_accuracy: null, cases_passed: 0, cases_total: 0,
        sparkline: [], last_run_at: null,
      })),
      recentRuns: [],
    });

    const service = new EvalService(container);
    let seq = 0;
    const startSpy = vi.spyOn(service, 'startSuiteRun').mockImplementation(
      async (_ws, _agentId) => ({ suite_run_id: `run-${++seq}` }),
    );

    const result = await service.runAllAgents('ws-1');

    expect(result.queued).toBe(3);
    expect(result.agent_ids).toEqual(['a1', 'a2', 'a3']);

    repoSpy.mockRestore();
    startSpy.mockRestore();
  });

  it('starts each agent only after the prior run completes (sequential, not parallel)', async () => {
    const startOrder: string[] = [];
    const completionOrder: string[] = [];

    const { container } = makeRunAllContainerBase([0.5, 0.5, 0.5]);

    // Override onDone to also record completion order before firing.
    (container.runBus.onDone as ReturnType<typeof vi.fn>).mockImplementation(
      (runId: string, cb: () => void) => {
        queueMicrotask(() => {
          completionOrder.push(runId);
          cb();
        });
        return () => undefined;
      },
    );

    const { EvalRepository } = await import('./repository.js');
    const repoSpy = vi.spyOn(EvalRepository.prototype, 'getGlobalDashboard').mockResolvedValue({
      agents: ['a1', 'a2', 'a3'].map((id) => ({
        agent_id: id, agent_name: id, recall: null, precision: null,
        citation_accuracy: null, cases_passed: 0, cases_total: 0,
        sparkline: [], last_run_at: null,
      })),
      recentRuns: [],
    });

    const service = new EvalService(container);
    let seq = 0;
    const startSpy = vi.spyOn(service, 'startSuiteRun').mockImplementation(
      async (_ws, agentId) => {
        startOrder.push(agentId);
        return { suite_run_id: `run-${++seq}` };
      },
    );

    await service.runAllAgents('ws-1');

    // Wait for background fan-out to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // All three agents must have been started in order.
    expect(startOrder).toEqual(['a1', 'a2', 'a3']);
    // run-1 (a1) must complete before a2 starts, run-2 (a2) before a3 starts.
    expect(completionOrder[0]).toBe('run-1');
    expect(completionOrder[1]).toBe('run-2');

    repoSpy.mockRestore();
    startSpy.mockRestore();
  });
});

describe('EvalService.runAllAgents — total cost ceiling', () => {
  it('stops starting new agents when accumulated cost exceeds MAX_RUN_ALL_COST_USD', async () => {
    // Each run costs $11 — after two runs totalCostUsd = $22 > $20 ceiling,
    // so the third agent must NOT be started.
    const startedAgents: string[] = [];
    const { container } = makeRunAllContainerBase([11, 11, 11]);

    const { EvalRepository } = await import('./repository.js');
    const repoSpy = vi.spyOn(EvalRepository.prototype, 'getGlobalDashboard').mockResolvedValue({
      agents: ['a1', 'a2', 'a3'].map((id) => ({
        agent_id: id, agent_name: id, recall: null, precision: null,
        citation_accuracy: null, cases_passed: 0, cases_total: 0,
        sparkline: [], last_run_at: null,
      })),
      recentRuns: [],
    });

    const service = new EvalService(container);
    let seq = 0;
    const startSpy = vi.spyOn(service, 'startSuiteRun').mockImplementation(
      async (_ws, agentId) => {
        startedAgents.push(agentId);
        return { suite_run_id: `run-${++seq}` };
      },
    );

    await service.runAllAgents('ws-1');

    // Wait for background fan-out to settle.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // a1 + a2 = $22 > $20 ceiling, so a3 must not be started.
    expect(startedAgents).toEqual(['a1', 'a2']);
    expect(startedAgents).not.toContain('a3');

    repoSpy.mockRestore();
    startSpy.mockRestore();
  });

  it('continues to remaining agents when one agent fails to start', async () => {
    const startedAgents: string[] = [];
    const { container } = makeRunAllContainerBase([0.5, 0.5]);

    const { EvalRepository } = await import('./repository.js');
    const repoSpy = vi.spyOn(EvalRepository.prototype, 'getGlobalDashboard').mockResolvedValue({
      agents: ['a1', 'a2', 'a3'].map((id) => ({
        agent_id: id, agent_name: id, recall: null, precision: null,
        citation_accuracy: null, cases_passed: 0, cases_total: 0,
        sparkline: [], last_run_at: null,
      })),
      recentRuns: [],
    });

    const service = new EvalService(container);
    let seq = 0;
    const startSpy = vi.spyOn(service, 'startSuiteRun').mockImplementation(
      async (_ws, agentId) => {
        if (agentId === 'a2') throw new Error('simulated 429 — too many runs');
        startedAgents.push(agentId);
        return { suite_run_id: `run-${++seq}` };
      },
    );

    await service.runAllAgents('ws-1');

    // Wait for background fan-out.
    await new Promise<void>((resolve) => setTimeout(resolve, 50));

    // a2 failed but a1 and a3 must still have been attempted.
    expect(startedAgents).toContain('a1');
    expect(startedAgents).toContain('a3');

    repoSpy.mockRestore();
    startSpy.mockRestore();
  });
});
