import type { Container } from './container.js';
import { OpenRouterProvider } from './llm/openrouter.js';

/**
 * Annotations service. Lets a reviewer attach a free-text note to a finding,
 * and offers a "suggest a note" helper that drafts one from the finding text.
 */
export class AnnotationService {
  constructor(private container: Container) {}

  async suggestNote(findingTitle: string, findingRationale: string): Promise<string> {
    const apiKey = await this.container.secrets.get('OPENROUTER_API_KEY');
    const llm = new OpenRouterProvider(apiKey ?? '');
    const prompt = `Draft a one-sentence reviewer note for this finding:\nTitle: ${findingTitle}\nRationale: ${findingRationale}`;
    const result = await llm.completeStructured<{ note: string }>(prompt, 'NoteSuggestion');
    return result.note;
  }

  async add(workspaceId: string, findingId: string, note: string): Promise<void> {
    await this.container.db.insert('annotations').values({ workspaceId, findingId, note });
  }
}
