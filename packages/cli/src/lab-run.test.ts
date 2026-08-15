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

  test("defaults the language and lets it be overridden", () => {
    expect(parseArgs(["t.md"], now).language).toBe("python");
    expect(parseArgs(["t.md", "--language", "C++"], now).language).toBe("C++");
  });

  test("names the job after the task so a directory is recognisable", () => {
    expect(parseArgs(["data/Лабораторна 3.md"], now).jobId).toBe("лабораторна-3-1000");
  });

  test("stops before the human review by default", () => {
    expect(parseArgs(["t.md"], now).stopBefore).toBe("HUMAN_REVIEW");
  });

  test("lets the caller run further or stop earlier", () => {
    expect(parseArgs(["t.md", "--stop-before", "SOLVE"], now).stopBefore).toBe("SOLVE");
  });

  test("explains itself when given no task", () => {
    expect(() => parseArgs([], now)).toThrow(/Usage/);
  });

  test("refuses a flag with no value rather than swallowing the next one", () => {
    expect(() => parseArgs(["t.md", "--subject", "--teacher", "x"], now)).toThrow(/--subject/);
  });
});
