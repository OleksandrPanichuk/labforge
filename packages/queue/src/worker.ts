import { createLogger, type Logger, withContext } from "@labforge/logger";
import { DelayedError, type Job, Worker } from "bullmq";
import { connectionFor, redisUrl } from "./connection";
import { parkFor } from "./delay";
import { LAB_QUEUE, type LabOutcome, type LabTask, labTaskSchema } from "./task";

export const MIN_RATE_LIMIT_DELAY_MS = 60_000;

export const LOCK_DURATION_MS = 30 * 60 * 1000;

export const MAX_PARKS = 12;

export interface LabWorkerOptions {
  url?: string;
  name?: string;
  concurrency?: number;
  minRateLimitDelayMs?: number;
  maxParks?: number;
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

interface Parked extends LabTask {
  parks?: number;
}

export function createLabWorker(options: LabWorkerOptions): LabWorker {
  const name = options.name ?? LAB_QUEUE;
  const logger = withContext(options.logger ?? createLogger({ service: "queue" }), { queue: name });
  const floor = options.minRateLimitDelayMs ?? MIN_RATE_LIMIT_DELAY_MS;
  const maxParks = options.maxParks ?? MAX_PARKS;

  const worker = new Worker<Parked, Processed>(
    name,
    async (job, token) => {
      const task = labTaskSchema.parse(job.data);
      const parks = job.data.parks ?? 0;

      logger.info({ jobId: task.jobId }, "lab picked up");
      await forget(job, task);

      const outcome = await options.run(task);

      if (outcome.state !== "PAUSED_RATE_LIMIT") {
        logger.info({ jobId: task.jobId, state: outcome.state }, "lab put down");

        return { jobId: task.jobId, state: outcome.state };
      }

      if (parks >= maxParks) {
        throw new Error(
          `Job "${task.jobId}" has been parked ${parks} times and the limit still has not reset`,
        );
      }

      const delayMs = parkFor(outcome.resumeAt, floor);

      logger.info({ jobId: task.jobId, delayMs, parks: parks + 1 }, "lab parked until the reset");
      await job.updateData({ ...task, answer: undefined, parks: parks + 1 });
      await job.moveToDelayed(Date.now() + delayMs, token);

      throw new DelayedError();
    },
    {
      connection: connectionFor(options.url ?? redisUrl()),
      concurrency: options.concurrency ?? 1,
      lockDuration: LOCK_DURATION_MS,
    },
  );

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.data?.jobId, error: error.message }, "the lab threw");
  });

  worker.on("stalled", (jobId) => {
    logger.warn({ jobId }, "the lab lost its lock and will be handed out again");
  });

  worker.on("error", (error) => {
    logger.error({ error: error.message }, "the queue itself is unhappy");
  });

  return { close: () => worker.close() };
}

async function forget(job: Job<Parked, Processed>, task: LabTask): Promise<void> {
  if (task.answer === undefined) {
    return;
  }

  await job.updateData({ ...job.data, answer: undefined });
}
