import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FsContextDocsAdapter } from './fs.js';
import { MAX_CONTEXT_DOCS } from './constants.js';
import { ContextDocReadError, ContextDocTraversalError, typeForContextDocPath } from './types.js';

/**
 * AC-11: "IF a document cannot be decoded as UTF-8 text, THEN the system
 * shall respond with an error naming the path instead of any partial
 * content." `MockContextDocsPort` stores already-decoded strings, so it
 * cannot reproduce a decode failure — only the real fs-backed adapter reads
 * raw bytes off disk, so this exercises `FsContextDocsAdapter` directly
 * against a real invalid-UTF-8 fixture file.
 */
describe('FsContextDocsAdapter — AC-11 invalid UTF-8', () => {
  const adapter = new FsContextDocsAdapter();
  let clonePath: string;

  beforeEach(async () => {
    clonePath = await fs.mkdtemp(join(tmpdir(), 'devdigest-context-docs-'));
    await fs.mkdir(join(clonePath, '.devdigest', 'specs'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(clonePath, { recursive: true, force: true });
  });

  it('rejects a document with an invalid UTF-8 byte sequence, naming the path, without returning partial content', async () => {
    const relPath = 'specs/bad-encoding.md';
    // 0xC3 starts a two-byte UTF-8 sequence but is immediately followed by an
    // ASCII byte instead of a valid continuation byte (0x80-0xBF) — an
    // undecodable sequence rather than a merely unusual one.
    await fs.writeFile(
      join(clonePath, '.devdigest', relPath),
      Buffer.from([0x68, 0x69, 0xc3, 0x28, 0x6f, 0x6b]),
    );

    const attempt = adapter.read(clonePath, relPath);

    await expect(attempt).rejects.toBeInstanceOf(ContextDocReadError);
    await expect(attempt).rejects.toMatchObject({ path: relPath });
    await expect(attempt).rejects.toThrow(relPath);
  });

  it('still reads a valid UTF-8 document fully, as a control case', async () => {
    const relPath = 'specs/good-encoding.md';
    await fs.writeFile(join(clonePath, '.devdigest', relPath), '# Hello Wörld\n', 'utf8');

    await expect(adapter.read(clonePath, relPath)).resolves.toBe('# Hello Wörld\n');
  });
});

/**
 * `typeForContextDocPath` — the AC-2 heuristic, pinned as pure-function tests
 * before the walk (`fs.ts`) is rewritten to use it (R-D: this heuristic and
 * the EC-20 name-matching are pure string logic and must be unit-tested
 * without a clone). Also the identity-path invariant's backward-compat half:
 * every pre-amendment `.devdigest/{specs,docs,insights}` layout must still
 * classify exactly as it did (AC-2a, EC-21).
 */
describe('typeForContextDocPath (AC-2, AC-2a, EC-21, EC-22)', () => {
  it('a base name of insights.md classifies as insights at any depth (AC-2)', () => {
    expect(typeForContextDocPath('insights.md')).toBe('insights');
    expect(typeForContextDocPath('deep/nested/path/INSIGHTS.MD')).toBe('insights');
  });

  it('classifies the pre-existing .devdigest/{specs,docs,insights} layout identically (AC-2a, EC-21)', () => {
    expect(typeForContextDocPath('.devdigest/specs/x.md')).toBe('specs');
    expect(typeForContextDocPath('.devdigest/docs/x.md')).toBe('docs');
    // Not literally "insights.md" — classifies via the ancestor `insights/`
    // segment, exactly as the pre-amendment fixed-folder walk did (the seed
    // fixture's `.devdigest/insights/rate-limiting.md` depends on this).
    expect(typeForContextDocPath('.devdigest/insights/rate-limiting.md')).toBe('insights');
  });

  it('classifies plain (non-.devdigest) specs/ and docs/ folders the same way (AC-2a, EC-21)', () => {
    expect(typeForContextDocPath('docs/x.md')).toBe('docs');
    expect(typeForContextDocPath('specs/x.md')).toBe('specs');
    expect(typeForContextDocPath('nested/specs/x.md')).toBe('specs');
  });

  it('uses the NEAREST-to-file specs/docs segment when more than one is present', () => {
    expect(typeForContextDocPath('specs/docs/x.md')).toBe('docs');
    expect(typeForContextDocPath('docs/specs/x.md')).toBe('specs');
  });

  it('a root README.md — no insights.md name and no specs/docs/insights ancestor — defaults to docs (EC-22)', () => {
    expect(typeForContextDocPath('README.md')).toBe('docs');
  });

  it('never returns undefined — the old traversal-signal double duty is gone', () => {
    expect(typeForContextDocPath('config/whatever/notes.md')).toBe('docs');
  });
});

/**
 * `FsContextDocsAdapter.list()` — the whole-working-copy walk (AC-1), the
 * identity-path invariant it must preserve for `.devdigest`-layout files
 * (R-A, AC-2a, EC-21 — the single hardest requirement of this amendment),
 * the exclusion list (AC-1a, EC-20, EC-23) and determinism (NFR-8).
 */
describe('FsContextDocsAdapter.list() — whole-working-copy walk', () => {
  const adapter = new FsContextDocsAdapter();
  let clonePath: string;

  beforeEach(async () => {
    clonePath = await fs.mkdtemp(join(tmpdir(), 'devdigest-context-walk-'));
  });

  afterEach(async () => {
    await fs.rm(clonePath, { recursive: true, force: true });
  });

  it('preserves the historic stripped identity for a .devdigest-layout file (R-A, AC-2a, EC-21)', async () => {
    await fs.mkdir(join(clonePath, '.devdigest', 'specs'), { recursive: true });
    await fs.writeFile(join(clonePath, '.devdigest', 'specs', 'public-api.md'), '# Public API');

    const { docs } = await adapter.list(clonePath);

    expect(docs).toHaveLength(1);
    // NOT '.devdigest/specs/public-api.md' — a naive true-repo-relative walk
    // would silently detach every existing attachment (EC-21).
    expect(docs[0]).toMatchObject({ path: 'specs/public-api.md', type: 'specs' });
  });

  it('discovers a .md file outside .devdigest at its true repo-relative path (AC-1, EC-22)', async () => {
    await fs.writeFile(join(clonePath, 'README.md'), '# Root README');
    await fs.mkdir(join(clonePath, 'docs'), { recursive: true });
    await fs.writeFile(join(clonePath, 'docs', 'guide.md'), '# Guide');

    const { docs } = await adapter.list(clonePath);

    expect(docs).toEqual([
      expect.objectContaining({ path: 'README.md', type: 'docs' }),
      expect.objectContaining({ path: 'docs/guide.md', type: 'docs' }),
    ]);
  });

  it('omits a non-.md file (AC-3)', async () => {
    await fs.mkdir(join(clonePath, 'docs'), { recursive: true });
    await fs.writeFile(join(clonePath, 'docs', 'notes.txt'), 'not markdown');

    const { docs } = await adapter.list(clonePath);
    expect(docs).toEqual([]);
  });

  it('omits a .md file under an excluded directory, at any depth (AC-1a, EC-20)', async () => {
    await fs.mkdir(join(clonePath, 'node_modules', 'some-pkg'), { recursive: true });
    await fs.writeFile(join(clonePath, 'node_modules', 'some-pkg', 'readme.md'), '# nope');
    await fs.mkdir(join(clonePath, 'sub', '.git'), { recursive: true });
    await fs.writeFile(join(clonePath, 'sub', '.git', 'x.md'), '# nope');
    await fs.mkdir(join(clonePath, 'server', 'clones', 'whatever'), { recursive: true });
    await fs.writeFile(join(clonePath, 'server', 'clones', 'whatever', 'x.md'), '# nope');
    // A legitimate .md file next to an excluded dir must still be found —
    // the exclusion list shapes the LIST, not what may be read.
    await fs.writeFile(join(clonePath, 'server', 'ok.md'), '# ok');

    const { docs } = await adapter.list(clonePath);
    expect(docs).toEqual([expect.objectContaining({ path: 'server/ok.md' })]);
  });

  it('does not descend into a symlinked excluded directory, regardless of the exclusion list (EC-23)', async () => {
    // The real content lives OUTSIDE clonePath entirely, reachable only via
    // the `node_modules` symlink — this isolates "never follow a symlink"
    // (the gate that makes this true) from "the target's own name is not
    // excluded" (which would make it independently discoverable and
    // confound the assertion).
    const outside = await fs.mkdtemp(join(tmpdir(), 'devdigest-context-outside-'));
    try {
      await fs.writeFile(join(outside, 'x.md'), '# nope, only reachable via the symlink');
      await fs.symlink(outside, join(clonePath, 'node_modules'), 'dir');

      const { docs } = await adapter.list(clonePath);
      expect(docs).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('returns documents sorted by repository-relative path, not readdir order (NFR-8)', async () => {
    await fs.mkdir(join(clonePath, 'zzz'), { recursive: true });
    await fs.writeFile(join(clonePath, 'zzz', 'a.md'), '# z');
    await fs.writeFile(join(clonePath, 'aaa.md'), '# a');

    const { docs } = await adapter.list(clonePath);
    expect(docs.map((d) => d.path)).toEqual(['aaa.md', 'zzz/a.md']);
  });

  it('returns an empty, non-truncated list for an absent working copy (AC-5)', async () => {
    const result = await adapter.list(join(clonePath, 'does-not-exist'));
    expect(result).toEqual({ docs: [], truncated: false });
  });

  it('caps discovery at MAX_CONTEXT_DOCS and reports truncated (NFR-13)', async () => {
    await fs.mkdir(join(clonePath, 'docs'), { recursive: true });
    const extra = 3;
    for (let i = 0; i < MAX_CONTEXT_DOCS + extra; i++) {
      await fs.writeFile(join(clonePath, 'docs', `f${String(i).padStart(5, '0')}.md`), '# x');
    }

    const { docs, truncated } = await adapter.list(clonePath);
    expect(docs).toHaveLength(MAX_CONTEXT_DOCS);
    expect(truncated).toBe(true);
  });

  it('does not report truncated when the tree has exactly MAX_CONTEXT_DOCS documents', async () => {
    await fs.mkdir(join(clonePath, 'docs'), { recursive: true });
    for (let i = 0; i < MAX_CONTEXT_DOCS; i++) {
      await fs.writeFile(join(clonePath, 'docs', `f${String(i).padStart(5, '0')}.md`), '# x');
    }

    const { docs, truncated } = await adapter.list(clonePath);
    expect(docs).toHaveLength(MAX_CONTEXT_DOCS);
    expect(truncated).toBe(false);
  });
});

/**
 * `FsContextDocsAdapter.read()` containment — re-rooted at the working copy
 * itself rather than `.devdigest` (AC-4, AC-16, EC-14), while still resolving
 * both path shapes the identity invariant allows (R-A).
 */
describe('FsContextDocsAdapter.read() — re-rooted containment', () => {
  const adapter = new FsContextDocsAdapter();
  let clonePath: string;

  beforeEach(async () => {
    clonePath = await fs.mkdtemp(join(tmpdir(), 'devdigest-context-read-'));
  });

  afterEach(async () => {
    await fs.rm(clonePath, { recursive: true, force: true });
  });

  it('reads a true repo-relative path outside .devdigest (R-A)', async () => {
    await fs.mkdir(join(clonePath, 'docs'), { recursive: true });
    await fs.writeFile(join(clonePath, 'docs', 'guide.md'), '# Guide');

    await expect(adapter.read(clonePath, 'docs/guide.md')).resolves.toBe('# Guide');
  });

  it('still reads the legacy stripped identity of a .devdigest-layout file (R-A, EC-21)', async () => {
    await fs.mkdir(join(clonePath, '.devdigest', 'specs'), { recursive: true });
    await fs.writeFile(join(clonePath, '.devdigest', 'specs', 'public-api.md'), '# Public API');

    await expect(adapter.read(clonePath, 'specs/public-api.md')).resolves.toBe('# Public API');
  });

  it('rejects a symlink whose real path escapes the working copy, without a partial read (AC-4, AC-16)', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'devdigest-context-outside-'));
    try {
      await fs.writeFile(join(outside, 'secret.md'), 'do not read me');
      await fs.mkdir(join(clonePath, 'docs'), { recursive: true });
      await fs.symlink(join(outside, 'secret.md'), join(clonePath, 'docs', 'escape.md'));

      const attempt = adapter.read(clonePath, 'docs/escape.md');
      await expect(attempt).rejects.toBeInstanceOf(ContextDocTraversalError);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects a `..`-escape path even though every top-level directory is now legitimate (AC-4)', async () => {
    // Whether this lands as "not found" (no such path under the working
    // copy) or a traversal error (the normalized path happens to exist
    // outside it, e.g. a real /etc/passwd) is environment-dependent — the
    // ONE thing that must always be true is that neither error class ever
    // carries file content, so no partial read is possible either way.
    const attempt = adapter.read(clonePath, '../../etc/passwd');
    await expect(attempt).rejects.toSatisfy(
      (err: unknown) => err instanceof ContextDocReadError || err instanceof ContextDocTraversalError,
    );
  });
});
