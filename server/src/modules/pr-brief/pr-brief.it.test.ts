/**
 * GET /pulls/:id/brief, POST /pulls/:id/brief/refresh (Testcontainers Postgres).
 *
 * DB-backed coverage for the PR Brief module (SPEC-cross-06). Covers spec
 * acceptance criteria:
 *   AC-1  — never-generated PR → cached GET returns `null`, no LLM call
 *   AC-2  — refresh makes exactly one structured LLM call, persists keyed to head_sha
 *   AC-5  — refresh route rate-limited at { max: 10, timeWindow: '1 minute' }
 *   AC-11 — no cached Intent, no indexed Blast → still generates, records signals_used
 *
 * Fixture setup mirrors blast/blast.it.test.ts (startPg → seed → makeRepo/makePr).
 * The LLM call is injected via `ContainerOverrides.llm.openai` (a mock
 * `completeStructured`) — this test never calls a real provider.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { PrBrief } from '@devdigest/shared';
import type { LLMProvider } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
// `app.ts` disables the rate-limit plugin entirely under NODE_ENV=test ("so
// integration suites can hammer endpoints via inject()") — so AC-5 needs a
// config that keeps it registered. LOG_LEVEL=silent avoids the
// nodeEnv==='development' pino-pretty transport in test output.
const rateLimitedConfig = () =>
  loadConfig({ ...process.env, NODE_ENV: 'development', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

let repoSeq = 0;
let prSeq = 0;

async function makeRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `brief-pr-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

async function makePr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  repoId: string,
  headSha = 'deadbeef',
) {
  const number = ++prSeq;
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId,
      number,
      title: `PR ${number}`,
      author: 'alice',
      branch: `branch-${number}`,
      base: 'main',
      headSha,
      additions: 5,
      deletions: 1,
      filesCount: 1,
      status: 'open',
    })
    .returning();
  return pr!;
}

function makeLlmMock(data?: Record<string, unknown>): LLMProvider {
  const completeStructured = vi.fn().mockResolvedValue({
    data: data ?? {
      what: 'Adds a caching layer to the read path.',
      why: 'Cut p95 latency on repeated queries.',
      risk_level: 'low',
      risks: [],
      review_focus: [],
    },
    tokensIn: 120,
    tokensOut: 80,
    costUsd: 0.02,
  });
  return {
    id: 'openai',
    listModels: vi.fn().mockResolvedValue([]),
    complete: vi.fn(),
    completeStructured,
    embed: vi.fn(),
  } as unknown as LLMProvider;
}

d('PR Brief — GET /pulls/:id/brief, POST /pulls/:id/brief/refresh (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it('AC-1 — never-generated PR: cached GET returns null, makes no LLM call', async () => {
    const repo = await makeRepo(pg.handle.db, workspaceId);
    const pr = await makePr(pg.handle.db, workspaceId, repo.id, 'sha-ac1');
    const llm = makeLlmMock();

    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });
    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    expect((llm.completeStructured as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('404 for a non-existent PR id', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/00000000-0000-0000-0000-000000000000/brief`,
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it('AC-2 — refresh makes exactly one structured LLM call and persists keyed to head_sha; cached GET reflects it without another call', async () => {
    const repo = await makeRepo(pg.handle.db, workspaceId);
    const pr = await makePr(pg.handle.db, workspaceId, repo.id, 'sha-ac2');
    const llm = makeLlmMock();

    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });

    const refreshRes = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/refresh` });
    expect(refreshRes.statusCode).toBe(200);
    const refreshed = PrBrief.parse(refreshRes.json());
    expect(refreshed.head_sha).toBe('sha-ac2');
    expect(refreshed.what).toBe('Adds a caching layer to the read path.');
    expect((llm.completeStructured as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/brief` });
    expect(getRes.statusCode).toBe(200);
    const cached = PrBrief.parse(getRes.json());
    expect(cached.head_sha).toBe('sha-ac2');
    // Cached read never calls the model.
    expect((llm.completeStructured as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('AC-11 — no cached Intent, no indexed Blast: still generates and records signals_used without them', async () => {
    const repo = await makeRepo(pg.handle.db, workspaceId);
    const pr = await makePr(pg.handle.db, workspaceId, repo.id, 'sha-ac11');
    // Deliberately no pr_intent row, no repo_index_state row.
    const llm = makeLlmMock();

    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });
    const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/refresh` });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = PrBrief.parse(res.json());
    expect(body.signals_used).toContain('diff_shape');
    expect(body.signals_used).not.toContain('intent');
    expect(body.signals_used).not.toContain('blast');
  });

  it('AC-5 — refresh route is rate-limited at 10/minute; the 11th call in the window is rejected with 429', async () => {
    const repo = await makeRepo(pg.handle.db, workspaceId);
    const pr = await makePr(pg.handle.db, workspaceId, repo.id, 'sha-ac5');
    const llm = makeLlmMock();

    const app = await buildApp({
      config: rateLimitedConfig(),
      db: pg.handle.db,
      overrides: { llm: { openai: llm } },
    });

    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/brief/refresh` });
      statuses.push(res.statusCode);
    }
    await app.close();

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });
});
