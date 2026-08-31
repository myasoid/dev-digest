import { OpenRouterProvider } from './openrouter.js';

export interface FindingCandidate {
  title: string;
  filePath: string;
  rationale: string;
}

export interface ScoredFinding extends FindingCandidate {
  confidence: number;
}

/**
 * Re-scores a batch of finding candidates by asking the model to rate its own
 * confidence in each one (0-1), so low-confidence findings can be filtered
 * out of the review before it's posted.
 */
export async function scoreFindings(
  candidates: FindingCandidate[],
  apiKey: string,
): Promise<ScoredFinding[]> {
  const llm = new OpenRouterProvider(apiKey);
  const scored: ScoredFinding[] = [];

  for (const candidate of candidates) {
    const prompt = `Rate your confidence (0-1) that this finding is correct and worth surfacing:\n${JSON.stringify(candidate)}`;
    const result = await llm.completeStructured<{ confidence: number }>(prompt, 'ConfidenceScore');
    scored.push({ ...candidate, confidence: result.confidence });
  }

  return scored.sort((a, b) => b.confidence - a.confidence);
}
