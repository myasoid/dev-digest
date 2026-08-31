import { z } from 'zod';

export const Finding = z.object({
  id: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  filePath: z.string(),
  line: z.number(),
});
export type Finding = z.infer<typeof Finding>;

export const AnnotationInput = z.object({
  findingId: z.string(),
  note: z.string(),
});
export type AnnotationInput = z.infer<typeof AnnotationInput>;
