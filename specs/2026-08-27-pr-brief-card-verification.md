# PR Brief card — Compliance Report (SPEC-cross-06)

Produced by `plan-verifier`, run against
`specs/2026-08-27-pr-brief-card-plan.md` and
`specs/2026-08-27-pr-brief-card.md`'s Acceptance criteria, on 2026-08-27.
Companion to the plan file — this is the verification record, not a plan.

## Reference material

- Development Plan: `specs/2026-08-27-pr-brief-card-plan.md`
- Implementation Report: the `implementer` run that executed the plan
  (2026-08-27), including a post-implementation fix that moved
  `resolvePrAndRepo` out of `routes.ts` and into `PrBriefService`
- Spec Acceptance criteria: `specs/2026-08-27-pr-brief-card.md` (AC-1…AC-15)
- Diff inspected: `git diff dfa905a545594035a68f8a88dd696590ed1a1b98` (37
  files, all committed on `HW_L05`) plus direct reads of every new file it
  lists. `specs/2026-08-27-pr-brief-card.md`, `specs/2026-08-27-pr-brief-card-
  plan.md`, `.claude/pr-review/**`, `server/INSIGHTS.md`,
  `server/docs/pr-brief.md` and `client/docs/pr-brief-card.md` were excluded
  from scope-creep evaluation (session artifacts / doc-writer output, not
  implementation).

## Compliance matrix — Development Plan steps

| Step | Verdict | Evidence |
| --- | --- | --- |
| 1 — repurpose `PrBrief` contract | Met | `server/src/vendor/shared/contracts/brief.ts:104-153` |
| 2 — propagate to client vendor | Met | byte-identical to server copy; `scripts/check-contracts.sh` → `contracts in sync` |
| 3 — nullable `headSha` column + migration | Met | `server/src/db/schema/reviews.ts:75-78`, `server/src/db/migrations/0016_omniscient_supreme_intelligence.sql:1` |
| 4 — `upsertBrief`/`getBrief` | Met | `server/src/modules/reviews/repository/pull.repo.ts:93-112`, `repository.ts:154-162` |
| 5 — `pr-brief-signals.ts` pure helpers | Met | `server/src/modules/pr-brief/pr-brief-signals.ts:31-198`; 11/11 hermetic tests |
| 6 — `PrBriefService` | Met | `server/src/modules/pr-brief/service.ts:46-212`; 5/5 hermetic tests |
| 7 — routes + module registration | Met | `server/src/modules/pr-brief/routes.ts:21-53`, `modules/index.ts:14,42`; `pr-brief.it.test.ts` 5/5 against real testcontainers Postgres |
| 8 — `usePrBrief`/`useRefreshBrief` | Met | `client/src/lib/hooks/reviews.ts:255-270` |
| 9 — `PrBriefCard` + tests | Met | `PrBriefCard.tsx:1-291`; 8 RTL tests pass |
| 10 — `next-intl` message keys | Met | `client/messages/en/brief.json:1-38` |
| 11 — mount in `OverviewTab.tsx` | Met | `OverviewTab.tsx:40-49`, before `panelGrid` at line 52 |

## Compliance matrix — Spec Acceptance criteria (AC-1…AC-15)

