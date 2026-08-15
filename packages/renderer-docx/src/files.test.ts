import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RenderError } from "./errors";
import { jobFilesAt, MAX_FILE_BYTES } from "./files";

let jobDir: string;
let outsideDir: string;

beforeAll(() => {
  jobDir = realpathSync(mkdtempSync(join(tmpdir(), "labforge-job-")));
  outsideDir = realpathSync(mkdtempSync(join(tmpdir(), "labforge-outside-")));

  mkdirSync(join(jobDir, "artifacts"));
  writeFileSync(join(jobDir, "artifacts", "plot.png"), "png bytes");
  writeFileSync(join(outsideDir, "secret.txt"), "private key");
  symlinkSync(join(outsideDir, "secret.txt"), join(jobDir, "artifacts", "link.png"));
  symlinkSync(outsideDir, join(jobDir, "escape"));
});

afterAll(() => {
  rmSync(jobDir, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });
});

describe("jobFilesAt", () => {
  test("reads a file inside the job directory", () => {
    expect(jobFilesAt(jobDir).read("artifacts/plot.png").toString()).toBe("png bytes");
  });

  test("refuses a path that walks out of the job directory", () => {
    expect(() => jobFilesAt(jobDir).read("../../etc/passwd")).toThrow(RenderError);
  });

  test("refuses an absolute path", () => {
    expect(() => jobFilesAt(jobDir).read("/etc/passwd")).toThrow(RenderError);
  });

  test("refuses a symlink pointing outside the job directory", () => {
    expect(() => jobFilesAt(jobDir).read("artifacts/link.png")).toThrow(RenderError);
  });

  test("refuses a path routed through a symlinked directory", () => {
    expect(() => jobFilesAt(jobDir).read("escape/secret.txt")).toThrow(RenderError);
  });

  test("refuses a file larger than the limit", () => {
    writeFileSync(join(jobDir, "artifacts", "huge.png"), Buffer.alloc(MAX_FILE_BYTES + 1));

    expect(() => jobFilesAt(jobDir).read("artifacts/huge.png")).toThrow(/too large/i);
  });

  test("reports a missing file as a render error", () => {
    expect(() => jobFilesAt(jobDir).read("artifacts/absent.png")).toThrow(RenderError);
  });
});
