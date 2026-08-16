import { resolve } from "node:path";
import {
  createLabQueue,
  type LabQueue,
  type LabTask,
  redisReachable,
  redisUrl,
} from "@labforge/queue";
import type { ParsedArgs } from "./lab-run";

export interface QueueRequest {
  options: ParsedArgs;
  open?: () => LabQueue;
  reachable?: (url: string) => boolean;
}

export interface QueueOutcome {
  queued: boolean;
  answerDropped: boolean;
}

export async function queueLab(request: QueueRequest): Promise<QueueOutcome> {
  const url = redisUrl();
  const reachable = request.reachable ?? redisReachable;

  if (!reachable(url)) {
    throw new Error(`Redis is not answering at ${url}; start it with: docker compose up -d redis`);
  }

  const queue = (request.open ?? (() => createLabQueue()))();

  try {
    const queued = await queue.enqueue(taskFor(request.options));

    return { queued, answerDropped: !queued && request.options.answer !== undefined };
  } finally {
    await queue.close();
  }
}

function taskFor(options: ParsedArgs): LabTask {
  return {
    jobId: options.jobId,
    ...(options.taskPath !== "" && { taskPath: resolve(options.taskPath) }),
    ...(options.subject !== undefined && { subject: options.subject }),
    ...(options.teacher !== undefined && { teacher: options.teacher }),
    ...(options.variant !== undefined && { variant: options.variant }),
    ...(options.language !== undefined && { language: options.language }),
    ...(options.answer !== undefined && { answer: options.answer }),
  };
}
