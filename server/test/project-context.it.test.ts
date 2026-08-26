import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  console.warn('[project-context] Docker not available — skipping integration tests.');
}

/**
 * Project Context — discovery, single-doc read, and attachment, end to end
 * over a real Postgres + a real fs working copy. Covers the twelve
 * `*.it.test.ts`-verified criteria named for Step 9 of the plan.
 */
d('project context', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });

  afterAll(async () => {
    await Promise.all(clonePaths.map((p) => rm(p, { recursive: true, force: true })));
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      db: pg.handle.db,
    });
  }
  type App = Awaited<ReturnType<typeof makeApp>>;

  const clonePaths: string[] = [];

  /** A cloned repo with a real `.devdigest/{specs,docs,insights}` fixture on disk. */
  async function makeClonedRepo(): Promise<{ id: string; clonePath: string }> {
    const clonePath = await mkdtemp(join(tmpdir(), 'devdigest-context-it-'));
    clonePaths.push(clonePath);
    await mkdir(join(clonePath, '.devdigest', 'specs'), { recursive: true });
    await mkdir(join(clonePath, '.devdigest', 'docs'), { recursive: true });
    await writeFile(
      join(clonePath, '.devdigest', 'specs', 'public-api.md'),
      '# Public API\n\nRate limit every public endpoint.',
    );
    await writeFile(join(clonePath, '.devdigest', 'docs', 'guide.md'), '# Guide\n\nHow to ship.');
    // A non-.md file must never be listed (AC-3).
    await writeFile(join(clonePath, '.devdigest', 'docs', 'notes.txt'), 'not markdown');
    const name = `payments-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();
    if (!repo) throw new Error('failed to insert fixture repo');
    return { id: repo.id, clonePath };
  }

  async function makeUnclonedRepo(): Promise<string> {
    const name = `uncloned-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath: null })
      .returning();
    if (!repo) throw new Error('failed to insert uncloned repo');
    return repo.id;
  }

  async function makeAgent(app: App, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review the diff.' },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function makeSkill(app: App, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name, description: 'x', type: 'rubric', body: '# rule', enabled: true },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  it('lists every .md document in the working copy, with metadata and no content, envelope-shaped (AC-1)', async () => {
    const app = await makeApp();
    const { id: repoId } = await makeClonedRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    const { files: docs, truncated, shown } = res.json();

    expect(docs).toHaveLength(2); // notes.txt excluded (AC-3)
    expect(truncated).toBe(false);
    expect(shown).toBe(2);
    const spec = docs.find((doc: { path: string }) => doc.path === 'specs/public-api.md');
    expect(spec).toMatchObject({ type: 'specs', content: null });
    expect(spec.size).toBeGreaterThan(0);
    expect(spec.updated_at).toEqual(expect.any(String));

    await app.close();
  });

  it('discovers .md files anywhere outside .devdigest and omits files under excluded directories, at any depth (AC-1, AC-1a, AC-2, EC-20)', async () => {
    const app = await makeApp();
    const { id: repoId, clonePath } = await makeClonedRepo();

    // Newly discoverable under the amendment — outside .devdigest entirely.
    await writeFile(join(clonePath, 'README.md'), '# Root README');
    await mkdir(join(clonePath, 'docs'), { recursive: true });
    await writeFile(join(clonePath, 'docs', 'guide2.md'), '# A second, top-level guide');

    // Excluded — must never appear in the list (EC-20), at any depth.
    await mkdir(join(clonePath, 'node_modules', 'some-pkg'), { recursive: true });
    await writeFile(join(clonePath, 'node_modules', 'some-pkg', 'readme.md'), '# nope');
    await mkdir(join(clonePath, 'sub', '.git'), { recursive: true });
    await writeFile(join(clonePath, 'sub', '.git', 'x.md'), '# nope');
    await mkdir(join(clonePath, 'server', 'clones', 'whatever'), { recursive: true });
    await writeFile(join(clonePath, 'server', 'clones', 'whatever', 'x.md'), '# nope');
    // A legitimate .md next to an excluded dir must still be found — the
    // exclusion list shapes the LIST, not what may be read.
    await writeFile(join(clonePath, 'server', 'ok.md'), '# ok, not under clones');

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(200);
    const { files } = res.json();
    const byPath = new Map(files.map((f: { path: string; type: string }) => [f.path, f.type]));

    expect(byPath.get('README.md')).toBe('docs');
    expect(byPath.get('docs/guide2.md')).toBe('docs');
    expect(byPath.get('server/ok.md')).toBe('docs');
    // The pre-existing .devdigest fixture is untouched and still present.
    expect(byPath.get('specs/public-api.md')).toBe('specs');
    expect(byPath.get('docs/guide.md')).toBe('docs');
    // None of the excluded-directory files leaked into the list.
    for (const path of files.map((f: { path: string }) => f.path)) {
      expect(path).not.toMatch(/node_modules|(^|\/)\.git\/|server\/clones/);
    }

    await app.close();
  });

  it('does not descend into a symlinked excluded directory (EC-23)', async () => {
    const app = await makeApp();
    const { id: repoId, clonePath } = await makeClonedRepo();
    // Real content lives OUTSIDE the working copy, reachable only via the
    // `node_modules` symlink — isolates "never follow a symlink" from "the
    // target's own name isn't excluded", which would confound the assertion.
    const outside = await mkdtemp(join(tmpdir(), 'devdigest-context-it-outside-'));
    clonePaths.push(outside);
    await writeFile(join(outside, 'x.md'), '# nope, only reachable via the symlink');
    await symlink(outside, join(clonePath, 'node_modules'), 'dir');

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const { files } = res.json();
    expect(files.map((f: { path: string }) => f.path)).toEqual(['docs/guide.md', 'specs/public-api.md']);

    await app.close();
  });

  it('returns an empty list, not an error, when a repository has no discoverable markdown (AC-5)', async () => {
    const app = await makeApp();
    const clonePath = await mkdtemp(join(tmpdir(), 'devdigest-context-it-empty-'));
    clonePaths.push(clonePath);
    const name = `no-devdigest-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}`, clonePath })
      .returning();

    const res = await app.inject({ method: 'GET', url: `/repos/${repo!.id}/context` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ files: [], truncated: false, shown: 0 });

    await app.close();
  });

  it('responds with a DISTINCT not-synced error when the repo has no working copy (AC-6)', async () => {
    const app = await makeApp();
    const repoId = await makeUnclonedRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('repo_not_synced');
    expect(res.json().error.code).not.toBe('validation_error');

    await app.close();
  });

  it('returns a single document\'s full text verbatim (AC-9)', async () => {
    const app = await makeApp();
    const { id: repoId } = await makeClonedRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=specs/public-api.md`,
    });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.content).toBe('# Public API\n\nRate limit every public endpoint.');
    expect(doc.path).toBe('specs/public-api.md');
    expect(doc.type).toBe('specs');

    await app.close();
  });

  it('rejects a traversal path with 422, without reading any file (AC-4)', async () => {
    const app = await makeApp();
    const { id: repoId } = await makeClonedRepo();

    const read = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?${new URLSearchParams({ path: '../../etc/passwd' })}`,
    });
    expect(read.statusCode).toBe(422);

    const absolute = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?${new URLSearchParams({ path: '/etc/passwd' })}`,
    });
    expect(absolute.statusCode).toBe(422);

    await app.close();
  });

  it('rejects an attach request naming a traversal path with 422, persisting nothing (AC-16)', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, 'Traversal Agent');

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { paths: ['specs/public-api.md', '../../etc/passwd'] },
    });
    expect(res.statusCode).toBe(422);

    const links = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-docs` });
    expect(links.json()).toEqual([]);

    await app.close();
  });

  it('attach/reorder round-trip, on both an agent and a skill (AC-13, AC-14, AC-15)', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, 'Attach Agent');
    const skill = await makeSkill(app, 'Attach Skill');

    const attach = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { paths: ['specs/public-api.md', 'docs/guide.md'] },
    });
    expect(attach.statusCode).toBe(200);
    expect(attach.json().map((l: { path: string }) => l.path)).toEqual([
      'specs/public-api.md',
      'docs/guide.md',
    ]);

    const reordered = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { paths: ['docs/guide.md', 'specs/public-api.md'] },
    });
    expect(reordered.statusCode).toBe(200);

    const reread = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-docs` });
    expect(reread.json().map((l: { path: string }) => l.path)).toEqual([
      'docs/guide.md',
      'specs/public-api.md',
    ]);

    const skillAttach = await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context-docs`,
      payload: { paths: ['specs/public-api.md'] },
    });
    expect(skillAttach.statusCode).toBe(200);
    const skillLinks = await app.inject({ method: 'GET', url: `/skills/${skill.id}/context-docs` });
    expect(skillLinks.json()).toHaveLength(1);

    await app.close();
  });

  it('a document deleted and re-created at the same path is still attached (AC-17)', async () => {
    const app = await makeApp();
    const { id: repoId, clonePath } = await makeClonedRepo();
    const agent = await makeAgent(app, 'Survives Delete Agent');

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { paths: ['specs/public-api.md'] },
    });

    await rm(join(clonePath, '.devdigest', 'specs', 'public-api.md'));
    const stillAttached = await app.inject({ method: 'GET', url: `/agents/${agent.id}/context-docs` });
    expect(stillAttached.json().map((l: { path: string }) => l.path)).toEqual(['specs/public-api.md']);

    await mkdir(join(clonePath, '.devdigest', 'specs'), { recursive: true });
    await writeFile(join(clonePath, '.devdigest', 'specs', 'public-api.md'), '# Public API v2');
    const reread = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/context/doc?path=specs/public-api.md`,
    });
    expect(reread.json().content).toBe('# Public API v2');

    await app.close();
  });

  it('used_by_agents counts direct AND inherited (through an enabled skill) attachments (AC-20)', async () => {
    const app = await makeApp();
    const { id: repoId, clonePath } = await makeClonedRepo();
    // `context_doc_links.path` is workspace-scoped, not repo-scoped (EC-12: the
    // same path can be attached against many repos), so every OTHER test in
    // this file that attaches "specs/public-api.md" also contributes to that
    // path's used_by_agents count. A path unique to this test isolates it.
    const uniquePath = 'specs/used-by-agents-only.md';
    await writeFile(join(clonePath, '.devdigest', uniquePath), '# Unique to this test');
    const directAgent = await makeAgent(app, 'Direct User');
    const inheritingAgent = await makeAgent(app, 'Inheriting User');
    const skill = await makeSkill(app, 'Shared Skill');

    await app.inject({
      method: 'POST',
      url: `/agents/${directAgent.id}/context-docs`,
      payload: { paths: [uniquePath] },
    });
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context-docs`,
      payload: { paths: [uniquePath] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${inheritingAgent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const doc = res.json().files.find((d: { path: string }) => d.path === uniquePath);
    expect(doc.used_by_agents).toBe(2);

    await app.close();
  });

  it('used_by_agents counts a document reached ONLY through skill inheritance — zero direct attachments (US-8, AC-20)', async () => {
    const app = await makeApp();
    const { id: repoId, clonePath } = await makeClonedRepo();
    // Isolated path — see the note in the previous test about workspace-wide
    // `context_doc_links.path` sharing across every test in this file.
    const uniquePath = 'specs/inherited-only.md';
    await writeFile(join(clonePath, '.devdigest', uniquePath), '# Inherited only');
    const skill = await makeSkill(app, 'Inherit-Only Skill');
    const agentA = await makeAgent(app, 'Inheritor A');
    const agentB = await makeAgent(app, 'Inheritor B');

    // The document is attached ONLY to the skill — never directly to either agent.
    await app.inject({
      method: 'POST',
      url: `/skills/${skill.id}/context-docs`,
      payload: { paths: [uniquePath] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agentA.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agentB.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const doc = res.json().files.find((d: { path: string }) => d.path === uniquePath);
    // Direct-attachment-only counting would report 0 here — the exact
    // misleading number the spec's Inputs and provenance section calls out.
    expect(doc.used_by_agents).toBe(2);

    await app.close();
  });

  it('excludes a document only reachable via a GLOBALLY DISABLED skill from used_by_agents (EC-9, AC-20)', async () => {
    const app = await makeApp();
    const { id: repoId, clonePath } = await makeClonedRepo();
    const uniquePath = 'specs/disabled-skill-only.md';
    await writeFile(join(clonePath, '.devdigest', uniquePath), '# Behind a disabled skill');

    const disabledSkillRes = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: { name: 'Disabled Skill', description: 'x', type: 'rubric', body: '# rule', enabled: false },
    });
    expect(disabledSkillRes.statusCode).toBe(201);
    const disabledSkill = disabledSkillRes.json();
    const agent = await makeAgent(app, 'Would-Be Inheritor');

    await app.inject({
      method: 'POST',
      url: `/skills/${disabledSkill.id}/context-docs`,
      payload: { paths: [uniquePath] },
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [disabledSkill.id] },
    });

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/context` });
    const doc = res.json().files.find((d: { path: string }) => d.path === uniquePath);
    // A globally disabled skill contributes nothing (`specs/01-skills.md`) —
    // the kill switch beats attachment for used_by_agents too, not just at
    // run time.
    expect(doc.used_by_agents).toBe(0);

    await app.close();
  });

  it('leaves the agent\'s version unchanged when its attached documents change (AC-21)', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, 'Version Stable Agent');
    const versionsBefore = await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` });

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { paths: ['specs/public-api.md', 'docs/guide.md'] },
    });

    const after = await app.inject({ method: 'GET', url: `/agents/${agent.id}` });
    expect(after.json().version).toBe(agent.version);

    const versionsAfter = await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` });
    expect(versionsAfter.json()).toHaveLength(versionsBefore.json().length);

    await app.close();
  });

  it('deletes an agent\'s context_doc_links when the agent is deleted (no FK — application cleanup)', async () => {
    const app = await makeApp();
    const agent = await makeAgent(app, 'Deleted Agent');
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/context-docs`,
      payload: { paths: ['specs/public-api.md'] },
    });

    await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });

    const orphans = await pg.handle.db
      .select()
      .from(t.contextDocLinks)
      .where(eq(t.contextDocLinks.ownerId, agent.id));
    expect(orphans).toEqual([]);

    await app.close();
  });
});
