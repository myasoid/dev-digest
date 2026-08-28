export interface LLMProvider {
  completeStructured<T>(prompt: string, schemaName: string): Promise<T>;
}