| AC | Verdict | Evidence |
| --- | --- | --- |
| AC-1 — cached GET, never generated → `null`, no LLM call | Met | `routes.ts:26-35`; `pr-brief.it.test.ts:111-123` |
| AC-2 — refresh → exactly one LLM call, persisted at head SHA | Met | `service.ts:160-180`; `pr-brief.it.test.ts:135-157`, `service.test.ts:128-150` |
| AC-3 — SHA match → serve cache, no LLM call | Met | `service.ts:58-60`; `service.test.ts:116-125` |
| AC-4 — SHA differs → mark stale | Met | `PrBriefCard.tsx:221`; `PrBriefCard.test.tsx:144-154` |
| AC-5 — 429 on rate-limit excess | Met | `routes.ts:44`; `pr-brief.it.test.ts:176-196` |
| AC-6 — LLM output shape exact, no score/verdict/cost/tokens | Met | `pr-brief-signals.ts:31-38`; `server/test/contracts.test.ts:73-108` |
| AC-7 — grounding filter drops ungrounded refs | Met | `pr-brief-signals.ts:189-198`; `pr-brief-signals.test.ts:101-169` |
| AC-8 — diff stats/shape only, never line content | Met | `pr-brief-signals.test.ts:192-208` |
| AC-9 — review-focus links pinned to brief's stored SHA | Met (via RTL, not e2e — see Could not verify) | `PrBriefCard.tsx:279`; `PrBriefCard.test.tsx:128-142` |
| AC-10 — risk_level as text, not colour-only | Met | `PrBriefCard.tsx:244-246`; `PrBriefCard.test.tsx:107-108` |
| AC-11 — degrade when Intent/Blast absent | Met | `service.ts:94-109`; `pr-brief.it.test.ts:159-174`, `service.test.ts:152-165` |
| AC-12 — degrade when no issue/specs | Met | `service.ts:111-143`; `service.test.ts:167-179` |
| AC-13 — partial-inputs indicator | Met | `PrBriefCard.tsx:226,252-256`; `PrBriefCard.test.tsx:156-166` |
| AC-14 — no-brief empty state with Generate control | Met (via RTL, not e2e — see Could not verify) | `PrBriefCard.tsx:203-219`; `PrBriefCard.test.tsx:71-93` |
| AC-15 — untrusted wrapping + ignore-instructions prompt | Met | `pr-brief-signals.ts:82-158`; `pr-brief-signals.test.ts:172-190` |

## Deviation verification — post-implementation architecture fix

Confirmed fully applied: `routes.ts`/`service.ts` carry no `drizzle-orm` or
`db/schema` import. `resolvePrAndRepo` lives in `service.ts:67-73`, going
through `ReviewRepository.getPull`/`getRepo` — `routes.ts` stays
transport-only, consistent with `blast/routes.ts`'s precedent.

## Independently re-run verification

- server: `pnpm typecheck` clean; hermetic suite 230/230; `pr-brief.it.test.ts`
  5/5 (Docker available); `pnpm lint` clean
- client: `pnpm typecheck` clean; `pnpm test` 202/202; `pnpm build` succeeds
- `scripts/check-contracts.sh` → `contracts in sync`; both `brief.ts` copies
  diffed byte-for-byte identical

## Gaps

None. All 11 plan steps and all 15 ACs Met with citations, independently
re-verified against running code and tests.

## Scope creep

None. `server/test/contracts.test.ts` and `OverviewTab.test.tsx` updates are
disclosed deviations (real consumers the plan's own grep scope missed / a
test the plan's own bar required), not undisclosed scope creep.

## Verdict

**all requirements met**

## Explicitly not checked here

- Code style / generic quality — see `code-review` / `pr-self-review` (a
  14-skill `pr-self-review` pass already ran this session: 0 CRITICAL, 7
  WARNING, 4 SUGGESTION — see `.claude/pr-review/dfa905a545594035a68f8a88dd696590ed1a1b98.json`)
- Architecture boundaries — see `architecture-reviewer` (already ran; the
  `BlastService` direct-instantiation question is a recorded, unresolved
  disagreement between that pass and a later `pr-self-review` lens, not
  re-litigated here)
- Security — see the `security` skill

## Follow-ups for doc-writer

- Spec `Status:` already reads `shipped` — no flip needed.
- **Minor citation drift** in the spec's Open Questions section: OQ-3/OQ-4
  cite slightly stale line numbers for `REVIEW_FOCUS_DISPLAY_CAP` (actually
  `PrBriefCard.tsx:22`, not `19-21`) and `WHAT_WHY_CLAMP_CHARS` (actually
  `PrBriefCard.tsx:19`, not `16`). Values themselves are correct.
- **This plan file's own "Out of scope" section overstates repo state**: it
  says the AC-9/AC-14 e2e flows "are written but run in CI, not locally" —
  `e2e/specs/` has no brief-related flow file at all. The RTL substitution
  (see AC-9/AC-14 above) is real and was judged adequate; only that one
  sentence in `specs/2026-08-27-pr-brief-card-plan.md` needs correcting.

## Could not verify

None — every AC and plan step was settled against actual code/tests with
`file:line` evidence, independently re-run rather than trusted from the
Implementation Report.
