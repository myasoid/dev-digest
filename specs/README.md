# specs/ — cross-package

Forward-looking specs for work that spans more than one package. One file per
feature: `YYYY-MM-DD-feature-name.md`, the date being the day the spec was
written. Work that lives inside a single package goes in that package's
`specs/` instead.

**The naming changed on 2026-08-25** — it used to be `NN-feature-name.md`. A
date sorts chronologically on its own, needs no lookup to pick, and cannot
collide when two specs are written in the same week; "the next free number" was
a read of the whole folder that two people could do concurrently and both get
`05`. The specs numbered `01`–`04` keep their names: they are cited by path
from roughly forty places, including source comments and both vendored copies
of `@devdigest/shared`, so renaming them is a repo-wide edit for no gain. New
specs use the date form.

A spec describes **what to build and why it is done** — not how the code works
today (that is `docs/`) and not what we already rejected (that is `INSIGHTS.md`).

## Canonical shape

These sections are the **universal core**. They apply to specs in *every*
package's `specs/`, not only this one. A package's own `specs/README.md` adds
its package-specific sections on top — `server/specs/` adds Routes / Schema
changes / Adapters needed, `client/specs/` adds Route(s) / Data / States /
Copy, `reviewer-core/specs/` adds Prompt slots / Public API / Grounding impact
/ Determinism. Those are **additional to** the core, never a replacement for it.

```markdown
# Spec: <feature name>

**Spec ID:** SPEC-<scope>-NN
**Status:** draft | agreed | in progress | shipped
**Created:** YYYY-MM-DD
**Packages touched:** server, client
**Supersedes:** <path to the spec this replaces — omit the line if none>
**Design sources:** <brief, Figma URL, mockup path, code paths analysed>

## Problem & user
## Goals / Non-goals
## User stories                 <!-- US-1, US-2, … -->
## Acceptance criteria (EARS)   <!-- AC-1 (US-2) — verify: <kind> -->
## Edge cases                   <!-- EC-1, EC-2, … -->
## Non-functional requirements
## Contract changes        <!-- @devdigest/shared first, always -->
## Inputs and provenance
## Untrusted inputs
## Open questions
```

**`Spec ID`** scope is the folder: `cross` for this directory, otherwise the
package name — `SPEC-cross-05`, `SPEC-server-03`. Numbering is per folder, so
the scope is what keeps IDs unique across them. The ID keeps its number even
though the filename no longer carries one: it is a short, stable handle for
citing a spec in a plan or a commit, which a date-and-slug filename is not.
Because the folder listing no longer shows the numbers, take the next free one
by reading the `Spec ID:` lines — `rg '^\*\*Spec ID:' specs/` — not by counting
files.

**`Goals / Non-goals`** replaces the older `Scope — in / out` heading. Non-goals
is where a considered-and-declined proposal goes, with the reason it was
declined — otherwise the same proposal comes back every planning round.

**`Inputs and provenance`** lists what the feature consumes, who controls it,
and what it is pinned to (a SHA, a run, a session). **`Untrusted inputs`** names
which of those is attacker- or author-controlled and the required handling —
boundary validation, escaping, authorization, and, for anything reaching a
model, that it is data and never instructions.

**`Created`** is an ISO date, `YYYY-MM-DD`, and it matches the date in the
filename. Take it from `date +%F` rather than from memory — a wrong date now
mis-names the file as well as the field, and the filename is the harder of the
two to correct later.

**Annotation.** User stories, acceptance criteria and edge cases are numbered
`US-n`, `AC-n`, `EC-n`, and every criterion carries two annotations:

```markdown
**AC-7 (EC-3) — verify: hermetic unit test.** IF more than 20 callers resolve
for one changed symbol, THEN the system shall return the 20 highest-ranked
with `truncated: true` set for that symbol.
```

