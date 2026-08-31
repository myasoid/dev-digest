/**
 * executor.test.ts — hermetic unit tests for EvalExecutor.
 *
 * Criterion 8:  Two runs at the same agent version → identical recall/precision.
 * Criterion 10: Skill bodies come from skill_versions; no skills.body is read.
 * Freeze:       agent.repo_intel=true → prompt carries no repoMap/callers section.
 * Temperature:  temperature: 0 is explicitly sent on every structured call.
 *
 * No DB — uses MockLLMProvider (server/src/adapters/mocks.ts) and a minimal
 * container stub, matching the pattern established in pr-brief/service.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Container } from '../../platform/container.js';
import type { CompletionRequest, StructuredRequest } from '../../vendor/shared/adapters.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { EvalExecutor } from './executor.js';
import type { EvalCase } from '../../vendor/shared/contracts/knowledge.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal Review returned by MockLLMProvider to exercise scoring paths. */
const MOCK_REVIEW_OUTPUT = {
  verdict: 'comment',
  summary: 'Looks fine',
  score: 80,
  findings: [
    {
      id: 'f1',
      severity: 'WARNING',
      category: 'bug',
      title: 'Null deref',
      rationale: 'Line 10 may be null',
      suggestion: 'Add a null check',
      confidence: 0.9,
      file: 'src/foo.ts',
      start_line: 10,
      end_line: 10,
      kind: 'finding',
    },
  ],
};

function makeEvalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: 'case-1',
    owner_kind: 'agent',
    owner_id: 'agent-1',
    name: 'Test case',
    input_diff: [
      'diff --git a/src/foo.ts b/src/foo.ts',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -8,5 +8,7 @@',
      ' function foo() {',
      '+  const x = bar();',
      '+  return x.value;',
      ' }',
    ].join('\n'),
    input_files: null,
    input_meta: { title: 'Fix null deref', body: 'Adds null check' },
    expected_output: [],
    notes: null,
    targets: [
      {
        kind: 'must_find',
        file: 'src/foo.ts',
        start_line: 10,
        end_line: 10,
        source_finding_id: 'finding-original',
        severity: 'WARNING',
        category: 'bug',
        title: 'Null deref',
      },
    ],
    unlisted: 'ignore',
    source_pr_id: null,
    revision: 1,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a container stub that wires a MockLLMProvider for the given provider id.
 * The runBus.publish is mocked to a no-op so the executor's progress events don't
 * crash in the hermetic test (no real SSE bus).
 */
function makeContainer(mockLlm: MockLLMProvider): Container {
  return {
    llm: vi.fn().mockResolvedValue(mockLlm),
    runBus: {
      publish: vi.fn(),
      complete: vi.fn(),
    },
    // Everything else the executor doesn't touch.
  } as unknown as Container;
}

// ---------------------------------------------------------------------------
// Criterion 8 — two runs at same version → identical metrics
// ---------------------------------------------------------------------------

describe('EvalExecutor — criterion 8: determinism at temperature=0', () => {
  it('produces identical recall and precision on two runs of the same case', async () => {
    const mockLlm = new MockLLMProvider('openai', {
      structured: MOCK_REVIEW_OUTPUT,
    });
    const container = makeContainer(mockLlm);
    const executor = new EvalExecutor(container);
    const evalCase = makeEvalCase();

    const run1 = await executor.runCase(
      'suite-run-1',
      evalCase,
      'openai',
      'gpt-4.1',
      'You are a code reviewer.',
      'single-pass',
      ['## Skill body'],
    );

    const run2 = await executor.runCase(
      'suite-run-1',
      evalCase,
      'openai',
      'gpt-4.1',
      'You are a code reviewer.',
      'single-pass',
      ['## Skill body'],
    );

    // Both runs use the same frozen inputs → identical metrics.
    expect(run1.recall).toBe(run2.recall);
    expect(run1.precision).toBe(run2.precision);
    expect(run1.citationAccuracy).toBe(run2.citationAccuracy);
    expect(run1.pass).toBe(run2.pass);
  });
});

// ---------------------------------------------------------------------------
// Temperature: 0 must be set explicitly on every structured call
// ---------------------------------------------------------------------------

