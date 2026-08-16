import { describe, expect, test } from "bun:test";
import { parseArgs } from "./lab-run";

const now = () => "1000";

describe("parseArgs", () => {
  test("takes the task file as the first argument", () => {
    expect(parseArgs(["data/lab1.md"], now).taskPath).toBe("data/lab1.md");
  });

  test("reads the subject and teacher", () => {
    const args = parseArgs(["t.md", "--subject", "numeric-methods", "--teacher", "Іваненко"], now);

    expect(args.subject).toBe("numeric-methods");
    expect(args.teacher).toBe("Іваненко");
  });

  test("carries the variant of this lab", () => {
    expect(parseArgs(["t.md", "--variant", "7"], now).variant).toBe("7");
  });

  test("leaves the variant unset when the lab has none", () => {
    expect(parseArgs(["t.md"], now).variant).toBeUndefined();
  });

  test("leaves the language to the job when the command line is silent", () => {
    expect(parseArgs(["t.md"], now).language).toBeUndefined();
    expect(parseArgs(["t.md", "--language", "C++"], now).language).toBe("C++");
  });

  test("names the job after the task so a directory is recognisable", () => {
    expect(parseArgs(["data/lab-3.md"], now).jobId).toBe("lab-lab-3-1000");
  });

  test("keeps a job id the store will accept even for a ukrainian filename", () => {
    const id = parseArgs(["data/Лабораторна 3.md"], now).jobId;

    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  test("still produces a usable id when the name has nothing to keep", () => {
    expect(parseArgs(["data/!!!.md"], now).jobId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  test("refuses a stop state that is not a state", () => {
    expect(() => parseArgs(["t.md", "--stop-before", "human-review"], now)).toThrow(/stop-before/);
  });

  test("stops before the human review by default", () => {
    expect(parseArgs(["t.md"], now).stopBefore).toBe("HUMAN_REVIEW");
  });

  test("lets the caller run further or stop earlier", () => {
    expect(parseArgs(["t.md", "--stop-before", "SOLVE"], now).stopBefore).toBe("SOLVE");
  });

  test("answers a waiting job without naming the task file again", () => {
    const args = parseArgs(["--job", "lab-3-1000", "--answer", "Варіант 7"], now);

    expect(args.jobId).toBe("lab-3-1000");
    expect(args.answer).toBe("Варіант 7");
    expect(args.taskPath).toBe("");
  });

  test("refuses an answer that does not say which job it belongs to", () => {
    expect(() => parseArgs(["--answer", "Варіант 7"], now)).toThrow(/--job/);
  });

  test("can send the lab to the queue instead of running it here", () => {
    expect(parseArgs(["t.md", "--queue"], now).queue).toBe(true);
    expect(parseArgs(["t.md"], now).queue).toBe(false);
  });

  test("does not swallow the flag that follows --queue", () => {
    expect(parseArgs(["t.md", "--queue", "--subject", "nm"], now).subject).toBe("nm");
  });

  test("refuses flags the queue would quietly ignore", () => {
    expect(() => parseArgs(["t.md", "--queue", "--stop-before", "SOLVE"], now)).toThrow(/--queue/);
    expect(() => parseArgs(["t.md", "--queue", "--jobs-dir", "other"], now)).toThrow(/--queue/);
  });

  test("explains itself when given no task", () => {
    expect(() => parseArgs([], now)).toThrow(/Usage/);
  });

  test("refuses an empty flag value rather than recording it", () => {
    expect(() => parseArgs(["t.md", "--subject", ""], now)).toThrow(/--subject/);
  });

  test("refuses a flag with no value rather than swallowing the next one", () => {
    expect(() => parseArgs(["t.md", "--subject", "--teacher", "x"], now)).toThrow(/--subject/);
  });
});
