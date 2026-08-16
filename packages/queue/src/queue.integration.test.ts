import { afterEach, beforeEach, expect, test } from "bun:test";
import { redisReachable } from "./connection";
import type { LabQueue, LabTask, LabWorker } from "./index";
import { createLabQueue, createLabWorker } from "./index";

const URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const available = redisReachable(URL);

let name: string;
let queue: LabQueue | undefined;
let worker: LabWorker | undefined;
let counter = 0;

function task(jobId: string): LabTask {
  return { jobId, taskPath: "data/lab.md", subject: "numeric-methods" };
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }

    await Bun.sleep(20);
  }

  throw new Error("condition was never met");
}

function theQueue(): LabQueue {
  if (queue === undefined) {
    throw new Error("the queue was never opened");
  }

  return queue;
}

beforeEach(() => {
  if (!available) {
    return;
  }

  counter += 1;
  name = `labs-test-${process.pid}-${counter}`;
  queue = createLabQueue({ url: URL, name });
});

afterEach(async () => {
  await worker?.close();
  worker = undefined;

  if (queue !== undefined) {
    await queue.obliterate();
    await queue.close();
    queue = undefined;
  }
});

test.skipIf(!available)("runs a lab that was put in the queue", async () => {
  const seen: LabTask[] = [];

  worker = createLabWorker({
    url: URL,
    name,
    run: (job) => {
      seen.push(job);

      return Promise.resolve({ state: "DONE" as const });
    },
  });

  await theQueue().enqueue(task("job_1"));
  await until(() => seen.length === 1);

  expect(seen[0]?.jobId).toBe("job_1");
  expect(seen[0]?.subject).toBe("numeric-methods");
});

test.skipIf(!available)("runs one lab at a time", async () => {
  let running = 0;
  let atOnce = 0;
  let done = 0;

  worker = createLabWorker({
    url: URL,
    name,
    run: async () => {
      running += 1;
      atOnce = Math.max(atOnce, running);
      await Bun.sleep(80);
      running -= 1;
      done += 1;

      return { state: "DONE" as const };
    },
  });

  await theQueue().enqueue(task("job_1"));
  await theQueue().enqueue(task("job_2"));
  await theQueue().enqueue(task("job_3"));
  await until(() => done === 3);

  expect(atOnce).toBe(1);
});

test.skipIf(!available)("brings a rate-limited lab back without being asked", async () => {
  let attempts = 0;

  worker = createLabWorker({
    url: URL,
    name,
    minRateLimitDelayMs: 0,
    run: () => {
      attempts += 1;

      if (attempts === 1) {
        return Promise.resolve({
          state: "PAUSED_RATE_LIMIT" as const,
          resumeAt: new Date(Date.now() + 150).toISOString(),
        });
      }

      return Promise.resolve({ state: "DONE" as const });
    },
  });

  await theQueue().enqueue(task("job_1"));
  await until(() => attempts === 2);

  expect(attempts).toBe(2);
});

test.skipIf(!available)(
  "keeps a rate-limited lab in redis, not in the worker's memory",
  async () => {
    worker = createLabWorker({
      url: URL,
      name,
      minRateLimitDelayMs: 0,
      run: () =>
        Promise.resolve({
          state: "PAUSED_RATE_LIMIT" as const,
          resumeAt: new Date(Date.now() + 60_000).toISOString(),
        }),
    });

    await theQueue().enqueue(task("job_1"));
    await until(async () => (await theQueue().counts()).delayed === 1);

    expect((await theQueue().counts()).delayed).toBe(1);
  },
);

test.skipIf(!available)("leaves a lab that is waiting on the student alone", async () => {
  let attempts = 0;

  worker = createLabWorker({
    url: URL,
    name,
    run: () => {
      attempts += 1;

      return Promise.resolve({ state: "PAUSED_WAITING_USER" as const, question: "Which variant?" });
    },
  });

  await theQueue().enqueue(task("job_1"));
  await until(() => attempts === 1);
  await Bun.sleep(300);

  expect(attempts).toBe(1);
});

test.skipIf(!available)("does not queue the same lab twice", async () => {
  let attempts = 0;

  worker = createLabWorker({
    url: URL,
    name,
    run: async () => {
      attempts += 1;
      await Bun.sleep(50);

      return { state: "DONE" as const };
    },
  });

  await theQueue().enqueue(task("job_1"));
  await theQueue().enqueue(task("job_1"));
  await until(() => attempts === 1);
  await Bun.sleep(200);

  expect(attempts).toBe(1);
});

