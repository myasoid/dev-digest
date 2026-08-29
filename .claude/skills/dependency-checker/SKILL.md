---
name: dependency-checker
description: "Audits this repo's dependencies — per-package npm packages, internal cross-package dependencies (TypeScript path aliases, not a workspace), and how much disk weight each dependency carries. Produces a fixed five-section report: Scope, a Mermaid dependency graph, a size-breakdown table, severity-tiered findings (P0/P1/P2/Info), and a prioritized summary of concrete next actions. Use when asked to check or audit dependencies, find unused or duplicated packages, explain what's bloating node_modules, or draw a dependency graph. Trigger terms: \"dependency check\", \"audit dependencies\", \"check our dependencies\", \"unused dependency\", \"duplicate dependency\", \"dependency graph\", \"node_modules size\", \"what's bloating\", \"version drift\"."
---

# Dependency Checker

Analyzes every package.json-owning package in this repo, sizes its installed
dependencies, maps how the packages depend on **each other** (not just on
npm), and turns that into a report a developer can act on in one pass:
what's safe to ignore, what's worth fixing, and what's actually risky.

This repo is **not a monorepo workspace** — `server/`, `client/`,
`reviewer-core/`, `mcp-server/`, and `e2e/` each have their own
`package.json` and lockfile (root `CLAUDE.md`). Sharing between them happens
through **TypeScript path aliases**, not `workspace:*` packages. Never
describe an internal cross-package edge as a workspace/lerna link — it isn't
one, and the whole point of flagging a relative import that reaches past an
alias is that nothing at the workspace or type level would have caught it.

## What to gather

Use `Read`/`Bash`/`Grep` to collect this yourself before writing the report —
never ask the user for it, and never fabricate a number you didn't look up.

1. **Enumerate packages** — every directory with its own `package.json`,
   excluding `node_modules/**`, `server/clones/**` (cloned user repos), and
   `**/vendor/**` (vendored code, out of scope for this audit).
2. **Declared dependencies** — `dependencies` and `devDependencies`, with
   exact declared versions, from each package's `package.json`.
3. **Installed size** — `du -sh <pkg>/node_modules/<dep>` per dependency. If
   that's too slow for a large tree, start with
   `du -sh --max-depth=1 <pkg>/node_modules | sort -rh | head -20` to find the
   heaviest ones first, then confirm individually.
4. **Actual usage** — for each declared dependency, `grep -rl` for an import
   or `require` of it under that package's `src/`. Zero hits is a candidate
   *unused dependency* finding, not a definite one — say so as a candidate.
5. **Internal cross-package edges** — grep for imports that cross a package
   boundary two ways: (a) a configured `tsconfig.json` path alias (e.g.
   `@shared/*`), and (b) a **raw relative import** reaching into another
   package's `src/` directly (e.g. `../../reviewer-core/src/pipeline.js`)
   instead of through that package's intended public surface. Treat these as
   **internal dependencies** — never list them in the npm size table, and
   never skip them just because `package.json` doesn't mention them.
6. **Version drift** — the same npm package name resolved to different
   versions across two or more package.json files.

## Report structure — always these five sections, in this order

### 1. Scope
Name every package analyzed (e.g. client, server, reviewer-core, mcp-server,
e2e — whichever actually have a `package.json` in this repo), and name
anything deliberately excluded and why (vendored code, cloned repos).

### 2. Dependency Graph
A fenced ` ```mermaid ` `flowchart` with **exactly one node per analyzed
package** — never a second node for a file, folder, or vendored path inside a
package (e.g. `server/src/vendor/shared`); if an edge needs to say what it
points at internally, put that in the edge's label, not a new node. Draw
edges only for **internal** cross-package dependencies (path-alias imports,
direct relative imports across a package boundary), each edge labeled with
what's actually imported. Do not put ordinary npm dependencies on this graph
either — its job is to show internal coupling, not the full npm tree.

### 3. Size Breakdown
A table — `| Package | Dependency | Version | Installed Size |` — sorted
descending by size within each package. Close with the 3-5 heaviest
dependencies repo-wide as a standalone observation.

### 4. Findings & Priorities
Every finding is grouped under exactly one of these tiers — never leave one
unranked, and never invent a finding just to fill a tier out:

| Tier | Meaning | Example |
| --- | --- | --- |
| **P0** | Breaks an architectural boundary, or a confirmed security/broken-install issue | A relative import reaching past another package's intended entry point into its internal `src/` |
| **P1** | Real cost or risk, no boundary break | The same npm package resolved to different versions across packages (version drift); an installed size disproportionate to what the dependency is actually used for |
| **P2** | Minor, low-risk cleanup | An unused dependency; a dependency duplicating what another already-installed one already does |
| **Info** | Observation, not independently actionable | Total install size, dependency counts, size distribution |

Every finding names the exact package, dependency, and file/path involved —
never a generic line like "consider optimizing dependencies."

### 5. Summary
3-5 bullets, ordered P0 → P1 → P2, each one concrete next action (e.g.
"remove `moment` from `server/package.json` — confirm no other entry point
imports it before deleting"). Phrase every recommendation as something for
the user to confirm, never as something already done.

## Rules

- **Internal vs. external, always distinguished.** A path-alias or
  cross-package relative import is not an npm dependency — it has no
  "installed size" of its own and belongs in the Dependency Graph, not the
  Size Breakdown.
- **A bypassed alias outranks a bypassed lockfile.** A relative import that
  reaches past a package's intended surface into its internals is P0 — more
  severe than ordinary version drift — because nothing at the type or
  workspace level flags it; the importing package can be broken by an
  internal refactor on the other side with zero signal until runtime.
- **Every number and finding must trace to something actually gathered** in
  the steps above — a `package.json` line, a `du` output, a `grep` hit. Don't
  reason about a dependency you didn't look up.
- **Recommendations are proposals, not actions.** Never phrase a finding as
  "removed `moment`" — always "remove `moment` — confirm first."

## Related skills

- `semver-discipline` — once a dependency bump this audit recommends turns
  out to be a breaking one.
- `onion-architecture` — the boundary discipline that makes the bypassed-alias
  finding architectural (P0), not merely a style nit.
