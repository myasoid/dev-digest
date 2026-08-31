import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { pullRequests } from './pulls';

// ============================================================ Eval / Conformance / Compose

// ---------------------------------------------------------------------------
// eval_suite_runs — one row per set-level run (gap 1 fix)
//
// A "suite run" is one execution of the full eval set (all cases for one owner
// at one agent version). It holds the set-level aggregates: recall, precision,
// citation_accuracy, cases_passed / cases_total, and the EvalRunInputs triple
// that makes comparability a field check rather than an assumption (gap 5).
//
// workspace_id FK is stored here (not derived via case FK) so dashboard queries
// can filter by workspace without joining through eval_cases.
// ---------------------------------------------------------------------------

export const evalSuiteRuns = pgTable(
  'eval_suite_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    // owner — no FK by design: owner_kind='agent' → agents.id, owner_kind='skill'
    // → skills.id. Mixed FK cannot be expressed as a single column reference;
    // application layer enforces referential integrity.
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    // EvalRunInputs flattened — everything that determined the run's output.
    agentVersion: integer('agent_version').notNull(),
    skillVersions: jsonb('skill_versions').notNull().$type<
      Array<{ skill_id: string; version: number }>
    >(),
    caseSetRevision: text('case_set_revision').notNull(),
    // Run metadata
    scope: text('scope', { enum: ['suite', 'case'] }).notNull().default('suite'),
    status: text('status', { enum: ['running', 'succeeded', 'failed', 'cancelled'] })
      .notNull()
      .default('running'),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    // Set-level aggregates
    casesTotal: integer('cases_total').notNull().default(0),
    casesPassed: integer('cases_passed').notNull().default(0),
    // Nullable — empty denominators MUST stay null, never coerced to 0.
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    // Raw grounding counts (read from ReviewOutcome at run time, never parsed
    // from display strings — INSIGHTS.md, What Doesn't Work, 2026-08-29).
    findingsKept: integer('findings_kept').notNull().default(0),
    findingsDropped: integer('findings_dropped').notNull().default(0),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    error: text('error'),
  },
  (t) => ({
    // Dashboard queries filter by workspace_id and owner_id — index both.
    wsIdx: index('eval_suite_runs_ws_idx').on(t.workspaceId),
    ownerIdx: index('eval_suite_runs_owner_idx').on(t.ownerId),
  }),
);

// ---------------------------------------------------------------------------
// eval_cases — one frozen (input_diff + targets) per case
// ---------------------------------------------------------------------------

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    inputDiff: text('input_diff'),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    // expected_output holds EvalTarget[] (narrowed meaning — was z.unknown()).
    // The typed view is on the EvalCase contract's `targets` field.
    expectedOutput: jsonb('expected_output'),
    notes: text('notes'),
    // ---- Phase 1 additions ----
    // What to do with a grounded finding that matches no target.
    // 'ignore' (default): extra findings are not FP.
    // 'forbid': every unmatched finding counts as FP (strict / negative control).
    unlisted: text('unlisted', { enum: ['ignore', 'forbid'] }).notNull().default('ignore'),
    // The PR this case was minted from. set null on delete — a case must outlive
    // the PR (deleting the PR must not silently shrink the regression set).
    sourcePrId: uuid('source_pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
    // Bumps only on measurement-affecting edits (input_diff, targets, unlisted).
    // Renames / notes do NOT bump it — trend line must not break on cosmetic edits.
    revision: integer('revision').notNull().default(1),
    createdAt: now(),
  },
  (t) => ({
    // Case queries filter by source_pr_id (fold rule) and owner_id (list by agent).
    sourcePrIdx: index('eval_cases_source_pr_idx').on(t.sourcePrId),
  }),
);

// ---------------------------------------------------------------------------
// eval_runs — one row per case per suite run
// ---------------------------------------------------------------------------

export const evalRuns = pgTable(
  'eval_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    // ---- Phase 1 additions ----
    // Which suite run this case row belongs to.
    suiteRunId: uuid('suite_run_id')
      .notNull()
      .references(() => evalSuiteRuns.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    actualOutput: jsonb('actual_output'),
    pass: boolean('pass'),
    recall: doublePrecision('recall'),
    precision: doublePrecision('precision'),
    citationAccuracy: doublePrecision('citation_accuracy'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
    // Grounding counts — read from ReviewOutcome as integers, never parsed from strings.
    findingsKept: integer('findings_kept').notNull().default(0),
    findingsDropped: integer('findings_dropped').notNull().default(0),
    // Which revision of the case this row measured (gap 6: trend break point).
    caseRevision: integer('case_revision').notNull().default(1),
    // False-positive violations: must_not_flag hits and unlisted-forbid hits.
    violations: jsonb('violations'),
  },
  (t) => ({
    // Dashboard per-case queries filter by suite_run_id — Postgres does NOT
    // auto-index FK columns, so this must be explicit (Architectural Constraints).
    suiteRunIdx: index('eval_runs_suite_run_idx').on(t.suiteRunId),
  }),
);

// ---------------------------------------------------------------------------
// Conformance / Compose (unchanged)
// ---------------------------------------------------------------------------

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
