# reviewer-core/insights/gotchas.md

Known pitfalls in this engine and the non-obvious reason each exists. Check
here when something behaves unexpectedly before assuming it's a bug — the
cited path has the full reasoning in a code comment.

- **The grounding gate is mandatory and cannot be bypassed per-agent.** A
  finding whose `[start_line, end_line]` doesn't intersect a real diff hunk is
  dropped, no matter how confident the model is. Don't add an opt-out — it's
  the only thing standing between the engine and hallucinated locations.
  `src/grounding.ts` (`groundFindings`).
- **Full-file finding kinds skip the line-range check.** `secret_leak`,
  `lethal_trifecta`, `phantom`, `hook` findings only need their file present in
  the diff — whole-file scanners don't have a single changed line to cite.
  `src/grounding.ts` (`FULL_FILE_KINDS`).
- **The score is never the model's.** Both the pipeline's returned score
  (`scoreFromFindings`) and the CI review event (`toReviewPayload`'s `event`)
  are recomputed deterministically from surviving-finding severities. A model
  claiming "approve" alongside a CRITICAL finding still produces
  `REQUEST_CHANGES`. `src/review/reduce.ts`, `src/output/to-review.ts`.
- **Skills are the one prompt slot NOT wrapped in `<untrusted>`.** Every other
  slot (diff, PR description, intent, repo map, specs, callers) is
  `wrapUntrusted()`-fenced; skills render as plain instructions. This is
  deliberate — a fenced skill would fall under `INJECTION_GUARD` and could
  never change a review, defeating the point of a skill. The trust boundary is
  upstream: the server only resolves *enabled* skills into bodies before they
  reach this package. `src/prompt.ts` (`PromptParts.skills`).
- **`out_of_scope` matching is a plain substring test, not a glob or a model
  judgment.** `applyScopeDemotion` does case-insensitive substring matching in
  either direction between a finding's file and each declared out-of-scope
  entry — the same "mechanical gate, not a trusted model" philosophy as
  grounding. `src/grounding.ts` (`isOutOfDeclaredScope`).
- **`DEFAULT_MAP_THRESHOLD_LINES` and `DEFAULT_REVIEW_MAX_RETRIES` are copies,
  not imports, of server constants.** They must be kept in sync by hand with
  `FILE_MAP_THRESHOLD_LINES` / `REVIEW_MAX_RETRIES` in `server/` — this
  package can't import server config without breaking purity.
  `src/review/run.ts`.
- **`parseWithRepair` tries raw `JSON.parse` before the fence/brace scanner.**
  `extractJson`'s brace-balancing can be fooled by a `{` or a ` ``` ` fence
  that appears *inside* a JSON string value (e.g. markdown in a finding's
  `suggestion`) — it's only a fallback for providers that don't return pure
  JSON. `src/llm/structured.ts`.
- **Token estimates are character-based (`ceil(chars / 4)`) on purpose, not a
  real tokenizer.** The only bundled encoder (`cl100k_base`) is wrong for the
  DeepSeek/Anthropic models this repo actually runs; the estimate exists to
  explain a size delta, not to be exact — the run's real `tokensIn`/`tokensOut`
  sits next to it in the trace. `src/prompt.ts` (`estimateTokens`).
- **Inline GitHub comments can move or vanish, on purpose.**
  `resolveCommentLine` anchors to the closest diff line within a finding's
  range rather than the raw `end_line`, because `end_line` itself may be an
  unchanged line and posting there 422s the **whole** review. A finding with
  no resolvable line stays in the summary body instead of erroring.
  `src/output/to-review.ts`.

## Not here

Decisions and rejected approaches, with dates — that's `../INSIGHTS.md`. This
file is the standing shortlist of pitfalls; `INSIGHTS.md` is the dated history
behind them.
