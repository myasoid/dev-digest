import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC documented rules
// (reviewer-core/CLAUDE.md's "Purity is the contract" no-I/O rule, and its "grounding gate is
// mandatory" rule) that a competent model will describe in prose but will not spontaneously cite
// back to the source doc unless the agent forces a citation. This is the discriminating case for
// the strict-vs-lite A/B: both variants should FIND both problems, but only the strict variant
// (which keeps the "cite the exact documented rule per finding" hard rule) should reliably trace
// each finding back to the doc it violates. The checkout diff's textbook violations don't
// discriminate — the model names the violated rule either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
//
// Severity/verdict wording is intentionally agent-agnostic: architecture-reviewer uses this
// repo's canonical CRITICAL/WARNING/SUGGESTION scale + a "clean | concerns (<n> CRITICAL)"
// verdict (per pr-self-review's "one severity scale, do not invent a parallel one" rule), while
// architecture-reviewer-lite uses its own critical/high/medium/low/info scale + a PASS/FAIL gate.
// Both are legitimate, documented formats for their respective agents — practices below accept
// either instead of hard-coding one variant's vocabulary as ground truth for both.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      "names or clearly labels the violated rule for EVERY finding (e.g. 'inward-only dependency rule', 'DI discipline') rather than describing symptoms without saying which rule is broken",
      "assigns a severity to each finding using the agent's own documented scale (e.g. critical/high/medium/low/info, or CRITICAL/WARNING/SUGGESTION)",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit final verdict (e.g. PASS/FAIL, or clean/concerns) based on whether any critical- or high-severity findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not raise a runtime-bug, null-safety, or security finding about the optional `reply?: FastifyReply` parameter — citing it as part of the same inward-only-dependencies layering violation (domain signature referencing a framework type) is correct and expected, not a fabrication",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific documented rule for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      "traces the fs-import finding back to reviewer-core/CLAUDE.md's documented purity/no-I/O rule (e.g. 'Purity is the contract', 'no filesystem') rather than only describing the problem in generic prose",
      "traces the skipped-gate finding back to reviewer-core/CLAUDE.md's documented grounding-gate rule (e.g. 'the grounding gate is mandatory') rather than only describing the problem in generic prose",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "ends with an explicit final verdict (e.g. PASS/FAIL, or clean/concerns) based on whether any critical- or high-severity findings exist",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final verdict is a pass (e.g. PASS, or clean) with no blocking findings",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];