test.skipIf(!available)("keeps the work until a worker shows up", async () => {
  await theQueue().enqueue(task("job_1"));

  const seen: string[] = [];

  worker = createLabWorker({
    url: URL,
    name,
    run: (job) => {
      seen.push(job.jobId);

      return Promise.resolve({ state: "DONE" as const });
    },
  });

  await until(() => seen.length === 1);

  expect(seen).toEqual(["job_1"]);
});

test.skipIf(!available)("carries on after a lab blows up", async () => {
  const seen: string[] = [];

  worker = createLabWorker({
    url: URL,
    name,
    run: (job) => {
      seen.push(job.jobId);

      if (job.jobId === "job_1") {
        return Promise.reject(new Error("docker is not running"));
      }

      return Promise.resolve({ state: "DONE" as const });
    },
  });

  await theQueue().enqueue(task("job_1"));
  await theQueue().enqueue(task("job_2"));
  await until(() => seen.includes("job_2"));

  expect(seen).toContain("job_1");
});

test.skipIf(!available)("lets a lab that blew up be queued again", async () => {
  const seen: string[] = [];

  worker = createLabWorker({
    url: URL,
    name,
    run: (job) => {
      seen.push(job.jobId);

      return seen.length === 1
        ? Promise.reject(new Error("docker was not running"))
        : Promise.resolve({ state: "DONE" as const });
    },
  });

  await theQueue().enqueue(task("job_1"));
  await until(async () => (await theQueue().counts()).failed === 1);

  expect(await theQueue().enqueue(task("job_1"))).toBe(true);
  await until(() => seen.length === 2);

  expect(seen).toEqual(["job_1", "job_1"]);
});

test.skipIf(!available)(
  "says so rather than pretending when the lab is already queued",
  async () => {
    await theQueue().enqueue(task("job_1"));

    expect(await theQueue().enqueue(task("job_1"))).toBe(false);
  },
);

test.skipIf(!available)("gives the woken lab back the task it was queued with", async () => {
  const seen: LabTask[] = [];

  worker = createLabWorker({
    url: URL,
    name,
    minRateLimitDelayMs: 0,
    run: (job) => {
      seen.push(job);

      return seen.length === 1
        ? Promise.resolve({
            state: "PAUSED_RATE_LIMIT" as const,
            resumeAt: new Date(Date.now() + 100).toISOString(),
          })
        : Promise.resolve({ state: "DONE" as const });
    },
  });

  await theQueue().enqueue({
    jobId: "job_1",
    taskPath: "data/lab.md",
    subject: "nm",
    variant: "7",
  });
  await until(() => seen.length === 2);

  expect(seen[1]).toEqual(seen[0] as LabTask);
});

test.skipIf(!available)("delivers the student's answer once, not on every wake", async () => {
  const seen: (string | undefined)[] = [];

  worker = createLabWorker({
    url: URL,
    name,
    minRateLimitDelayMs: 0,
    run: (job) => {
      seen.push(job.answer);

      return seen.length === 1
        ? Promise.resolve({
            state: "PAUSED_RATE_LIMIT" as const,
            resumeAt: new Date(Date.now() + 100).toISOString(),
          })
        : Promise.resolve({ state: "DONE" as const });
    },
  });

  await theQueue().enqueue({ jobId: "job_1", answer: "Варіант 7" });
  await until(() => seen.length === 2);

  expect(seen[0]).toBe("Варіант 7");
  expect(seen[1]).toBeUndefined();
});

test.skipIf(!available)("gives up on a limit that never says when it resets", async () => {
  let attempts = 0;

  worker = createLabWorker({
    url: URL,
    name,
    minRateLimitDelayMs: 0,
    maxParks: 2,
    run: () => {
      attempts += 1;

      return Promise.resolve({ state: "PAUSED_RATE_LIMIT" as const });
    },
  });

  await theQueue().enqueue(task("job_1"));
  await until(async () => (await theQueue().counts()).failed === 1);

  expect(attempts).toBe(3);
});

test.skipIf(!available)("refuses a task that does not name a lab", async () => {
  await expect(theQueue().enqueue({ jobId: "" } as LabTask)).rejects.toThrow(/jobId/);
});