- **Origin** — `(US-2)`, `(EC-3)`, or `(asked YYYY-MM-DD)`. A criterion that
  traces to nothing is either invented scope or a user story someone forgot to
  write down; both are cheaper to catch here than after planning.
- **Verification hint** — the *kind* of check: `hermetic unit test`,
  `*.it.test.ts` (DB-backed, per this repo's test split), `e2e flow`,
  `contract check`, or `manual/visual` where nothing automated can see it. A
  criterion nobody can name a check for is usually not observable yet, and
  `test-writer` works from exactly this. Naming the kind is in scope; naming
  the test file or function is implementation and is not.

The four numbered specs in this directory predate both this shape and this
naming. They are not being retrofitted — read them as they are.

## What belongs in a spec — and what does not

A spec says **what** and **why**. `implementation-planner` reads it and decides
**how**, so an implementation choice frozen here removes a decision from the
stage better placed to make it.

**In scope, and often the most useful part of the document:** workflow diagrams
(states and their transitions), service and module communication diagrams (who
calls whom, in what order, and what happens when a participant is unavailable),
the **contracts** crossing a boundary (field names, types, nullability, enum
values, error and status cases — a `@devdigest/shared` Zod contract here), and
constraints that follow from the requirement itself (contract-first ordering,
which module owns the data, a stated cap or budget). Diagrams follow
[.claude/skills/mermaid-diagram/SKILL.md](../.claude/skills/mermaid-diagram/SKILL.md).

**Out of scope, unless the requirement genuinely forces it:** file paths and
directory layout, function or component names, algorithms and data structures,
library choices, SQL and migrations, test names. If one of these feels
unavoidable, state the requirement that forces it and let the plan derive the
rest — or record it under `Open questions` as a constraint to confirm. Never
put it in an acceptance criterion, where `plan-verifier` will later enforce it
as though it had been agreed.

## Acceptance criteria are EARS

EARS (Easy Approach to Requirements Syntax) — Mavin, Wilkinson, Harwood, Novak,
IEEE RE'09. It separates the condition from the system's response. Every
criterion uses exactly one of five patterns, with the keyword uppercase:

| Pattern | Shape | Use for |
|---|---|---|
| Ubiquitous | The system shall `<response>`. | always true, no precondition |
| Event-driven | **WHEN** `<trigger>`, the system shall `<response>`. | a reaction to an event |
| State-driven | **WHILE** `<state>`, the system shall `<response>`. | behaviour during a state |
| Unwanted behaviour | **IF** `<condition>`, **THEN** the system shall `<response>`. | errors, abuse, limits, failures |
| Optional feature | **WHERE** `<feature is enabled>`, the system shall `<response>`. | behaviour behind a flag |

Rules that make the difference:

- **One `shall` per criterion.** Two responses is two criteria.
- `shall` only — never "should", "may", "could", "will", "must". `shall` is the
  requirement; the rest are wishes and cannot be verified.
- Every criterion names an **observable response** — a status code, a rendered
  state, a persisted row, a returned field. Not an implementation ("shall use a
  BFS"). The test: can someone fail this without reading the code?
- A spec with only WHEN criteria has described the demo, not the feature. Cover
  the unwanted behaviours explicitly.

`plan-verifier` checks finished code against this section, so treat it as the
contract rather than as prose.

## Lifecycle

`draft` on creation — only a human promotes a spec past it. Once shipped,
either delete the spec or set `Status: shipped` and move any durable
explanation into `docs/`. Stale specs are worse than missing ones — an agent
reads them as current intent.

Who touches a spec, and when:

| Agent | Role |
|---|---|
| `spec-creator` | writes the spec **before** any code, from the supplied design sources |
| `implementation-planner` | turns an existing spec into an Implementation Plan — never authors one |
| `plan-verifier` | checks the finished code against **Acceptance criteria (EARS)** |
| `doc-writer` | updates `Status:` and moves durable explanation into `docs/` **after** the change ships |
