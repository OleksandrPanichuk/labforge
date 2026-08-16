import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { LabQueue, LabTask } from "@labforge/queue";
import { parseArgs } from "./lab-run";
import { queueLab } from "./queue-lab";

const now = () => "1000";

function fakeQueue(accepts = true): LabQueue & { sent: LabTask[]; closed: boolean } {
  const sent: LabTask[] = [];
  const queue = {
    sent,
    closed: false,
    name: "labs",
    enqueue(task: LabTask) {
      sent.push(task);

      return Promise.resolve(accepts);
    },
    counts: () => Promise.resolve({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
    obliterate: () => Promise.resolve(),
    close() {
      queue.closed = true;

      return Promise.resolve();
    },
  };

  return queue;
}

function request(argv: string[], queue: LabQueue, reachable = true) {
  return {
    options: parseArgs(argv, now),
    open: () => queue,
    reachable: () => reachable,
  };
}

describe("queueLab", () => {
  test("refuses to queue when redis is not answering", async () => {
    const queue = fakeQueue();

    await expect(queueLab(request(["t.md", "--queue"], queue, false))).rejects.toThrow(/redis/i);
    expect(queue.sent).toHaveLength(0);
  });

  test("sends a path the worker can open from anywhere", async () => {
    const queue = fakeQueue();

    await queueLab(request(["data/lab.md", "--queue"], queue));

    expect(queue.sent[0]?.taskPath).toBe(join(process.cwd(), "data", "lab.md"));
  });

  test("carries what the lab was started with", async () => {
    const queue = fakeQueue();

    await queueLab(
      request(["t.md", "--queue", "--subject", "nm", "--language", "cpp", "--variant", "7"], queue),
    );

    expect(queue.sent[0]).toMatchObject({ subject: "nm", language: "cpp", variant: "7" });
  });

  test("leaves out the task file when answering an existing lab", async () => {
    const queue = fakeQueue();

    await queueLab(request(["--job", "job_1", "--answer", "Варіант 7", "--queue"], queue));

    expect(queue.sent[0]?.taskPath).toBeUndefined();
    expect(queue.sent[0]?.answer).toBe("Варіант 7");
  });

  test("says the lab went into the queue", async () => {
    const outcome = await queueLab(request(["t.md", "--queue"], fakeQueue()));

    expect(outcome).toEqual({ queued: true, answerDropped: false });
  });

  test("does not pretend an answer arrived at a lab already in the queue", async () => {
    const outcome = await queueLab(
      request(["--job", "job_1", "--answer", "Варіант 7", "--queue"], fakeQueue(false)),
    );

    expect(outcome).toEqual({ queued: false, answerDropped: true });
  });

  test("closes the queue even when it refuses the lab", async () => {
    const queue = fakeQueue(false);

    await queueLab(request(["t.md", "--queue"], queue));

    expect(queue.closed).toBe(true);
  });
});
