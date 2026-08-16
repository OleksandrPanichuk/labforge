import { Queue } from "bullmq";
import { connectionFor, redisUrl } from "./connection";
import { LAB_QUEUE, type LabTask, labTaskSchema } from "./task";

export interface LabQueueOptions {
  url?: string;
  name?: string;
}

export interface EnqueueOptions {
  delayMs?: number;
}

export interface LabCounts {
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
}

export interface LabQueue {
  name: string;
  enqueue(task: LabTask, options?: EnqueueOptions): Promise<boolean>;
  counts(): Promise<LabCounts>;
  obliterate(): Promise<void>;
  close(): Promise<void>;
}

const FINISHED = new Set(["completed", "failed"]);

async function admit(queue: Queue, task: LabTask): Promise<boolean> {
  const existing = await queue.getJob(task.jobId);

  if (existing === undefined) {
    return true;
  }

  if (!FINISHED.has(await existing.getState())) {
    return false;
  }

  await existing.remove();

  return true;
}

export function createLabQueue(options: LabQueueOptions = {}): LabQueue {
  const name = options.name ?? LAB_QUEUE;
  const queue = new Queue(name, { connection: connectionFor(options.url ?? redisUrl()) });

  return {
    name,
    enqueue(task, enqueueOptions = {}) {
      const parsed = labTaskSchema.parse(task);

      return admit(queue, parsed).then(async (admitted) => {
        if (!admitted) {
          return false;
        }

        await queue.add(parsed.jobId, parsed, {
          jobId: parsed.jobId,
          removeOnComplete: true,
          removeOnFail: 100,
          ...(enqueueOptions.delayMs !== undefined && { delay: enqueueOptions.delayMs }),
        });

        return true;
      });
    },
    async counts() {
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed");

      return {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      };
    },
    obliterate: () => queue.obliterate({ force: true }),
    close: () => queue.close(),
  };
}
