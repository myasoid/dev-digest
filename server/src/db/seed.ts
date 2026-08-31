import 'dotenv/config';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDb, type Db } from './client.js';
import * as t from './schema.js';
import { eq, and } from 'drizzle-orm';
import {
  API_CONTRACT_REVIEWER_PROMPT,
  GENERAL_REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  PERFORMANCE_REVIEWER_PROMPT,
  TEST_QUALITY_REVIEWER_PROMPT,
} from './seed-prompts.js';
import { SEED_AGENT_SKILLS, SEED_SKILLS } from './seed-skills.js';

/** Default provider/model for the built-in reviewer agents. */
const DEFAULT_PROVIDER = 'openrouter' as const;
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash';

/**
 * Project Context e2e fixture — OFF by default (R-9). A developer's ordinary
 * `pnpm db:seed` must NOT give the demo repo a `clonePath`: that would make
 * every dev's demo repo look cloned, changing repo-intel's behaviour for an
 * unrelated feature. `scripts/e2e.sh` sets this flag (and an isolated
 * `DEVDIGEST_CLONE_DIR`) so only the hermetic e2e stack gets it.
 */
const SEED_CONTEXT_FIXTURE =
  process.env.DEVDIGEST_SEED_CONTEXT_FIXTURE === '1' ||
  process.env.DEVDIGEST_SEED_CONTEXT_FIXTURE === 'true';

/** Mirrors `platform/config.ts`'s `cloneDir` resolution (kept independent —
 *  seed.ts doesn't otherwise depend on `loadConfig`). */
function resolveCloneDir(): string {
  const raw = process.env.DEVDIGEST_CLONE_DIR ?? join(homedir(), '.devdigest', 'workspace');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/** Body of the seeded `specs/public-api.md` fixture — shared between the file
 *  written to disk and the canned trace's `prompt_assembly.specs` below, so
 *  the two never drift. */
const SPECS_FIXTURE_PATH = 'specs/public-api.md';
const SPECS_FIXTURE_BODY =
  '# Public API contract\n\nEvery public endpoint must be rate-limited before it ships.\n';

/** One `.md` document per `.devdigest` type — enough for the e2e flows to see
 *  a non-empty Project Context page (AC-7, AC-10, AC-13, AC-14, AC-15) without
 *  needing a real git clone. */
async function writeContextFixture(clonePath: string): Promise<void> {
  const dirs = {
    specs: join(clonePath, '.devdigest', 'specs'),
    docs: join(clonePath, '.devdigest', 'docs'),
    insights: join(clonePath, '.devdigest', 'insights'),
  };
  await Promise.all(Object.values(dirs).map((d) => mkdir(d, { recursive: true })));
  await writeFile(join(dirs.specs, 'public-api.md'), SPECS_FIXTURE_BODY);
  await writeFile(
    join(dirs.docs, 'onboarding.md'),
    '# Onboarding\n\nStart with the payments flow — it touches every public endpoint.\n',
  );
  await writeFile(
    join(dirs.insights, 'rate-limiting.md'),
    '# Insight: rate limiting\n\nWe tried a global limiter first and rejected it — see PR #482.\n',
  );
}

/**
 * Canned `agent_runs` + `run_traces` rows for PR #482, so the e2e-only run
 * trace has a `## Project context` block to expand (AC-36, AC-37) without a
 * real model call — the SAME "insert a finished result directly, no LLM"
 * shape the sample review + findings above already use. Idempotent: skipped
 * if a run already exists for this PR + agent.
 */
async function seedContextTrace(db: Db, workspaceId: string, prId: string, agentId: string): Promise<void> {
  const [existing] = await db
    .select({ id: t.agentRuns.id })
    .from(t.agentRuns)
    .where(and(eq(t.agentRuns.prId, prId), eq(t.agentRuns.agentId, agentId)));
  if (existing) return;

  const run = insertedRow(
    await db
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId,
        prId,
        provider: DEFAULT_PROVIDER,
        model: DEFAULT_MODEL,
        durationMs: 4200,
        tokensIn: 1800,
        tokensOut: 240,
        costUsd: 0.004,
        status: 'done',
        source: 'local',
        findingsCount: 0,
        grounding: '0/0 passed',
        score: 92,
        blockers: 0,
        criticalCount: 0,
        warningCount: 0,
        suggestionCount: 0,
      })
      .returning(),
    'e2e context-trace run',
  );

  // Mirrors exactly what `assemblePrompt`'s `specs` slot renders
  // (`wrapUntrusted('spec-0', …)`, `reviewer-core/src/prompt.ts:37-41,125`) —
  // this is a canned trace, not a real engine call, so it has to reproduce
  // the engine's own wrapping to be a faithful fixture.
  const specsBlock = `<untrusted source="spec-0">\n${SPECS_FIXTURE_BODY}\n</untrusted>`;
  const systemPrompt = SECURITY_REVIEWER_PROMPT;
  const user = `## Project context\n${specsBlock}\n\n## Diff to review\n<untrusted source="diff">\n(diff omitted from this seed fixture)\n</untrusted>`;

  await db.insert(t.runTraces).values({
    runId: run.id,
    trace: {
      config: { agent: 'Security Reviewer', version: '1', provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, pr: 482, source: 'local' },
      stats: { duration_ms: 4200, tokens_in: 1800, tokens_out: 240, cost_usd: 0.004, findings: 0, grounding: '0/0 passed' },
      intent_stats: null,
      prompt_assembly: {
        system: systemPrompt,
        skills: null,
        memory: null,
        specs: specsBlock,
        callers: null,
        repo_map: null,
        pr_description: null,
        intent: null,
        user,
        section_sizes: [
          { section: 'specs', chars: specsBlock.length, est_tokens: Math.ceil(specsBlock.length / 4) },
        ],
      },
      tool_calls: [],
      raw_output: '',
      memory_pulled: [],
      specs_read: [SPECS_FIXTURE_PATH],
      log: [{ t: '00.00', kind: 'info', msg: `Project context in prompt (1): ${SPECS_FIXTURE_PATH}` }],
    },
  });
}

