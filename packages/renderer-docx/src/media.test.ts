import { describe, expect, test } from "bun:test";
import type { Block } from "@labforge/ir";
import { strFromU8, unzipSync } from "fflate";
import { RenderError } from "./errors";
import type { JobFiles } from "./files";
import { renderReport } from "./render";
import { fakePng, makeIR } from "./testing";

function files(entries: Record<string, Buffer | string>): JobFiles {
  return {
    read(path: string) {
      const entry = entries[path];

      if (entry === undefined) {
        throw new RenderError(`${path} does not exist`);
      }

      return typeof entry === "string" ? Buffer.from(entry, "utf8") : entry;
    },
  };
}

async function documentXml(blocks: Block[], jobFiles: JobFiles) {
  const buffer = await renderReport(makeIR({ blocks }), { files: jobFiles });
  const entry = unzipSync(new Uint8Array(buffer))["word/document.xml"];

  return entry === undefined ? "" : strFromU8(entry);
}

const image: Block = {
  id: "blk_1",
  type: "image",
  src: "artifacts/plot.png",
  caption: "Рисунок 1 — Збіжність",
  width: "80%",
  provenance: { kind: "generated", codeRef: "cells/plot.py" },
};

describe("images", () => {
  const jobFiles = files({ "artifacts/plot.png": fakePng(1000, 500) });

  test("embeds the image as a drawing", async () => {
    const xml = await documentXml([image], jobFiles);

    expect(xml).toContain("<w:drawing>");
  });

  test("puts the caption below the image, as the standard requires", async () => {
    const xml = await documentXml([image], jobFiles);

    expect(xml.indexOf("Збіжність")).toBeGreaterThan(xml.indexOf("<w:drawing>"));
  });

  test("scales the image to 80% of the 180mm text width", async () => {
    const xml = await documentXml([image], jobFiles);
    const width = Number(/<wp:extent cx="(\d+)"/.exec(xml)?.[1] ?? 0);

    expect(width).toBe(5181600);
  });

  test("keeps the aspect ratio of the source file", async () => {
    const xml = await documentXml([image], jobFiles);
    const width = Number(/<wp:extent cx="(\d+)"/.exec(xml)?.[1] ?? 0);
    const height = Number(/<wp:extent cx="\d+" cy="(\d+)"/.exec(xml)?.[1] ?? 0);

    expect(width / height).toBeCloseTo(2, 2);
  });

  test("fills the 180mm text width at 100%", async () => {
    const xml = await documentXml([{ ...image, width: "100%" }], jobFiles);
    const width = Number(/<wp:extent cx="(\d+)"/.exec(xml)?.[1] ?? 0);

    expect(width).toBe(6477000);
  });

  test("fails loudly when the artifact is missing", () => {
    expect(renderReport(makeIR({ blocks: [image] }), { files: files({}) })).rejects.toThrow(
      RenderError,
    );
  });

  test("fails when no file access was configured", () => {
    expect(renderReport(makeIR({ blocks: [image] }))).rejects.toThrow(/jobDir/i);
  });
});

describe("code listings", () => {
  const source = "def solve(x):\n    return x * 2\n\n\nprint(solve(2))\n";
  const jobFiles = files({ "src/solver.py": source });

  const listing: Block = {
    id: "blk_1",
    type: "code-listing",
    language: "python",
    file: "src/solver.py",
    caption: "Лістинг 1 — Розвʼязувач",
  };

  test("renders the whole file when no range is given", async () => {
    const xml = await documentXml([listing], jobFiles);

    expect(xml).toContain("def solve(x):");
    expect(xml).toContain("print(solve(2))");
  });

  test("renders only the requested lines", async () => {
    const xml = await documentXml([{ ...listing, lines: [1, 2] }], jobFiles);

    expect(xml).toContain("def solve(x):");
    expect(xml).not.toContain("print(solve(2))");
  });

  test("keeps the indentation", async () => {
    const xml = await documentXml([{ ...listing, lines: [2, 2] }], jobFiles);

    expect(xml).toContain(">    return x * 2</w:t>");
  });

  test("uses a monospace font", async () => {
    const xml = await documentXml([listing], jobFiles);

    expect(xml).toContain("Courier New");
  });

  test("does not treat angle brackets in code as markup", async () => {
    const xml = await documentXml([listing], files({ "src/solver.py": "if a < b and c > d:" }));

    expect(xml).toContain("if a &lt; b and c &gt; d:");
  });

  test("fails loudly when the source file is missing", () => {
    expect(renderReport(makeIR({ blocks: [listing] }), { files: files({}) })).rejects.toThrow(
      RenderError,
    );
  });
});

describe("page breaks", () => {
  test("emits a page break", async () => {
    const xml = await documentXml([{ id: "blk_1", type: "pagebreak" }], files({}));

    expect(xml).toContain('w:type="page"');
  });
});
