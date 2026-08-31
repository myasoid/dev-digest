// Stand-in for the @devdigest/shared contracts package used by this module.
import { z } from 'zod';

export const Finding = z.object({
  id: z.string(),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  filePath: z.string(),
  line: z.number(),
});
export type Finding = z.infer<typeof Finding>;

export const LabelInput = z.object({
  name: z.string(),
  color: z.string(),
});
export type LabelInput = z.infer<typeof LabelInput>;

export interface Label {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
}
