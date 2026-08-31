/**
 * @devdigest/shared — single source of truth for cross-package contracts.
 *
 * Exports (Zod schemas + inferred TS types):
 *  - contracts/findings   Review, Finding, Severity, Verdict, FindingAction, trifecta
 *  - contracts/brief      Intent, SmartDiff, PrBrief (SPEC-cross-06 card:
 *                         what/why/risk_level/risks/review_focus)
 *  - contracts/knowledge  Conformance, Onboarding, EvalRun/EvalCase, MemoryItem,
 *                         Skill/CommunitySkill, ConventionCandidate, Agent
 *  - contracts/trace      RunTrace, RunEvent, RunLogLine (single-document trace)
 *  - contracts/platform   Settings, ConnTestResult, Repo, PrMeta/PrDetail, SpecFile, …
 *  - contracts/blast      DegradedReason, BlastChangedSymbol, BlastCallerRow,
 *                         BlastResult (repo-intel's getBlastRadius() facade
 *                         return type — NOT contracts/brief's `BlastRadius`)
 *  - contracts/pr-blast   BlastStatus, PrBlastSymbol, PrBlastTarget, PrBlastMap
 *                         (PR-scoped impact view — GET /pulls/:id/blast)
 *  - adapters             adapter interfaces + ModelInfo
 *
 * Feature agents (A1–A6) and F2 import everything from here. The barrel is
 * stable — feature agents EXTEND with new files, they do not edit existing ones.
 */

export * from './contracts/findings.js';
export * from './contracts/review-api.js';
export * from './contracts/brief.js';
export * from './contracts/knowledge.js';
export * from './contracts/trace.js';
export * from './contracts/platform.js';
export * from './contracts/why.js';
export * from './contracts/eval-ci.js';
export * from './contracts/observability.js';
export * from './contracts/productionize.js';
export * from './contracts/blast.js';
export * from './contracts/pr-blast.js';
export * from './contracts/eval-run.js';
export * from './adapters.js';
