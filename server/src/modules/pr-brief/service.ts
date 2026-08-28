import { readFile } from 'node:fs/promises';
import { resolve as resolvePath, sep } from 'node:path';
import type { Container } from '../../platform/container.js';
import type { GitHubClient, PrBrief, UnifiedDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { BlastService } from '../blast/service.js';
import type { ReviewRepository, PullRow } from '../reviews/repository.js';
import {
  BriefModelOutput,
  buildBlastSummary,
  buildBriefPrompt,
  buildDiffShape,
  buildInputSet,
  extractIssueRefs,
  extractSpecPaths,
  extractUrls,
  groundBrief,
  type BriefBlastSummary,
  type ResolvedReference,
} from './pr-brief-signals.js';

/** Max chars read from a resolved in-repo spec file — matches the Intent
 *  Layer's `MAX_SPEC_CHARS`; this is a generation signal, not a viewer. */
const MAX_SPEC_CHARS = 4000;
/** Reprompt-on-schema-failure budget for the brief-generation call. */
const BRIEF_MAX_RETRIES = 2;
const SCHEMA_NAME = 'PrBrief';
/** Below this, an explicit body contributes no resolvable references (mirrors
 *  the Intent Layer's THIN_BODY_CHARS intent, applied only to reference
 *  extraction here — the brief still runs on diff shape + intent + blast). */
const THIN_BODY_CHARS = 20;

/**
 * PR Brief card (SPEC-cross-06) — generates the cached `{ what, why,
 * risk_level, risks[], review_focus[] }` brief with a single structured LLM
 * call. Mirrors `IntentClassifier`'s shape: this service does ALL the I/O
 * (cached Intent read, Blast summary, clone reads, ticket/GitHub issue
 * fetch, the LLM call, and the DB upsert); pure text-shaping and the
 * grounding filter live in the sibling `pr-brief-signals.ts`.
 *
 * Callers decide cache-vs-force: `getCached` never calls the model,
 * `generate` always does (this IS the "force" path — routes.ts wires
 * `GET` → `getCached` and `POST .../refresh` → `generate`).
 */
export class PrBriefService {
  private repo: ReviewRepository;
  private blast: BlastService;

  constructor(private container: Container) {
    this.repo = container.reviewRepo;
    // Instantiated directly, matching how blast/routes.ts obtains a
    // BlastService — it is not exposed on the DI container.
    this.blast = new BlastService(container);
  }

  /** Cached brief for a PR, or `undefined` if one has never been generated. */
  getCached(prId: string): Promise<PrBrief | undefined> {
    return this.repo.getBrief(prId);
  }

  /** Resolves a PR and its repo under the caller's workspace (tenancy — a
   *  caller cannot read or regenerate a brief for a PR outside their
   *  workspace). Kept here, not in routes.ts, so the transport layer stays
   *  Drizzle-free — mirrors BlastService.getBlastMap's own resolution via
   *  ReviewRepository rather than a direct query. */
  async resolvePrAndRepo(workspaceId: string, prId: string) {
    const pr = await this.repo.getPull(workspaceId, prId);
    if (!pr) throw new NotFoundError('Pull request not found');
    const repo = await this.repo.getRepo(pr.repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return { pr, repo };
  }

  /**
   * Run a fresh generation and persist it (overwrites any cached brief — one
   * row per PR, like `pr_intent`). Degrades gracefully when Intent, Blast,
   * the linked issue, or specs are unavailable (AC-11, AC-12): it records
   * which inputs were actually used rather than failing or blocking.
   */
  async generate(
    workspaceId: string,
    pull: PullRow,
    repoRow: { owner: string; name: string; clonePath: string | null },
    diff: UnifiedDiff,
  ): Promise<PrBrief> {
    const title = pull.title ?? '';
    const body = pull.body?.trim() ?? '';
    const thin = body.length < THIN_BODY_CHARS;

    const signalsUsed: string[] = ['diff_shape'];
    const resolvedReferences: ResolvedReference[] = [];

    // Cached Intent (EC-2 — never triggers L03, just reads what's cached).
    const intent = await this.repo.getIntent(pull.id);
    if (intent) signalsUsed.push('intent');

    // Blast summary (EC-2 — never triggers L04; degrades on any failure or
    // a fully-degraded map, since a degraded map carries no real symbols).
    let blastSummary: BriefBlastSummary | null = null;
    try {
      const blastMap = await this.blast.getBlastMap(workspaceId, pull.id);
      if (blastMap.status !== 'degraded') {
        blastSummary = buildBlastSummary(blastMap);
        signalsUsed.push('blast');
      }
    } catch {
      /* degrade — no blast map available for this PR/repo */
    }

    if (!thin) {
      signalsUsed.push('body');

      const specPaths = extractSpecPaths(`${title}\n${body}`);
      for (const path of specPaths) {
        const content = await this.readClonedSpec(repoRow.clonePath, path);
        if (content) {
          resolvedReferences.push({ label: path, content });
          signalsUsed.push(`resolved:${path}`);
        }
      }

      const urls = extractUrls(`${title}\n${body}`);
      for (const url of urls) {
        const fetched = await this.container.ticketFetcher.resolve(url);
        if (fetched && fetched.content.trim().length > 0) {
          resolvedReferences.push({ label: url, content: fetched.content });
          signalsUsed.push(`resolved:${url}`);
        }
      }

      const issueRefs = extractIssueRefs(`${title}\n${body}`);
      for (const num of issueRefs) {
        const issue = await this.fetchIssue(repoRow, num);
        if (issue) {
          resolvedReferences.push({
            label: `#${num}`,
            content: `${issue.title}\n\n${issue.body ?? ''}`,
          });
          signalsUsed.push(`linked_issue:#${num}`);
        }
      }
    }
    // Thin body / no linked issue / no matching specs (EC-3, EC-4): the
    // brief still generates below, from whichever signals ARE present.

    const diffShape = buildDiffShape(diff);
    const messages = buildBriefPrompt({
      title,
      body: thin ? null : body,
      resolvedReferences,
      diffShape,
      blastSummary,
    });
    const inputSet = buildInputSet({ diffShape, blastSummary, resolvedReferences });

    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');
    const llm = await this.container.llm(provider);
    // Exactly one structured LLM call per generation (AC-2).
    const res = await llm.completeStructured({
      model,
      schema: BriefModelOutput,
      schemaName: SCHEMA_NAME,
      messages,
      maxRetries: BRIEF_MAX_RETRIES,
    });

    // Grounding (AC-7) — mandatory, deterministic, before persist.
    const grounded = groundBrief(res.data, inputSet);

    const brief: PrBrief = {
      ...grounded,
      // OURS to set, from which signals were actually available — never
      // self-reported by the model (mirrors Intent's `confidence`/`signals_used`).
      signals_used: signalsUsed,
      head_sha: pull.headSha,
    };

    await this.repo.upsertBrief(pull.id, brief);
    return brief;
  }

  /** Best-effort read of an in-repo spec path referenced in the PR text.
   *  Never throws. Same traversal guard as `IntentClassifier.readClonedSpec`. */
  private async readClonedSpec(clonePath: string | null, path: string): Promise<string | null> {
    if (!clonePath) return null;
    const root = resolvePath(clonePath);
    const abs = resolvePath(root, path);
    if (abs !== root && !abs.startsWith(root + sep)) return null; // path escapes the clone
    const raw = await readFile(abs, 'utf8').catch(() => null);
    return raw ? raw.slice(0, MAX_SPEC_CHARS) : null;
  }

  /** Best-effort GitHub issue lookup for an in-repo `#N` reference. Never throws. */
  private async fetchIssue(
    repoRow: { owner: string; name: string },
    number: number,
  ): Promise<{ title: string; body: string | null } | null> {
    let gh: GitHubClient;
    try {
      gh = await this.container.github();
    } catch {
      return null;
    }
    try {
      const issue = await gh.getIssue({ owner: repoRow.owner, name: repoRow.name }, number);
      return { title: issue.title, body: issue.body ?? null };
    } catch {
      return null;
    }
  }
}
