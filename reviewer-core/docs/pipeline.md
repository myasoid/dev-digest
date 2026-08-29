# reviewer-core/docs/pipeline.md

Deep dive on how a diff becomes a grounded `Review` — the stage-by-stage
internals behind the diagram in `../README.md`. Read this (not the README)
before changing prompt assembly, map-reduce chunking, structured output, or
the grounding gate.

## Stages

1. **Mode selection** (`review/run.ts`, `selectMode`) — `strategy` defaults to
   `'auto'`: map-reduce runs only when the diff is **both** multi-file **and**
   its total added+deleted lines exceed `mapThresholdLines` (default
   `DEFAULT_MAP_THRESHOLD_LINES = 400`, which must be kept in sync by hand with
   the server's `FILE_MAP_THRESHOLD_LINES` — see `insights/gotchas.md`).
   `'single-pass'` / `'map-reduce'` force a path regardless, except map-reduce
   still degrades to single-pass for a 1-file diff.
2. **Prompt assembly** (`prompt.ts`, `assemblePrompt`) — sections render in a
   fixed order, each omitted entirely (not rendered empty) when absent: task
   line → PR description → PR intent → skills → memory → repo skeleton →
   project-context specs → callers-of-changed-symbols → diff. Skills are the
   one slot rendered as unfenced instructions; everything else untrusted (PR
   description, intent, repo map, specs, callers, diff) is
   `wrapUntrusted()`-fenced, covered by the single `INJECTION_GUARD` appended
   to the system message.
3. **Per-chunk LLM call** — single-pass sends the whole diff in one call;
   map-reduce calls once per file (`sliceDiff` extracts that file's hunks from
   the raw diff text, falling back to a synthesized stub if the raw text
   doesn't contain it) via `input.llm.completeStructured`, retried up to
   `maxRetries` (default `DEFAULT_REVIEW_MAX_RETRIES = 2`, kept in sync by hand
   with the server's `REVIEW_MAX_RETRIES`).
4. **Structured output** (`llm/structured.ts`) — `toJsonSchema` converts the
   Zod `Review` schema to JSON Schema for the provider's structured-output
   mode. `parseWithRepair` tries raw `JSON.parse` first and only falls back to
   `extractJson`'s fence/brace scanner on failure (brace-balancing can be
   fooled by a `{` or ` ``` ` that appears *inside* a JSON string value). On a
   schema mismatch it returns a `repromptMessage` for the caller to retry with,
   rather than failing the run outright.
5. **Reduce** (`review/reduce.ts`, `reduceReviews`) — a no-op passthrough for a
   single partial; otherwise concatenates findings, takes the worst verdict
   (`request_changes` > `comment` > `approve`), means the per-partial scores,
   and joins summaries.
6. **Grounding gate** (`grounding.ts`, `groundFindings`) — shared across both
   strategies, applied **once** to the reduced findings, never per-chunk. A
   finding survives only if its file is in the diff and its
   `[start_line, end_line]` range intersects a real hunk — except full-file
   scanner kinds (`secret_leak`, `lethal_trifecta`, `phantom`, `hook`), which
   only need the file present. Dropped findings carry a reason string for the
   trace; they never vanish silently.
7. **Scope check** (`grounding.ts`, `applyScopeDemotion`) — post-grounding, a
   no-op unless the caller supplies an Intent Layer `out_of_scope` list.
   Non-CRITICAL findings outside declared scope are dropped; CRITICAL ones are
   never silently dropped — they're pulled out and folded into a `riskAreas`
   summary string per file, so a real out-of-scope defect still surfaces
   without gating the PR.
8. **Deterministic score** (`review/reduce.ts`, `scoreFromFindings`) — the
   score returned to the caller is recomputed from the post-scope-check
   findings (`100 − Σ severity penalty`; CRITICAL 35 / WARNING 12 /
   SUGGESTION 3, floored at 0) — never the model's self-reported score.

## Output translation (`output/to-review.ts`)

Not part of the core pipeline — an optional CI/GitHub adapter over a finished
`Review`. `toReviewPayload` computes the GitHub review `event`
(APPROVE/COMMENT/REQUEST_CHANGES) deterministically from finding severities
against a `CiFailOn` gate (`never`/`critical`/`warning`/`any`), never from the
model's verdict. Inline comments anchor to a real diff line via
`resolveCommentLine` (the closest in-range diff line to `end_line`) to avoid
GitHub's `422 Line could not be resolved`; a finding with no resolvable line
stays in the summary body instead of being dropped.

## Not here

The pipeline diagram and public API — that's `../README.md`. Intent for
unbuilt slots — `../specs/`. Rejected approaches — `../INSIGHTS.md`. Known
pitfalls in the stages above — `../insights/gotchas.md`.