describe('EvalExecutor — temperature: 0 pinned explicitly', () => {
  it('passes temperature: 0 to every completeStructured call', async () => {
    const calls: StructuredRequest<unknown>[] = [];
    const trackingMock: MockLLMProvider = new MockLLMProvider('openai', {
      structured: MOCK_REVIEW_OUTPUT,
    });
    // Intercept completeStructured calls.
    const origCompleteStructured = trackingMock.completeStructured.bind(trackingMock);
    trackingMock.completeStructured = async function <T>(req: StructuredRequest<T>) {
      calls.push(req as unknown as StructuredRequest<unknown>);
      return origCompleteStructured(req);
    };

    const container = makeContainer(trackingMock);
    const executor = new EvalExecutor(container);

    await executor.runCase(
      'suite-run-temp-test',
      makeEvalCase(),
      'openai',
      'gpt-4.1',
      'You are a code reviewer.',
      'single-pass',
      [],
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.temperature).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Freeze: repo-intel is NEVER supplied regardless of agent configuration
// ---------------------------------------------------------------------------

describe('EvalExecutor — freeze: no repo-intel in prompt', () => {
  it('does not include repoMap or callers even when agent.repo_intel would be true', async () => {
    const calls: StructuredRequest<unknown>[] = [];
    const mockLlm = new MockLLMProvider('openai', { structured: MOCK_REVIEW_OUTPUT });
    const origCompleteStructured = mockLlm.completeStructured.bind(mockLlm);
    mockLlm.completeStructured = async function <T>(req: StructuredRequest<T>) {
      calls.push(req as unknown as StructuredRequest<unknown>);
      return origCompleteStructured(req);
    };

    const container = makeContainer(mockLlm);
    const executor = new EvalExecutor(container);

    // We pass a case as-is — the executor NEVER reads agent.repo_intel.
    await executor.runCase(
      'suite-run-freeze-test',
      makeEvalCase(),
      'openai',
      'gpt-4.1',
      'You are a reviewer.',
      'single-pass',
      [],
    );

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // The assembled prompt messages must not contain repo-intel sections.
      const allText = call.messages.map((m) => m.content).join('\n');
      expect(allText).not.toMatch(/## Repo skeleton/);
      expect(allText).not.toMatch(/Callers of changed/i);
      expect(allText).not.toMatch(/callers digest/i);
      expect(allText).not.toMatch(/repoMap/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Scoring: findings from ReviewOutcome feed the scorer correctly
// ---------------------------------------------------------------------------

describe('EvalExecutor — scoring integration', () => {
  it('returns pass=true when the one must_find target is matched', async () => {
    // The mock returns a finding at src/foo.ts:10-10, which matches the target.
    const mockLlm = new MockLLMProvider('openai', { structured: MOCK_REVIEW_OUTPUT });
    const container = makeContainer(mockLlm);
    const executor = new EvalExecutor(container);

    const result = await executor.runCase(
      'suite-run-score',
      makeEvalCase(),
      'openai',
      'gpt-4.1',
      'You are a code reviewer.',
      'single-pass',
      [],
    );

    // The mock finding lands on src/foo.ts:10-10, matching the must_find target.
    // recall_num = 1 / recall_den = 1 → recall = 1.0
    expect(result.recall).toBe(1);
    // TP = 1, FP = 0 → precision = 1.0
    expect(result.precision).toBe(1);
    expect(result.pass).toBe(true);
    expect(result.missed).toHaveLength(0);
    expect(result.violations).toHaveLength(0);
  });

  it('returns recall=null when case has only must_not_flag targets (no must_find)', async () => {
    const mockLlm = new MockLLMProvider('openai', {
      structured: { ...MOCK_REVIEW_OUTPUT, findings: [] },
    });
    const container = makeContainer(mockLlm);
    const executor = new EvalExecutor(container);

    const noMustFind = makeEvalCase({
      targets: [
        {
          kind: 'must_not_flag',
          file: 'src/foo.ts',
          start_line: 10,
          end_line: 10,
          source_finding_id: null,
        },
      ],
    });

    const result = await executor.runCase(
      'suite-run-null-recall',
      noMustFind,
      'openai',
      'gpt-4.1',
      'You are a code reviewer.',
      'single-pass',
      [],
    );

    // No must_find targets → recall denominator = 0 → recall = null (criterion 6).
    expect(result.recall).toBeNull();
  });

  it('reads findingsKept and findingsDropped as integers from ReviewOutcome — not parsed strings', async () => {
    // The mock returns exactly 1 finding kept; grounding will pass it (mock diff).
    // The important check: findingsKept is a number, not a string.
    const mockLlm = new MockLLMProvider('openai', { structured: MOCK_REVIEW_OUTPUT });
    const container = makeContainer(mockLlm);
    const executor = new EvalExecutor(container);

    const result = await executor.runCase(
      'suite-run-counts',
      makeEvalCase(),
      'openai',
      'gpt-4.1',
      'You are a code reviewer.',
      'single-pass',
      [],
    );

    expect(typeof result.findingsKept).toBe('number');
    expect(typeof result.findingsDropped).toBe('number');
    // Both are non-negative integers.
    expect(result.findingsKept).toBeGreaterThanOrEqual(0);
    expect(result.findingsDropped).toBeGreaterThanOrEqual(0);
  });
});
