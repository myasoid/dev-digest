/**
 * POST /repos/:id/blast (Testcontainers Postgres).
 *
 * Real DB coverage for the thin route added on top of the already-existing
 * `RepoIntelService.getBlastRadius()` (service.ts:220-304): a schema-valid
 * `BlastResult` for a repo with a persistent index (`repo_index_state.status
 * = 'full'` + matching `symbols` rows — exercises `tryPersistentBlast`), and
 * a plain 200 with `degraded: true` + a `reason` (never a 500) for a repo
 * that hasn't been indexed at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { BlastResult } from '@devdigest/shared';
import { INDEXER_VERSION } from './constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** A bare repo (no clone, no GitHub sync) in the given workspace. */
async function makeRepo(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `blast-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  return repo!;
}

d('POST /repos/:id/blast (Testcontainers pg)', () => {
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

  async function appAndPost(repoId: string, changedFiles: string[]) {
    const app = await buildApp({ config: config(), db: pg.handle.db });
    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/blast`,
      payload: { changed_files: changedFiles },
    });
    await app.close();
    return res;
  }

  it('returns a schema-valid BlastResult for a repo with a persistent index', async () => {
    const repo = await makeRepo(pg.handle.db, workspaceId);
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: repo.id,
      lastIndexedSha: 'deadbeef',
      indexerVersion: INDEXER_VERSION,
      status: 'full',
      filesIndexed: 1,
      filesSkipped: 0,
      stats: {},
    });
    await pg.handle.db.insert(t.symbols).values({
      repoId: repo.id,
      path: 'src/foo.ts',
      name: 'doFoo',
      kind: 'function',
      line: 1,
      endLine: 3,
      exported: true,
    });

    const res = await appAndPost(repo.id, ['src/foo.ts']);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Throws if the route's actual payload doesn't match the promoted
    // contract — the whole point of Step 1's Zod promotion.
    const parsed = BlastResult.parse(body);
    expect(parsed.degraded).toBe(false);
    expect(parsed.changedSymbols).toEqual([{ file: 'src/foo.ts', name: 'doFoo', kind: 'function' }]);
  });

  it('an unindexed repo returns degraded: true with a reason, never a 500', async () => {
    const repo = await makeRepo(pg.handle.db, workspaceId);
    // No repo_index_state row, no clonePath — the facade's fully-degraded path.

    const res = await appAndPost(repo.id, ['src/bar.ts']);
    expect(res.statusCode).toBe(200);
    const body = BlastResult.parse(res.json());
    expect(body.degraded).toBe(true);
    expect(body.reason).toBeDefined();
  });
});
