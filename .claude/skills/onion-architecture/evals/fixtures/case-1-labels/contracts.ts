import { z } from 'zod';

// Summary shape returned by GET /labels/:id/findings, grouped for the label
// detail panel in the UI.
export const LabelFindingSummary = z.object({
  id: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  filePath: z.string(),
  line: z.number(),
  labelName: z.string(),
});
export type LabelFindingSummary = z.infer<typeof LabelFindingSummary>;
