# Anti-patterns to flag in review

Five concrete smells, each grounded in something already found in this
codebase (or, for #5, extrapolated from the same principle). There's also one
*non*-smell below (§0) that's easy to mistake for #3 — check it first if
you're about to flag a `new` inside `service.ts`.

Four of the five (#1-#4) show up as a wrong **import** — reading the top of
the file is usually enough. #5 doesn't: the imports are fine, and the smell
only shows up if you read what the method body does with the rows it fetched.

## 0. Not a violation: a module constructing its own repository

**This is fine — don't flag it:**
```ts
// service.ts
export class LabelService {
  private repo: LabelRepository;
  constructor(private container: Container) {
    this.repo = new LabelRepository(container.db); // OK — same module, own repository
  }
}
```

This is the actual shape of `server/src/modules/repos/service.ts` today. The
container's `container.<x>Repo` getters (see
[server-module-pattern.md](server-module-pattern.md#cross-module-access-goes-through-the-container))
exist for **cross-module** access — when a *different* module needs this
module's data — not for a module constructing its own repository. Only flag
the `new` here if it's actually anti-pattern #2 (a facade re-declaring
another repo file's logic), #3 below (a concrete **adapter** for an external
port), or reaches into **another module's** repository folder.

## 1. Business logic or raw Drizzle in `routes.ts`

**Don't:**
```ts
// routes.ts
app.get('/pulls', async (req) => {
  const rows = await db.select().from(pullRequests).where(...); // Drizzle in routes.ts
  const grouped = rows.reduce((acc, r) => { /* aggregation logic */ }, {});
  return grouped;
});
```

**Do:**
```ts
// routes.ts
app.get('/pulls', async (req) => {
  const { workspaceId } = await getContext(app.container, req);
  return service.listGrouped(workspaceId);
});
```

This is the shape of `server/src/modules/{pulls,polling,settings,workspace}/
routes.ts` today — **documented as a known legacy exception**, so don't flag those
specific existing files. Do flag this shape in *new* route handlers or in a
substantial rewrite of one of those four modules.

## 2. A repository facade that re-declares instead of delegates

**Don't:**
```ts
// repository.ts — re-declares the param shape instead of importing it
export class ReviewRepository {
  async findRun(params: { runId: string; workspaceId: string }) { /* duplicated logic */ }
}
// repository/run.repo.ts already has an equivalent findRun with its own param type
```

**Do:**
```ts
// repository.ts — thin delegate
import { findRun } from './repository/run.repo';
export class ReviewRepository {
  findRun = findRun;
}
```

This is the exact smell flagged in `server/INSIGHTS.md` (2026-08-04) for `reviews/
repository.ts`: it duplicates param types instead of importing them from
`repository/*.repo.ts`, risking silent drift between the two.

## 3. Domain/pure code reaching for a concrete adapter

**Don't:**
```ts
// reviewer-core/src/review/run.ts
import { OpenRouterProvider } from '../llm/openrouter';
const llm = new OpenRouterProvider(apiKey); // concrete class, imported directly
```

**Do:**
```ts
// reviewer-core/src/review/run.ts
export async function reviewPullRequest(input: { llm: LLMProvider; /* ... */ }) {
  const result = await input.llm.completeStructured<Review>(/* ... */);
}
```

The concrete `OpenRouterProvider` is instantiated once, outside `reviewer-core/`, and
passed in. The same rule applies to any new port DevDigest adds — the domain/
application code takes the interface as a parameter; only the caller in `server/`
knows about the concrete class.

## 4. Forking a Zod contract instead of extending it

**Don't:**
```ts
// A second, hand-written type that duplicates Finding's fields
export const FindingSummary = z.object({
  id: z.string(),
  severity: z.enum(['low', 'medium', 'high']), // copy-pasted, can drift from Finding
});
```

**Do:**
```ts
export const FindingSummary = Finding.pick({ id: true, severity: true });
```

See [zod-contracts-across-layers.md](zod-contracts-across-layers.md) for the full
rule.

## 5. Business/derived logic hiding inside `repository.ts`

The other four smells all involve a file importing something it shouldn't.
This one doesn't — the imports in `repository.ts` look completely normal
(just `Db` and the table schema). The violation is in what the method *does*
with the rows before returning them, so it survives a quick "check the
imports" pass and only shows up if you read the method body.

**Don't:**
```ts
// repository/webhook.repo.ts — still only imports Db + schema, looks clean
export async function findPending(db: Db, workspaceId: string) {
  const rows = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.workspaceId, workspaceId));
  // Business rule buried in a "just formatting the rows" helper:
  // anything queued more than 15 minutes ago is bumped to 'high' priority.
  return rows.map((r) => ({
    ...r,
    priority: Date.now() - r.queuedAt.getTime() > 15 * 60 * 1000 ? 'high' : 'normal',
  }));
}
```

**Do:**
```ts
// repository/webhook.repo.ts — returns raw rows, no interpretation
export async function findPending(db: Db, workspaceId: string) {
  return db.select().from(webhookDeliveries).where(eq(webhookDeliveries.workspaceId, workspaceId));
}

// service.ts — the 15-minute threshold is a business rule, so it lives here
function classifyPriority(queuedAt: Date): 'high' | 'normal' {
  return Date.now() - queuedAt.getTime() > 15 * 60 * 1000 ? 'high' : 'normal';
}
```

A repository method is allowed to shape a *query* (`where`, `orderBy`, joins) —
that's data access. It is not allowed to apply a *business rule* (a threshold,
a weighting, an eligibility check that could plausibly change with a product
decision) to decide what a row means. If the query returns raw rows and a
`service.ts` function decides what they mean, that's the correct split; if the
repository decides and the service just relays the pre-interpreted result,
the business rule has quietly moved into the wrong ring. The tell: could a
product manager's decision (e.g. "make it 30 minutes instead of 15") land as
a one-line change with no test file outside `service.test.ts`? If fixing it
would require touching `repository.ts`, the rule is in the wrong place.
