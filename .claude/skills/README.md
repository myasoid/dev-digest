# Skills

Reusable AI skills that provide specialized knowledge and workflows. Canonical location is `.claude/skills/` with a symlink at `.cursor/skills/ → ../.claude/skills` for Cursor compatibility. Shared with the team via version control.

## Catalog

| Skill | Scope | Description |
|-------|-------|-------------|
| [engineering-insights](engineering-insights/SKILL.md) | Project | Read `<module>/INSIGHTS.md` before a task, record what was learned after |
| [run-plan](run-plan/SKILL.md) | Project | Orchestrates an approved Development Plan: implementer → plan-verifier ∥ architecture-reviewer → fix loop |
| [pr-self-review](pr-self-review/SKILL.md) | Project | Pre-PR gate — routes the diff to the skills below, blocks on a verified critical |
| [fastify-best-practices](fastify-best-practices/SKILL.md) | Backend | Fastify routes, plugins, JSON-schema validation, error handling |
| [drizzle-orm-patterns](drizzle-orm-patterns/SKILL.md) | Backend | Drizzle schema, queries, relations, transactions, migrations |
| [postgresql-table-design](postgresql-table-design/SKILL.md) | Backend | Postgres schema design, data types, indexing, constraints |
| [onion-architecture](onion-architecture/SKILL.md) | Backend | Onion/hexagonal layering for server/ modules and reviewer-core/ |
| [frontend-ui-architecture](frontend-ui-architecture/SKILL.md) | Frontend | Where UI code lives — placement, splitting, module boundaries |
| [next-best-practices](next-best-practices/SKILL.md) | Frontend | Next.js App Router, RSC boundaries, data fetching, optimization |
| [react-best-practices](react-best-practices/SKILL.md) | Frontend | React anti-patterns, state management, hooks rules |
| [react-testing-library](react-testing-library/SKILL.md) | Frontend | General-purpose React Testing Library guide with Vitest |
| [zod](zod/SKILL.md) | Full-stack | Zod schema validation, parsing, error handling, type inference |
| [response-schema](response-schema/SKILL.md) | Full-stack | Changing an existing response field's type or requiredness — the contract/DB/client ripple |
| [semver-discipline](semver-discipline/SKILL.md) | Full-stack | Is this change MAJOR, MINOR, or PATCH? — exported functions, contracts, routes, CLI flags |
| [deprecation-policy](deprecation-policy/SKILL.md) | Full-stack | Mark a surface deprecated (with a replacement and removal trigger) instead of silently deleting it |
| [typescript-expert](typescript-expert/SKILL.md) | Full-stack | Type-level programming, performance, tooling, migrations |
| [security](security/SKILL.md) | Full-stack | OWASP Top 10:2025, auth, injection, uploads, secrets |
| [mermaid-diagram](mermaid-diagram/SKILL.md) | Shared | Mermaid diagrams in markdown (flowcharts, sequence, ERD, …) |

## Authoring load vs review load

`pr-self-review/routing.md` is a **review** router. It maps a changed file to the
skills that should *judge* it, and it is built for fan-out: one subagent per
(skill × zone), each shown only its own slice of the diff (`routing.md` §4).
Twelve skills there cost twelve small contexts.

An authoring agent — `implementation-planner` deciding a step, `implementer`
executing one, `test-writer` writing a test — is **one** context. Reusing the
review router as an authoring router puts every routed skill into that single
context, and the cost is not comparable: `typescript-expert` alone is 431 lines,
and `routing.md` routes it to *any* `.ts`/`.tsx` file in any zone — that is
every step of every plan. So the two loads are separated.

| Load | Skills | Rule |
| --- | --- | --- |
| **Authoring** — read while writing the change | `onion-architecture`, `frontend-ui-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `zod`, `mermaid-diagram` | Load when a step actually touches that surface. **At most once per session.** |
| **Change-impact** — read only when an *existing* surface changes | `semver-discipline`, `response-schema`, `deprecation-policy` | Skip entirely on greenfield work. Same rule `spec-creator` already applies (`spec-creator.md`, Step 1). |
| **Review-only** — a lens over finished code, not guidance for writing it | `typescript-expert`, `security`, `pr-self-review` | Not loaded per step by an authoring agent. `security` stays content-triggered per `routing.md`. `typescript-expert` loads only when the step's own work is type-level (generics, conditional types, a `.d.ts`, a type migration) — not because the file ends in `.ts`. |
| **Orchestrator-only** | `engineering-insights`, `run-plan` | Belong to the session that owns the task, never to a subagent. `engineering-insights` runs once at the end — loaded per subagent it costs 2–3× per feature and produces competing entries. `run-plan` dispatches subagents, so a subagent invoking it would nest the pipeline inside itself. |

**Load each skill at most once per session.** Its rules do not change between
steps, so a second load buys nothing. Where several plan steps share a skill
set, execute them contiguously and load once for the group —
`implementation-planner` is required to order its Steps that way.

This table governs *authoring only*. It does not shrink review coverage: every
skill still runs in `pr-self-review`'s fan-out, where it is cheap.

## What Are Skills?

Skills are modular packages that extend the AI agent with specialized knowledge and workflows. Unlike rules (always applied) or agents (invoked for specific tasks), skills are loaded on-demand when the agent determines they're relevant.

### Skills vs Rules vs Commands vs Agents

| Type | Scope | Loaded | Purpose |
|------|-------|--------|---------|
| **Rules** (`.mdc`) | Project conventions | Always or by file pattern | Persistent guardrails |
| **Commands** (`.md`) | User actions | On `/command` invocation | Slash commands |
| **Skills** (`.md`) | Domain knowledge | On-demand by agent | Specialized knowledge |
| **Agents** (`.md`) | Workflows | Via Task tool | Subagent orchestration |

## Creating New Skills

Each skill has:

- `SKILL.md` — Main skill file with rules and conventions (required)
- `examples.md` — Code examples showing good/bad patterns (recommended)
- `references.md` — Sources and rationale (optional)