/**
 * Seed the starter's demo data. Idempotent: re-running upserts the default
 * workspace/user and the demo fixtures.
 *
 * Seeds: default workspace + system user + membership, default settings,
 * demo repo (acme/payments-api), PR #482 with files/commits, a sample review
 * with a few findings, the five built-in agents (General + Security +
 * Performance + Test Quality + API Contract), all on the default
 * openrouter/deepseek-v4-flash provider+model, and the built-in skills, linked
 * in prompt order to the two agents that use them.
 *
 * Course lessons populate the other tables (conventions, memory, eval, …) once
 * their features are built — they start empty here.
 */

export const DEFAULT_WORKSPACE_NAME = 'default';
export const SYSTEM_USER_EMAIL = 'you@local';

/**
 * Unwrap the single row a `.returning()` insert is contractually required to
 * produce. If the driver ever hands back nothing the seed is broken, so fail
 * loudly here rather than propagating an `undefined` id into the next insert.
 */
function insertedRow<T>(rows: T[], what: string): T {
  const [row] = rows;
  if (!row) throw new Error(`seed: inserting the ${what} returned no row`);
  return row;
}

export async function seed(db: Db): Promise<{ workspaceId: string; userId: string }> {
  // ---- workspace + user (no-auth defaults) ----
  const [existingWs] = await db
    .select()
    .from(t.workspaces)
    .where(eq(t.workspaces.name, DEFAULT_WORKSPACE_NAME));
  const ws =
    existingWs ??
    insertedRow(
      await db.insert(t.workspaces).values({ name: DEFAULT_WORKSPACE_NAME }).returning(),
      'default workspace',
    );
  const workspaceId = ws.id;

  const [existingUser] = await db
    .select()
    .from(t.users)
    .where(eq(t.users.email, SYSTEM_USER_EMAIL));
  const user =
    existingUser ??
    insertedRow(
      await db.insert(t.users).values({ email: SYSTEM_USER_EMAIL, name: 'You' }).returning(),
      'system user',
    );
  const userId = user.id;

  await db
    .insert(t.workspaceMembers)
    .values({ workspaceId, userId, role: 'owner' })
    .onConflictDoNothing();

  // ---- default settings ----
  const defaultSettings: Record<string, unknown> = {
    polling_interval_min: 5,
    theme: 'dark',
    density: 'regular',
    sync_to_folder: true,
  };
  for (const [key, value] of Object.entries(defaultSettings)) {
    await db
      .insert(t.settings)
      .values({ workspaceId, userId, key, value })
      .onConflictDoNothing();
  }

  // ---- demo repo (acme/payments-api) ----
  const [existingRepo] = await db
    .select()
    .from(t.repos)
    .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.fullName, 'acme/payments-api')));
  const repo =
    existingRepo ??
    insertedRow(
      await db
        .insert(t.repos)
        .values({
          workspaceId,
          owner: 'acme',
          name: 'payments-api',
          fullName: 'acme/payments-api',
          defaultBranch: 'main',
          clonePath: null,
          createdBy: userId,
        })
        .returning(),
      'demo repo',
    );
  const repoId = repo.id;

  // Behind a flag (default off, R-9) — writes a three-file `.devdigest`
  // fixture and points the seeded repo's clonePath at it, so e2e flows have
  // a working copy to discover documents in.
  if (SEED_CONTEXT_FIXTURE) {
    const clonePath = join(resolveCloneDir(), 'acme', 'payments-api');
    await writeContextFixture(clonePath);
    await db.update(t.repos).set({ clonePath }).where(eq(t.repos.id, repoId));
  }

  // ---- PR #482 (rate limiting) ----
  const [existingPr] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, 482)));
  // Captured outside the `if` so the context-trace seeding below (which needs
  // an agent, seeded further down this function) can find PR 482 either way.
  let prId482 = existingPr?.id;
  if (!existingPr) {
    const pr = insertedRow(
      await db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: 482,
          title: 'Add rate limiting to public API endpoints',
          author: 'marisa.koch',
          branch: 'feat/rate-limit-public',
          base: 'main',
          headSha: 'a1b2c3d4e5f6',
          additions: 247,
          deletions: 38,
          filesCount: 9,
          status: 'needs_review',
          body: 'Add rate limiting to public API endpoints to prevent abuse from unauthenticated clients.',
        })
        .returning(),
      'demo pull request',
    );
    const prId = pr.id;
    prId482 = prId;

    // pr_files (subset)
    await db.insert(t.prFiles).values([
      { prId, path: 'src/middleware/ratelimit.ts', additions: 84, deletions: 0 },
      { prId, path: 'src/api/public/webhooks.ts', additions: 31, deletions: 6 },
      { prId, path: 'src/config.ts', additions: 4, deletions: 0 },
      { prId, path: 'src/api/users.ts', additions: 7, deletions: 2 },
    ]);

    // pr_commits
    await db.insert(t.prCommits).values({
      prId,
      sha: 'a1b2c3d4e5f6',
      message: 'Add token-bucket rate limiter',
      author: 'marisa.koch',
    });

    // a sample review + findings so the PR shows results before the first run
    const review = insertedRow(
      await db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId,
          kind: 'review',
          verdict: 'request_changes',
          summary:
            'Solid middleware approach, but a Stripe secret key is committed in plaintext and the user-list endpoint introduces an N+1 query under the new limiter.',
          score: 61,
          model: 'seed',
        })
        .returning(),
      'sample review',
    );
    const reviewId = review.id;

    await db.insert(t.findings).values([
      {
        reviewId,
        file: 'src/config.ts',
        startLine: 12,
        endLine: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key in commit',
        rationale: 'Line 12 contains a literal `sk_live_` Stripe secret key.',
        suggestion: 'Move to env var and rotate the key immediately.',
        confidence: 0.98,
      },
      {
        reviewId,
        file: 'src/api/users.ts',
        startLine: 45,
        endLine: 52,
        severity: 'WARNING',
        category: 'perf',
        title: 'N+1 query in user list endpoint',
        rationale: 'Loop issues one query per user → N+1.',
        suggestion: 'Use a single IN query and group in memory.',
        confidence: 0.86,
      },
      {
        reviewId,
        file: 'src/middleware/ratelimit.ts',
        startLine: 63,
        endLine: 71,
        severity: 'SUGGESTION',
        category: 'style',
        title: 'Extract the bucket-refill math into a named helper',
        rationale:
          'The refill computation is inlined in the request path and repeated in the tests. A named helper would make the token-bucket semantics readable.',
        suggestion: 'Extract `refillTokens(bucket, now)` and call it from both sites.',
        confidence: 0.55,
      },
      {
        reviewId,
        file: 'src/api/public/webhooks.ts',
        startLine: 18,
        endLine: 18,
        severity: 'WARNING',
        category: 'style',
        title: 'Prefer const over let for the unmutated limiter handle',
        rationale: 'Declared with `let` but never reassigned.',
        suggestion: 'Change to `const`.',
        confidence: 0.41,
        // Seeded as DISMISSED on purpose: the PR-list FINDINGS column must
        // exclude it from both the badge counts and the hover popup, so a
        // regression in that filter is visible on seeded data with no setup.
        dismissedAt: new Date('2026-06-01T12:00:00Z'),
      },
    ]);
  }

  // ---- built-in agents ----
  // Prompt bodies live in ./seed-prompts.ts (mirrored in docs/agent-prompts/*.md).
  const seedAgents: Array<typeof t.agents.$inferInsert> = [
    {
      workspaceId,
      name: 'General Reviewer',
      description: 'Reviews a PR diff for bugs, correctness, and clarity.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: GENERAL_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Security Reviewer',
      description: 'Flags secrets, injection, SSRF and the lethal trifecta before merge.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: SECURITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Performance Reviewer',
      description: 'Catches N+1 queries, missing indexes, and hot-path allocations.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: PERFORMANCE_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'Test Quality Reviewer',
      description:
        'Checks the tests, not the code: uncovered branches, missing corner cases, over-mocking.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: TEST_QUALITY_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
    {
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Catches breaking changes to routes, schemas, signatures and columns.',
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      systemPrompt: API_CONTRACT_REVIEWER_PROMPT,
      enabled: true,
      version: 1,
      createdBy: userId,
    },
  ];
  for (const a of seedAgents) {
    const [existing] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, a.name)));
    if (!existing) await db.insert(t.agents).values(a);
  }

  // Same flag as the .devdigest fixture (R-9): only the e2e-only trace needs
  // this, and only once both the PR and the agent it references exist.
  if (SEED_CONTEXT_FIXTURE && prId482) {
    const [securityAgent] = await db
      .select({ id: t.agents.id })
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'Security Reviewer')));
    if (securityAgent) await seedContextTrace(db, workspaceId, prId482, securityAgent.id);
  }

  await seedSkills(db, workspaceId);

  // Record the v1 config snapshot for every agent that lacks one.
  //
  // MUST run after seedSkills: a snapshot's `config_json.skills` is the agent's
  // attached skill ids, and those links are created in there. Snapshotting
  // earlier would freeze an empty skill list.
  //
  // The agents above are inserted with raw Drizzle rather than through
  // `AgentsRepository.insert()`, so they never get the snapshot that
  // `insert()`/`update()` would have written — and without it every eval run
  // fails `missing_version`. This also backfills databases seeded before this
  // fix. Idempotent, so it is a no-op on an already-correct database.
  await backfillAgentVersions(db, workspaceId);

  return { workspaceId, userId };
}

