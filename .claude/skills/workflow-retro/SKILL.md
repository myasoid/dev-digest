---
name: workflow-retro
description: >-
  Retrospective on a multi-agent RUN — what the agent system did, not what the
  codebase taught us. Measures a session that spawned subagents from its
  transcripts: how many agents, in what order, real concurrency, cache-weighted
  token cost per agent, which grounding was fetched twice, where agents hit
  permission denials or re-read the same file, and which briefs were over- or
  under-specified. Then proposes concrete edits to the agent and skill
  definitions that caused it. Manual invocation only. Triggers: "workflow-retro",
  "how did that run go", "retro on the agents", "why did that cost so much",
  "review the fan-out". NOT for codebase lessons — that is engineering-insights.
version: 1.0.0
argument-hint: "[--session <uuid>] [--list]"
allowed-tools: Bash, Read, Grep, Glob, Write, Edit, AskUserQuestion
---

# workflow-retro

A retrospective on **the run**, not on the code. It answers "was this fan-out
worth it, and what would make the next one cheaper or better", and it ends by
naming the file to change.

**Boundary with `engineering-insights`.** That skill records what we learned
about *DevDigest*; this one records what we learned about *the agent system that
worked on DevDigest*. A finding about `run-executor.ts` goes there. A finding
about three Explore agents independently reading the same contract goes here.
Both can fire after one session — they write to different files and neither
replaces the other. If a finding would still be true with no agents involved, it
is not a workflow-retro entry.

## Step 1 — Measure

```sh
python3 .claude/skills/workflow-retro/collect.py            # newest session with subagents
python3 .claude/skills/workflow-retro/collect.py --list     # pick a different one
python3 .claude/skills/workflow-retro/collect.py --session <uuid>
```

It reads `~/.claude/projects/<mangled-cwd>/<session>/subagents/*.jsonl` plus the
parent transcript and prints one JSON document. Everything it emits is derived
from a file on disk — it never estimates behaviour.

**Run it before forming an opinion.** The interesting numbers are not the ones
you remember from the session.

## Step 2 — Read the numbers without misreading them

Five traps, each of which has already produced a wrong conclusion:

- **`weighted_input_tokens` is the headline, not `input`.** Cache reads dominate
  by two orders of magnitude — an Explore agent can show 8k raw input against
  2.8M cache reads. Weighted input applies the real multipliers (read 0.1x,
  5-minute write 1.25x, 1-hour write 2x, each against that model's own input
  price) and is the only input figure that means anything. Quoting `input` alone
  understates a run by roughly 50x.
- **These numbers will not match the completion notification.** The
  `subagent_tokens` figure in a task-completion message is not persisted
  anywhere; it is computed differently and is gone once the turn ends. When you
  report a token count, say it came from the transcripts.
- **`cost.unpriced_models` is not always empty.** The price table in
  `collect.py` is dated and will not know the newest model. Unpriced agents are
  excluded from `usd_priced_agents` — report the exclusion rather than
  presenting a partial sum as the total.
- **`parallelism` is sum over *active* seconds, not over span.** `idle_gap_s` is
  time when no agent ran — usually the orchestrator working inline between
  phases, which is not waste. Judge concurrency from `wall.clusters`, where each
  cluster is a genuinely overlapping batch.
- **Duplicate-read token figures are `chars/4` estimates of the file as it
  stands now**, not of what was actually sent. Use them to rank, never to bill.

What each signal usually means:

| Signal | Reading |
|---|---|
| `duplicated_grounding.files` | Grounding the parent could have fetched once and pasted into every brief. The fix is a prompt change, not an agent change. |
| `friction.agents_rereading_a_file` | The agent lost its place — almost always an underspecified brief that named a topic instead of a path. |
| `wall.clusters[].straggler_gap_s` | How long fast agents idled if anything waited for the whole batch. A large gap plus a barrier means split the slow agent or drop the barrier. |
| `spawn_records[].brief_est_tokens` vs that agent's `output` | A 4.5k-token brief returning 400 tokens of findings is over-briefed; a 300-token brief that triggered re-reads is under-briefed. |
| `friction.denied_tool_calls_*` | Permission configuration, not agent behaviour. Fixable once in settings. |
| `agents[].model` vs the work it did | Tier fit. A mechanical sweep on an expensive model, or a hard synthesis on a cheap one, is the single largest cost lever. |

