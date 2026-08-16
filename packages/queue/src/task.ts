import type { JobState } from "@labforge/jobs";
import { z } from "zod";

export const LAB_QUEUE = "labs";

export const labTaskSchema = z.object({
  jobId: z.string().min(1),
  taskPath: z.string().optional(),
  subject: z.string().optional(),
  teacher: z.string().optional(),
  variant: z.string().optional(),
  language: z.string().optional(),
  answer: z.string().optional(),
});

export type LabTask = z.infer<typeof labTaskSchema>;

export interface LabOutcome {
  state: JobState;
  question?: string;
  resumeAt?: string;
  reason?: string;
}
