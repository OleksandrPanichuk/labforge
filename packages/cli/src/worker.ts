import type { RunResult } from "@labforge/orchestrator";
import { createLabWorker, type LabTask, type LabWorker } from "@labforge/queue";
import { type LabRunOptions, labRun } from "./lab-run";

export interface WorkerDirectories {
  jobsDir: string;
  configsDir: string;
  agentsDir: string;
}

export interface LabWorkerOptions extends WorkerDirectories {
  url?: string;
  name?: string;
  minRateLimitDelayMs?: number;
  run?(options: LabRunOptions): Promise<RunResult>;
}

export const QUEUE_STOPS_BEFORE = "HUMAN_REVIEW" as const;

export function optionsFor(task: LabTask, directories: WorkerDirectories): LabRunOptions {
  return {
    jobId: task.jobId,
    taskPath: task.taskPath ?? "",
    stopBefore: QUEUE_STOPS_BEFORE,
    ...(task.subject !== undefined && { subject: task.subject }),
    ...(task.teacher !== undefined && { teacher: task.teacher }),
    ...(task.variant !== undefined && { variant: task.variant }),
    ...(task.language !== undefined && { language: task.language }),
    ...(task.answer !== undefined && { answer: task.answer }),
    ...directories,
  };
}

export function startLabWorker(options: LabWorkerOptions): LabWorker {
  const run = options.run ?? labRun;

  return createLabWorker({
    ...(options.url !== undefined && { url: options.url }),
    ...(options.name !== undefined && { name: options.name }),
    ...(options.minRateLimitDelayMs !== undefined && {
      minRateLimitDelayMs: options.minRateLimitDelayMs,
    }),
    run: async (task) => {
      const result = await run(
        optionsFor(task, {
          jobsDir: options.jobsDir,
          configsDir: options.configsDir,
          agentsDir: options.agentsDir,
        }),
      );

      return {
        state: result.state,
        ...(result.question !== undefined && { question: result.question }),
        ...(result.resumeAt !== undefined && { resumeAt: result.resumeAt }),
        ...(result.reason !== undefined && { reason: result.reason }),
      };
    },
  });
}
