import { ReviewResult } from '../schemas.js';

/** The subset of `FindingRecord` (`@devdigest/shared`) tools need. */
export interface ReviewApiFinding {
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
}

/** The subset of `ReviewRecord` (`@devdigest/shared`) tools need. */
export interface ReviewApiRecord {
  run_id: string | null;
  kind: 'summary' | 'review';
  verdict: string | null;
  summary: string | null;
  score: number | null;
  created_at: string;
  findings: ReviewApiFinding[];
}

/** Shared by `run_agent_on_pr` and `get_findings` — both return the same
 * `ReviewResult` shape from a persisted `ReviewRecord`. */
export function toReviewResult(review: ReviewApiRecord): ReviewResult {
  return ReviewResult.parse({
    verdict: review.verdict,
    score: review.score,
    summary: review.summary,
    findings: review.findings.map((f) => ({
      severity: f.severity,
      category: f.category,
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      rationale: f.rationale,
    })),
  });
}
