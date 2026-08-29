import type { SkillCase } from "../../src/index.js";

// This skill's job is to analyze real files (package.json, tsconfig.json, node_modules sizes),
// but "quality" cases run with no tools (skillTask measures the SKILL.md content in isolation —
// see tasks.ts). So each prompt inlines a small synthetic dataset the skill can reason over
// directly, standing in for what the skill would normally gather itself with Read/Bash/Grep.

const REPO_DATA = `Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

server/package.json dependencies: fastify@5.1.0, drizzle-orm@0.36.0, zod@3.23.8, pg@8.13.0, moment@2.30.1
server/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tsx@4.19.0
client/package.json dependencies: next@15.0.3, react@19.0.0, react-dom@19.0.0, @tanstack/react-query@5.59.0, zod@3.22.4, date-fns@4.1.0
client/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tailwindcss@3.4.14
reviewer-core/package.json dependencies: zod@3.23.8
reviewer-core/package.json devDependencies: typescript@5.6.3
e2e/package.json dependencies: (none runtime)
e2e/package.json devDependencies: playwright@1.48.2, typescript@5.6.3

Installed sizes (du -sh):
server/node_modules/moment: 4.2M
server/node_modules/drizzle-orm: 8.1M
server/node_modules/fastify: 6.5M
server/node_modules/pg: 3.8M
server/node_modules/zod: 2.1M
client/node_modules/next: 132M
client/node_modules/react-dom: 6.9M
client/node_modules/date-fns: 22M
client/node_modules/zod: 1.9M
reviewer-core/node_modules/zod: 2.1M
e2e/node_modules/playwright: 210M

server/package.json also declares zod@3.23.8, client/package.json declares zod@3.22.4, reviewer-core/package.json declares zod@3.23.8 — three different resolved zod versions across packages.

grep for imports crossing package boundaries:
- server/src/routes/reviews.ts imports types from "@shared/review-types" (alias to server/src/vendor/shared)
- server/src/services/review-service.ts imports "reviewer-core/src/pipeline.js" directly by relative path (not via the package's public entry point)
- client/src/lib/api-types.ts imports "@shared/review-types" — the SAME alias name as server, but it resolves to client's OWN local client/src/vendor/shared, an independent unsynced copy — not a cross-package edge to server
- grep found no import of "moment" anywhere under server/src — only present in package.json`;

// A "clean" counterpart to REPO_DATA: no boundary bypass, no version drift, no unused dependency.
// Every internal edge goes through the alias, every dependency is confirmed imported somewhere,
// and the one shared dependency (zod) resolves to the same version everywhere. This is the
// negative control — mirrors the "does not fabricate a violation for a benign change" case in
// agents/architecture-reviewer/architecture-reviewer.cases.ts. Without it we only ever know
// whether the skill CAN find a real problem, never whether it invents one when there isn't any.
const CLEAN_REPO_DATA = `Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

server/package.json dependencies: fastify@5.1.0, drizzle-orm@0.36.0, zod@3.23.8, pg@8.13.0
server/package.json devDependencies: vitest@2.1.4, typescript@5.6.3
client/package.json dependencies: next@15.0.3, react@19.0.0, react-dom@19.0.0, @tanstack/react-query@5.59.0, zod@3.23.8
client/package.json devDependencies: vitest@2.1.4, typescript@5.6.3, tailwindcss@3.4.14
reviewer-core/package.json dependencies: zod@3.23.8
reviewer-core/package.json devDependencies: typescript@5.6.3
e2e/package.json dependencies: (none runtime)
e2e/package.json devDependencies: playwright@1.48.2, typescript@5.6.3

Installed sizes (du -sh):
server/node_modules/fastify: 6.5M
server/node_modules/drizzle-orm: 8.1M
server/node_modules/pg: 3.8M
server/node_modules/zod: 2.1M
client/node_modules/next: 132M
client/node_modules/react-dom: 6.9M
client/node_modules/zod: 2.1M
reviewer-core/node_modules/zod: 2.1M
e2e/node_modules/playwright: 210M

server/package.json declares zod@3.23.8, client/package.json declares zod@3.23.8, reviewer-core/package.json declares zod@3.23.8 — the same resolved version everywhere.

grep for imports crossing package boundaries:
- server/src/routes/reviews.ts imports types from "@shared/review-types" (alias to server/src/vendor/shared)
- client/src/lib/api-types.ts imports "@shared/review-types" — the SAME alias name as server, but it resolves to client's OWN local client/src/vendor/shared, an independent unsynced copy — not a cross-package edge to server
- no other cross-package import found; reviewer-core is only ever imported via its published entry point ("reviewer-core" bare specifier), never by a relative path into its internal src/
- grep confirms every declared dependency in every package.json is imported at least once under that package's src/`;

