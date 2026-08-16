import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunResult } from "@labforge/orchestrator";
import { createLabQueue, type LabQueue, redisReachable } from "@labforge/queue";
import type { LabRunOptions } from "./lab-run";
import { optionsFor, startLabWorker } from "./worker";

const URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const available = redisReachable(URL);

let root: string;
let queue: LabQueue | undefined;
let name: string;
let worker: { close(): Promise<void> } | undefined;
let counter = 0;

const dirs = () => ({
  jobsDir: join(root, "jobs"),
  configsDir: join(root, "configs"),
  agentsDir: join(root, "agents"),
});

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
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
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-worker-")));

  if (!available) {
    return;
  }

  counter += 1;
  name = `labs-cli-${process.pid}-${counter}`;
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

  rmSync(root, { recursive: true, force: true });
});

test("turns a queued task into a lab run", () => {
  const options = optionsFor(
    { jobId: "job_1", taskPath: "data/lab.md", subject: "nm", teacher: "ivanenko", variant: "7" },
    dirs(),
  );

  expect(options.jobId).toBe("job_1");
  expect(options.taskPath).toBe("data/lab.md");
  expect(options.subject).toBe("nm");
  expect(options.teacher).toBe("ivanenko");
  expect(options.variant).toBe("7");
  expect(options.jobsDir).toBe(join(root, "jobs"));
});

test("leaves the language to what the job already recorded", () => {
  expect(optionsFor({ jobId: "job_1" }, dirs()).language).toBeUndefined();
  expect(optionsFor({ jobId: "job_1", language: "cpp" }, dirs()).language).toBe("cpp");
});

test("passes an answer on to the lab that was waiting", () => {
  expect(optionsFor({ jobId: "job_1", answer: "Варіант 7" }, dirs()).answer).toBe("Варіант 7");
});

test("stops at the review the student owes it, like an inline run", () => {
  expect(optionsFor({ jobId: "job_1" }, dirs()).stopBefore).toBe("HUMAN_REVIEW");
});

test.skipIf(!available)("runs a queued lab through the whole wiring", async () => {
  const seen: LabRunOptions[] = [];

  worker = startLabWorker({
    ...dirs(),
    url: URL,
    name,
    run: (options) => {
      seen.push(options);

      return Promise.resolve({ state: "DONE" } as RunResult);
    },
  });

  await theQueue().enqueue({ jobId: "job_1", taskPath: "data/lab.md", subject: "nm" });
  await until(() => seen.length === 1);

  expect(seen[0]?.jobId).toBe("job_1");
  expect(seen[0]?.configsDir).toBe(join(root, "configs"));
});

test.skipIf(!available)("hands a rate-limited lab back to the queue", async () => {
  let attempts = 0;

  worker = startLabWorker({
    ...dirs(),
    url: URL,
    name,
    minRateLimitDelayMs: 0,
    run: () => {
      attempts += 1;

      if (attempts === 1) {
        return Promise.resolve({
          state: "PAUSED_RATE_LIMIT",
          resumeAt: new Date(Date.now() + 150).toISOString(),
        } as RunResult);
      }

      return Promise.resolve({ state: "DONE" } as RunResult);
    },
  });

  await theQueue().enqueue({ jobId: "job_1", taskPath: "data/lab.md" });
  await until(() => attempts === 2);

  expect(attempts).toBe(2);
});