/**
 * Give every agent in the workspace a config snapshot for its current version.
 *
 * Delegates to `AgentsRepository` rather than inserting into `agent_versions`
 * here: the `config_json` shape is what the eval executor replays, and a second
 * copy of it in the seed would drift from the real one silently.
 */
async function backfillAgentVersions(db: Db, workspaceId: string): Promise<void> {
  const { AgentsRepository } = await import('../modules/agents/repository.js');
  const repo = new AgentsRepository(db);
  const rows = await db
    .select({ id: t.agents.id, name: t.agents.name })
    .from(t.agents)
    .where(eq(t.agents.workspaceId, workspaceId));

  let added = 0;
  for (const a of rows) {
    if (await repo.ensureCurrentVersionSnapshot(a.id)) added++;
  }
  if (added > 0) console.log(`  agent_versions: backfilled ${added} missing v1 snapshot(s)`);
}

/**
 * Seed the built-in skills and attach them to the agents that use them.
 *
 * Idempotent in the same shape as the agents above: a skill is inserted only
 * when no skill of that name exists in the workspace, so re-running the seed
 * never clobbers a body the user has since edited (and never bumps its version).
 * Links are upserted, because the order is part of the preset.
 */
async function seedSkills(db: Db, workspaceId: string): Promise<void> {
  const idByName = new Map<string, string>();

  for (const skill of SEED_SKILLS) {
    const [existing] = await db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, skill.name)));

    if (existing) {
      idByName.set(skill.name, existing.id);
      continue;
    }

    const row = insertedRow(
      await db
        .insert(t.skills)
        .values({
          workspaceId,
          name: skill.name,
          description: skill.description,
          type: skill.type,
          source: 'manual',
          body: skill.body,
          enabled: true,
          version: 1,
        })
        .returning(),
      `skill "${skill.name}"`,
    );
    idByName.set(skill.name, row.id);
    // Mirror the repository's contract: v1 is a real snapshot, so the history a
    // seeded skill shows is the same shape as a hand-created one's.
    await db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version: 1, body: skill.body })
      .onConflictDoNothing();
  }

  for (const [agentName, skillNames] of Object.entries(SEED_AGENT_SKILLS)) {
    const [agent] = await db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, agentName)));
    if (!agent) continue;

    for (const [order, skillName] of skillNames.entries()) {
      const skillId = idByName.get(skillName);
      if (!skillId) continue;
      await db
        .insert(t.agentSkills)
        .values({ agentId: agent.id, skillId, order })
        .onConflictDoUpdate({
          target: [t.agentSkills.agentId, t.agentSkills.skillId],
          set: { order },
        });
    }
  }
}

// CLI entrypoint
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  const handle = createDb(url);
  seed(handle.db)
    .then(async (r) => {
      console.log('✓ seeded', r);
      await handle.close();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('✗ seed failed:', err);
      await handle.close();
      process.exit(1);
    });
}
