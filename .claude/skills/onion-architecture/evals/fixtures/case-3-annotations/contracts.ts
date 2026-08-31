import { z } from 'zod';

// Trimmed-down finding shape shown inline under each annotation in the
// activity feed.
export const AnnotationSummary = z.object({
  id: z.string(),
  findingTitle: z.string(),
  findingSeverity: z.enum(['low', 'medium', 'high']),
  findingFilePath: z.string(),
  findingLine: z.number(),
  note: z.string(),
  createdAt: z.string(),
});
export type AnnotationSummary = z.infer<typeof AnnotationSummary>;
