# PR Brief card (`PrBriefCard`)

How the shipped PR Brief card behaves today. Intent and acceptance criteria
live in `specs/2026-08-27-pr-brief-card.md` (`Status: shipped`) — this doc is
the "how it renders now" companion, not a restatement of that spec. Server-side
generation is documented in `../server/docs/pr-brief.md`.

## Where it mounts

`PrBriefCard` (`src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`)
renders inside `OverviewTab.tsx`, **above** the existing two-column
`panelGrid` that holds `IntentPanel` and `BlastPanel`. `OverviewTab` owns the
data — it calls `usePrBrief(prId)` and `useRefreshBrief(prId)`
(`src/lib/hooks/reviews.ts`) itself and threads the results down as props,
the same props-driven shape `IntentPanel` already uses; `PrBriefCard` makes no
`fetch` call of its own for the brief. It does call `usePrReviews(prId)`
directly, for the display-only score/verdict/findings-count it composes in
from the latest `Review` — the brief LLM call never generates those (see
Non-goals in the spec).

## Hooks

- `usePrBrief(prId)` — `GET /pulls/:id/brief` via TanStack Query, key
  `["pr-brief", prId]`. Returns `null` when a brief was never generated.
  Never triggers generation itself.
- `useRefreshBrief(prId)` — `POST /pulls/:id/brief/refresh`. On success,
  writes the result straight into the `["pr-brief", prId]` query cache (no
  refetch needed) — mirrors `useRefreshIntent`.

## States

The card renders one of these, computed from `brief`, `isLoading`,
`generating`, `generateError`, and two flags derived from the brief itself:

| State | Trigger | Notes |
|---|---|---|
| Loading | `usePrBrief` fetching, or `useRefreshBrief` pending | Skeleton rows |
| Error | last `useRefreshBrief` call failed | Retry CTA; card never disappears |
| No brief yet | `brief` is `null` | Empty state + Generate CTA |
| Generated | `brief` present | `what`/`why`, risk badge, `risks[]`, `review_focus[]` |

On top of "Generated", three independent boolean flags can each add a badge or
affordance to the same layout (they are not separate mutually-exclusive
states):

- **Stale** — `brief.head_sha !== headSha` (the PR's current head SHA, passed
  in as a prop). Shows a "stale" badge; the regenerate button (always visible
  in the section header) is how a reviewer clears it.
- **Partial** — `signals_used` is missing `"intent"` or `"blast"`. A
  provisional heuristic, noted in the component's own comment as still in
  OQ-4-adjacent territory: the PR-authored inputs (linked issue, specs) are
  legitimately absent for many thin PRs and do not alone flip this flag, only
  the two inputs the service computes automatically do.
- **Empty `review_focus[]`** — rendered as its own "nothing rose to
  read-first" message inside the section, distinct from both "no brief yet"
  and "partial".

## Overflow handling (resolved OQ-3 / OQ-4)

Two display caps, both client-side only (no server-side truncation):

- **`what`/`why` clamping** — `ExpandableText` clamps any paragraph over
  `WHAT_WHY_CLAMP_CHARS = 220` characters to that length with a trailing
  ellipsis, plus a "Show more"/"Show less" toggle. Never a silent clip.
- **`review_focus[]` capping** — `ReviewFocusSection` shows up to
  `REVIEW_FOCUS_DISPLAY_CAP = 5` items; past that it shows a visible
  "N of M" expand affordance rather than a silent truncation (the failure
  mode this repo has been bitten by before — see `specs/04-blast-radius.md`
  §1). `risks[]` has no display cap; it always renders in full.

## Review-focus links

Each `review_focus[]` item renders as a `MonoLink` built with
`githubBlobUrl(repoFullName, brief.head_sha, item.ref, item.line)` —
**pinned to the brief's own stored `head_sha`**, not the PR's current head
prop. This is deliberate: a stale brief's links still resolve to the code as
it existed when that brief was generated, so a reviewer clicking an old
brief's focus item never lands on a line that has since moved or been
deleted. `risks[].refs` are shown as plain text, not links — only
`review_focus[]` drives clickable navigation.

## Copy

All card copy is under the `brief` `next-intl` namespace (`messages/<locale>/`)
— title, generate/regenerate labels, empty/error/stale/partial text, risk-level
labels, the "N of M" truncation label, and the signals-used note. No inline
string literals in the component.
