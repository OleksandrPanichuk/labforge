import { createLogger, type Logger, withContext } from "@labforge/logger";
import { DelayedError, Worker } from "bullmq";
import { connectionFor, redisUrl } from "./connection";
import { delayUntil } from "./delay";
import { LAB_QUEUE, type LabOutcome, type LabTask, labTaskSchema } from "./task";

export const MIN_RATE_LIMIT_DELAY_MS = 60_000;

export const LOCK_DURATION_MS = 5 * 60 * 1000;

export interface LabWorkerOptions {
  url?: string;
  name?: string;
  concurrency?: number;
  minRateLimitDelayMs?: number;
  logger?: Logger;
  run(task: LabTask): Promise<LabOutcome>;
}

export interface LabWorker {
  close(): Promise<void>;
}

interface Processed {
  jobId: string;
  state: string;
}

export function createLabWorker(options: LabWorkerOptions): LabWorker {
  const name = options.name ?? LAB_QUEUE;
  const logger = withContext(options.logger ?? createLogger({ service: "queue" }), { queue: name });
  const floor = options.minRateLimitDelayMs ?? MIN_RATE_LIMIT_DELAY_MS;

  const worker = new Worker<LabTask, Processed>(
    name,
    async (job, token) => {
      const task = labTaskSchema.parse(job.data);

      logger.info({ jobId: task.jobId }, "lab picked up");

      const outcome = await options.run(task);

      if (outcome.state === "PAUSED_RATE_LIMIT") {
        const delayMs = Math.max(delayUntil(outcome.resumeAt), floor);

        logger.info({ jobId: task.jobId, delayMs }, "lab parked until the limit resets");
        await job.moveToDelayed(Date.now() + delayMs, token);

        throw new DelayedError();
      }

      logger.info({ jobId: task.jobId, state: outcome.state }, "lab put down");

      return { jobId: task.jobId, state: outcome.state };
    },
    {
      connection: connectionFor(options.url ?? redisUrl()),
      concurrency: options.concurrency ?? 1,
      lockDuration: LOCK_DURATION_MS,
    },
  );

  worker.on("failed", (job, error) => {
    if (error instanceof DelayedError) {
      return;
    }

    logger.error({ jobId: job?.data?.jobId, error: error.message }, "the lab threw");
  });

  return { close: () => worker.close() };
}