// Same "dirty" fixture as REPO_DATA, except zod is pinned to the identical version (3.23.8) in
// every package.json. Isolates the version-drift check from the other three violations (boundary
// bypass, unused moment) so a false positive here can't hide behind real findings elsewhere.
const SAME_VERSION_REPO_DATA = REPO_DATA.replace(
  "client/package.json dependencies: next@15.0.3, react@19.0.0, react-dom@19.0.0, @tanstack/react-query@5.59.0, zod@3.22.4, date-fns@4.1.0",
  "client/package.json dependencies: next@15.0.3, react@19.0.0, react-dom@19.0.0, @tanstack/react-query@5.59.0, zod@3.23.8, date-fns@4.1.0",
).replace(
  "server/package.json also declares zod@3.23.8, client/package.json declares zod@3.22.4, reviewer-core/package.json declares zod@3.23.8 — three different resolved zod versions across packages.",
  "server/package.json declares zod@3.23.8, client/package.json declares zod@3.23.8, reviewer-core/package.json declares zod@3.23.8 — the same resolved version everywhere.",
);

// A dependency that IS used, but disproportionately large for that use, plus a dependency whose
// installed size genuinely couldn't be measured. Distinguishes two things the SKILL.md tiers treat
// as different (P1 "disproportionate size" vs. P2 "unused") and one thing it forbids (inventing a
// size number that was never measured).
const SIZE_EDGE_CASE_DATA = `Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

server/package.json dependencies: fastify@5.1.0, date-fns@4.1.0
server/package.json devDependencies: vitest@2.1.4, typescript@5.6.3

Installed sizes (du -sh):
server/node_modules/fastify: 6.5M
server/node_modules/date-fns: 22M
server/node_modules/typescript: du could not measure this — permission denied on a subfolder during this run, size unknown

grep for imports:
- server/src/utils/format-date.ts imports exactly one function, formatDistanceToNow, from "date-fns" — the only usage of date-fns anywhere under server/src
- typescript is invoked only via the "tsc" CLI in package.json scripts; grep found no import of "typescript" anywhere under server/src`;

// A vendored copy and a gitignored full clone sit on disk alongside the real packages. Tests the
// Scope section's "name anything excluded and why" rule, not just its "name what was analyzed" half.
const SCOPE_EXCLUSION_DATA = `Here is the data you'd normally gather yourself — treat it as already collected, and produce the report directly from it (do not ask for tool access or more data).

server/package.json dependencies: fastify@5.1.0, zod@3.23.8
server/package.json devDependencies: vitest@2.1.4, typescript@5.6.3
client/package.json dependencies: next@15.0.3, react@19.0.0, zod@3.23.8
client/package.json devDependencies: vitest@2.1.4, typescript@5.6.3

Installed sizes (du -sh):
server/node_modules/fastify: 6.5M
server/node_modules/zod: 2.1M
client/node_modules/next: 132M
client/node_modules/zod: 2.1M

Also present on disk (do not treat these as additional packages to analyze):
- server/src/vendor/shared — a vendored copy of @devdigest/shared's contracts, not an independently maintained package
- server/clones/dev-digest — a full gitignored clone of this repo used by the indexer, with its own package.json and node_modules

grep confirms every declared dependency in every package.json is imported at least once under that package's src/, and no cross-package relative imports were found.`;

