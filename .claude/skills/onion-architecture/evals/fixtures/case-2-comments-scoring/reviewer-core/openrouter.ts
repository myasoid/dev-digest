import type { LLMProvider } from './llm-port.js';

export class OpenRouterProvider implements LLMProvider {
  constructor(private apiKey: string, private model = 'anthropic/claude-sonnet-4.5') {}

  async completeStructured<T>(prompt: string, schemaName: string): Promise<T> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await res.json();
    return JSON.parse(data.choices[0].message.content) as T;
  }
}