## Step 3 — Judge what the transcripts cannot see

The script cannot tell whether the run was any *good*. Answer these yourself,
from the session you just lived through, and keep them visibly separate from the
measured facts:

- **Was each agent's output actually used**, or did the orchestrator discard it
  and redo the work inline? A discarded agent is pure cost, and the most common
  finding worth writing down.
- **What did every agent miss** that had to be found afterwards?
- **Was the decomposition right** — did two agents overlap, did one agent carry
  two unrelated jobs, was a needed agent never spawned?
- **Did a subagent's report get trusted where it should have been verified?**

If you did not run the workflow yourself and cannot answer these, say so and
write the measured half only. An invented judgement is worse than a short entry.

## Step 4 — Write

Two artifacts, mirroring how `.claude/pr-review/` already splits machine-local
output from team knowledge:

1. **`.claude/workflow-runs/<session-id>.json`** — the collector's raw output,
   verbatim. Gitignored. It exists so a later retro can recompute a trend
   instead of trusting prose.
2. **`.claude/WORKFLOW-INSIGHTS.md`** — committed. Durable lessons only.

Before appending, **read the cumulative file and check for a near-duplicate**
(`grep -i` the key identifier). If the same lesson is already there, sharpen that
entry and add the new run as evidence — do not append a variation. This is the
same discipline `engineering-insights` applies, and for the same reason: five
restatements of one lesson read as five separate problems.

### Entry format

```markdown
### 2026-08-25 — Parallel Explores re-fetch the same contract file

**Measured:** 4 agents, 1.91M weighted input tokens, 1.31 USD across 3 priced
agents (`claude-opus-5` unpriced). `contracts/trace.ts` read independently by 3
of 4 agents; ~16.7k redundant grounding tokens. One agent re-read
`run-executor.ts` 4 times.
**Judged:** all three Explore reports were used; none was discarded.
**Change:** paste the shared contract excerpt into each brief instead of naming
the topic — the parent already had it open. `.claude/agents/README.md`, fan-out
section.
```

Three required parts. **Measured** cites the collector. **Judged** is the human
half and is allowed to say "not assessed". **Change** names a file — an entry
that ends at a diagnosis is an observation, not an insight.

### The bar

- **Cap at 3 entries per run.** If everything looks worth writing, the bar is too
  low.
- A number alone is not an entry. "This run cost 1.31 USD" is a fact about one run;
  "Explore agents on haiku cost ~0.40 USD each because cache reads dominate, so
  splitting one Explore into three costs 3x the cache, not 3x the output" is a
  lesson.
- **No silent caps.** If you looked at only part of the run, say which part.
- Skip the write entirely when a run was unremarkable, and say "nothing worth
  recording". A routine three-agent fan-out that behaved is not an insight.

## Step 5 — Propose, never apply

Findings become **proposals**, with the file named and the change stated. Do not
edit `.claude/agents/*.md`, `.claude/skills/**`, or any routing table as part of
a retro — a retrospective that silently rewrites the agents which produced it is
unauditable, and its own next run cannot be compared against the last. The only
files this skill writes are the two in Step 4.

## Report back

```markdown
## Run
<n> agents - <weighted> weighted input tokens - <cost> USD (<k> of <n> priced) - <span>

## Measured
<the 3-5 findings that came from collect.py, each with its number>

## Judged
<the Step-3 answers, or "not assessed - did not run this workflow">

## Proposed changes
<file: what, one line each - or "none">

## Written
.claude/workflow-runs/<id>.json
.claude/WORKFLOW-INSIGHTS.md - <entry title>, or "nothing worth recording"
```