export const cases: SkillCase[] = [
  {
    name: "full report follows the required 5-section structure with a Mermaid graph",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${REPO_DATA}`,
    grounding: ["```mermaid", "flowchart"],
    practices: [
      "the report has a section named 'Scope' listing which packages (client, server, reviewer-core, e2e) were analyzed",
      "the report includes a Mermaid diagram (a fenced ```mermaid code block using flowchart) showing dependency relationships between packages",
      "the report has a section with a size breakdown table showing dependencies and their installed size, not just a vague size statement",
      "the report has a 'Findings & Priorities' section (or equivalently named) that groups findings under explicit severity tiers such as P0, P1, P2, or Info — not an unranked bullet list",
      "the report ends with a Summary section giving 3-5 concrete, actionable takeaways ordered by priority",
      "every finding names a specific package, dependency, or file rather than giving generic advice like 'consider optimizing dependencies'",
    ],
    threshold: 0.7,
    maxTurns: 10,
  },
  {
    name: "distinguishes internal (path-alias) dependencies from external npm dependencies",
    kind: "quality",
    prompt: `This repo isn't a monorepo — server, client, reviewer-core, and e2e share code via TypeScript path aliases, not workspace:* packages. Analyze our dependencies, including how these packages depend on each other internally.\n\n${REPO_DATA}`,
    practices: [
      "the answer explicitly distinguishes internal cross-package dependencies (the @shared/review-types alias and the direct relative import into reviewer-core/src/pipeline.js) from external npm package dependencies, rather than treating them as the same kind of dependency",
      "the answer flags server/src/services/review-service.ts importing reviewer-core/src/pipeline.js by relative path instead of through reviewer-core's public entry point as a P0-tier or otherwise explicitly called-out issue",
      "the answer does not claim these packages are linked via workspace:* or pnpm workspaces, since the project explicitly is not a monorepo",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "severity tiers are used consistently and recommendations are specific, not vague",
    kind: "quality",
    prompt: `We suspect some npm dependencies in server/ and client/ are unused or duplicated across packages with different versions. Check our dependencies and tell me what to prioritize fixing first.\n\n${REPO_DATA}`,
    practices: [
      "findings are explicitly labeled with one of the defined severity tiers (P0, P1, P2, or Info) rather than left unranked",
      "the three different zod versions across server, client, and reviewer-core are called out explicitly as version drift",
      "moment being declared in server/package.json but never imported anywhere under server/src is called out explicitly as an unused dependency",
      "each recommendation names a specific package name and package.json/file location (e.g. server/package.json, moment, zod) rather than a generic suggestion",
      "removing a dependency (e.g. moment) is presented as a recommendation for the user to confirm, not something already executed",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "does not fabricate a P0/P1 finding when the data shows no real violation (negative control)",
    kind: "quality",
    prompt: `This repo isn't a monorepo — server, client, reviewer-core, and e2e share code via TypeScript path aliases, not workspace:* packages. Analyze our dependencies, including how these packages depend on each other internally.\n\n${CLEAN_REPO_DATA}`,
    practices: [
      "does not report a P0 finding, since the data shows no relative import bypassing another package's intended entry point",
      "does not report a version-drift finding, since zod resolves to the same version (3.23.8) across every package that declares it",
      "does not report an unused-dependency finding for any package, since every declared dependency is confirmed imported somewhere",
      "the report's overall conclusion (Findings & Priorities or Summary) states there is nothing significant to prioritize, or contains only Info-level observations — it does not invent a P0 or P1 claim to have something to report",
    ],
    threshold: 0.75,
    maxTurns: 10,
  },
  {
    name: "the dependency graph shows only packages and internal edges, not ordinary npm dependencies as nodes",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${REPO_DATA}`,
    practices: [
      "the Mermaid graph's nodes represent only the analyzed packages (client, server, reviewer-core, e2e) — it does not add a separate graph node for an ordinary npm dependency such as zod, fastify, drizzle-orm, or next",
      "every edge drawn in the graph connects two of the analyzed packages based on a real cross-package import found in the data (e.g. server's relative import into reviewer-core/src/pipeline.js) — no edge represents an ordinary npm dependency such as zod, fastify, drizzle-orm, or next",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "does not report version drift when the same dependency version is used everywhere (false-positive guard)",
    kind: "quality",
    prompt: `We suspect some npm dependencies in server/ and client/ are unused or duplicated across packages with different versions. Check our dependencies and tell me what to prioritize fixing first.\n\n${SAME_VERSION_REPO_DATA}`,
    practices: [
      "does not report a version-drift or inconsistent-version finding for zod, since server, client, and reviewer-core all declare the identical resolved version (3.23.8)",
      "moment being declared in server/package.json but never imported anywhere under server/src is still called out explicitly as an unused dependency",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "distinguishes disproportionate-size from unused, and never invents an unmeasured size",
    kind: "quality",
    prompt: `Check our dependencies in server/ for anything worth cleaning up.\n\n${SIZE_EDGE_CASE_DATA}`,
    practices: [
      "flags date-fns (22M installed, confirmed used for exactly one function — formatDistanceToNow — in one file) as a P1 disproportionate-size finding rather than as an unused dependency, since it is confirmed used",
      "does not conflate the date-fns finding with an unused-dependency claim — the reason given is size relative to usage, not lack of usage",
      "for typescript, since its installed size could not be measured, the report states the size as unknown/not measured rather than inventing a specific size figure",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
  {
    name: "Scope section names vendored/cloned code explicitly excluded from analysis, with a reason",
    kind: "quality",
    prompt: `Run a dependency check on this repo. I want the full report: graph, sizes, prioritized findings, recommendations.\n\n${SCOPE_EXCLUSION_DATA}`,
    practices: [
      "the Scope section explicitly names server/src/vendor/shared and/or server/clones/dev-digest as excluded from the analysis",
      "the exclusion is given a stated reason (vendored code that isn't an independently maintained package, and/or a gitignored clone) rather than being silently omitted",
      "server/src/vendor/shared and server/clones/dev-digest are not treated as additional analyzed packages in the Scope or Size Breakdown sections",
    ],
    threshold: 0.6,
    maxTurns: 10,
  },
];
