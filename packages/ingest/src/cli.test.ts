import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { markdownNameFor, parseArgs, runCli } from "./cli";
import { IngestError } from "./errors";
import { makePdf } from "./testing";

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "labforge-ingest-")));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseArgs", () => {
  test("collects the files to ingest", () => {
    expect(parseArgs(["a.pdf", "b.docx"]).inputs).toEqual(["a.pdf", "b.docx"]);
  });

  test("defaults to the parsed data directory", () => {
    expect(parseArgs(["a.pdf"]).outDir).toBe("data/parsed");
  });

  test("takes an explicit output directory", () => {
    expect(parseArgs(["a.pdf", "--out", "data/labs"]).outDir).toBe("data/labs");
  });

  test("explains itself when given nothing", () => {
    expect(() => parseArgs([])).toThrow(IngestError);
  });
});

describe("markdownNameFor", () => {
  test("keeps a readable name", () => {
    expect(markdownNameFor("/x/Методичка-3.pdf")).toBe("методичка-3.md");
  });

  test("replaces characters that would be awkward in a path", () => {
    expect(markdownNameFor("lab report (final).docx")).toBe("lab-report-final-.md");
  });
});

describe("runCli", () => {
  test("writes a markdown file per input", async () => {
    const source = join(root, "methodology.pdf");
    writeFileSync(source, makePdf(["Metod"]));

    const code = await runCli([source, "--out", join(root, "out")]);

    expect(code).toBe(0);
    expect(existsSync(join(root, "out", "methodology.md"))).toBe(true);
    expect(readFileSync(join(root, "out", "methodology.md"), "utf8")).toContain("Metod");
  });

  test("keeps going after one file fails and reports failure", async () => {
    const good = join(root, "good.txt");
    const bad = join(root, "bad.bin");
    writeFileSync(good, "readable text");
    writeFileSync(bad, Buffer.from([0x00, 0x01, 0x02]));

    const code = await runCli([good, bad, "--out", join(root, "out")]);

    expect(code).toBe(1);
    expect(existsSync(join(root, "out", "good.md"))).toBe(true);
    expect(existsSync(join(root, "out", "bad.md"))).toBe(false);
  });

  test("reports failure when a file does not exist", async () => {
    expect(await runCli([join(root, "absent.pdf"), "--out", join(root, "out")])).toBe(1);
  });
});
