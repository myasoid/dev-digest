import { reviewPullRequest } from '@devdigest/reviewer-core';
import type { LLMProvider, Provider } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import type { EvalCase } from '../../vendor/shared/contracts/knowledge.js';
import type { EvalTarget, EvalViolation } from '../../vendor/shared/contracts/eval-run.js';
import type { CaseScore, CitationInput } from './scoring.js';
import { scoreCase } from './scoring.js';

/**
 * EvalExecutor — the frozen replay engine.
 *
 * This class is NOT a reuse of ReviewRunExecutor. It has one job: replay a
 * frozen eval case against a specific agent version and return scored results.
 *
 * Freeze contract (criteria 8/9/10/13/14):
 *   - diff:           parseUnifiedDiff(case.input_diff) — nothing else
 *   - systemPrompt/model/strategy: from agent_versions.config_json at the
 *                     version being run — NEVER the live agents row
 *   - skill bodies:   from skill_versions at the skill's version as of run start
 *                     — NEVER skills.body (the live row)
 *   - repo-intel:     NOT supplied, unconditionally, regardless of agent.repo_intel
 *   - temperature:    pinned to 0 EXPLICITLY via a wrapping provider
 *
 * Creates NO reviews, findings, or agent_runs rows.
 * Streams progress over container.runBus.
 */

export interface CaseRunResult {
  caseId: string;
  caseRevision: number;
  pass: boolean | null;
  recall: number | null;
  precision: number | null;
  citationAccuracy: number | null;
  durationMs: number;
  costUsd: number | null;
  findingsKept: number;
  findingsDropped: number;
  violations: EvalViolation[];
  missed: EvalTarget[];
  score: CaseScore;
  citationInput: CitationInput;
}

export interface SkillVersionRecord {
  skill_id: string;
  version: number;
  body: string;
}

export interface ExecutorRunInputs {
  agentVersion: number;
  skillVersionRecords: SkillVersionRecord[];
  caseSetRevision: string;
}

/**
 * Wrap an LLMProvider so every completeStructured call uses temperature: 0.
 *
 * The plan notes that openai.ts and anthropic.ts both default to `?? 0.2` when
 * temperature is omitted; openrouter.ts defaults to `?? 0`. An eval run MUST
 * be deterministic, so we pin explicitly and record it.
 */
function withTemperatureZero(llm: LLMProvider): LLMProvider {
  return {
    ...llm,
    async completeStructured(req) {
      return llm.completeStructured({ ...req, temperature: 0 });
    },
    async complete(req) {
      return llm.complete({ ...req, temperature: 0 });
    },
  };
}

export class EvalExecutor {
  constructor(private container: Container) {}

  /**
   * Run a single eval case against the given agent version and skill bodies.
   * Never touches reviews/findings/agent_runs tables.
   *
   * @param suiteRunId Used for runBus progress streaming only — no DB writes.
   * @param evalCase   The frozen case to replay.
   * @param provider   Provider id for this agent version (from config_json).
   * @param model      Model id from config_json.
   * @param systemPrompt From config_json — NEVER from the live agents row.
   * @param strategy   Review strategy from config_json.
   * @param skillBodies Resolved skill bodies — from skill_versions, NOT skills.body.
   */
  async runCase(
    suiteRunId: string,
    evalCase: EvalCase,
    provider: Provider,
    model: string,
    systemPrompt: string,
    strategy: 'single-pass' | 'map-reduce' | 'auto',
    skillBodies: string[],
  ): Promise<CaseRunResult> {
    const start = Date.now();

    // Parse the frozen diff. Repo-intel is NEVER supplied — no repoMap, no
    // callers, no intent, no specs — regardless of any agent flag.
    // (The freeze diagram: repoMap/callers/intent/specs → NEVER)
    const diff = parseUnifiedDiff(evalCase.input_diff);

    // Resolve the LLM provider from the container, then wrap it to pin
    // temperature: 0 explicitly (criterion 8 — two runs at same version must
    // produce identical results; temperature drift is the primary source of
    // non-determinism).
    const rawLlm = await this.container.llm(provider);
    const llm = withTemperatureZero(rawLlm);

    // Extract PR meta from input_meta (task/prDescription only).
    const meta = (evalCase.input_meta ?? {}) as Record<string, unknown>;
    const prDescription = typeof meta.body === 'string' ? meta.body : undefined;
    const prTitle = typeof meta.title === 'string' ? meta.title : undefined;
    const task = prTitle ? `Review PR: ${prTitle}` : undefined;

    // Emit progress to the run bus (for the SSE route).
    this.container.runBus.publish(suiteRunId, 'info', `Eval case "${evalCase.name}" starting`);

    const outcome = await reviewPullRequest({
      systemPrompt,
      model,
      diff,
      llm,
      strategy,
      // Skill bodies from skill_versions — the frozen snapshot. Never skills.body.
      ...(skillBodies.length > 0 ? { skills: skillBodies } : {}),
      // NO repo-intel: repoMap, callers, memory, specs are unconditionally absent.
      // This is the freeze. The executor never reads agent.repo_intel.
      ...(prDescription ? { prDescription } : {}),
      ...(task ? { task } : {}),
      sessionId: `eval:${suiteRunId}:${evalCase.id}`,
      onEvent: (e) => this.container.runBus.publish(suiteRunId, e.kind, e.msg, e.data),
    });

    const durationMs = Date.now() - start;

    // Read findings_kept / findings_dropped as integers from ReviewOutcome.
    // NEVER parse a "n/m passed" display string (criterion 14 / INSIGHTS.md).
    const findingsKept = outcome.review.findings.length;
    const findingsDropped = outcome.dropped.length;

    // Score the case against the frozen targets.
    const targets = evalCase.targets;
    const caseScore = scoreCase({
      targets,
      unlisted: evalCase.unlisted,
      findings: outcome.review.findings,
      dropped: outcome.dropped.map((d) => d.finding),
    });

    // Citation accuracy inputs — raw counts from ReviewOutcome.
    const citationInput: CitationInput = { kept: findingsKept, dropped: findingsDropped };

    // Compute per-metric values (null for empty denominators).
    const recall =
      caseScore.recall_den === 0 ? null : caseScore.recall_num / caseScore.recall_den;
    const precision =
      caseScore.tp + caseScore.fp === 0 ? null : caseScore.tp / (caseScore.tp + caseScore.fp);
    const citationAccuracy =
      findingsKept + findingsDropped === 0
        ? null
        : findingsKept / (findingsKept + findingsDropped);

    this.container.runBus.publish(
      suiteRunId,
      'result',
      `Eval case "${evalCase.name}": pass=${caseScore.pass}, recall=${recall}, precision=${precision}`,
    );

    return {
      caseId: evalCase.id,
      caseRevision: evalCase.revision,
      pass: caseScore.pass,
      recall,
      precision,
      citationAccuracy,
      durationMs,
      costUsd: outcome.costUsd,
      findingsKept,
      findingsDropped,
      violations: caseScore.violations,
      missed: caseScore.missed,
      score: caseScore,
      citationInput,
    };
  }
}
