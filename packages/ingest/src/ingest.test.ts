import { describe, expect, test } from "bun:test";
import { detectFormat, IngestError, ingestDocument } from "./ingest";
import { listItem, makeDocx, makePdf, paragraph, table } from "./testing";

const AT = "2026-08-15T10:00:00.000Z";

describe("detectFormat", () => {
  test("recognises a pdf by its signature, not its name", () => {
    expect(detectFormat("methodology.txt", makePdf(["text"]))).toBe("pdf");
  });

  test("recognises a docx by its content", () => {
    expect(detectFormat("lab.bin", makeDocx(paragraph("text")))).toBe("docx");
  });

  test("treats readable text as markdown", () => {
    expect(detectFormat("notes.md", Buffer.from("# Заголовок", "utf8"))).toBe("markdown");
  });

  test("refuses a binary it cannot read", () => {
    expect(() => detectFormat("mystery.bin", Buffer.from([0x00, 0x01, 0x02, 0x03]))).toThrow(
      IngestError,
    );
  });
});

describe("ingestDocument", () => {
  test("keeps markdown as it is", async () => {
    const result = await ingestDocument({
      name: "notes.md",
      bytes: Buffer.from("# Мета\n\nТекст", "utf8"),
      now: AT,
    });

    expect(result.markdown).toContain("# Мета");
    expect(result.markdown).toContain("Текст");
  });

  test("records where the document came from", async () => {
    const result = await ingestDocument({
      name: "methodology.pdf",
      bytes: makePdf(["Metod"]),
      now: AT,
    });

    expect(result.markdown.startsWith("---\n")).toBe(true);
    expect(result.markdown).toContain('source: "methodology.pdf"');
    expect(result.markdown).toContain("format: pdf");
    expect(result.markdown).toContain(`ingestedAt: "${AT}"`);
    expect(result.meta.format).toBe("pdf");
  });

  test("extracts the text of a pdf", async () => {
    const result = await ingestDocument({
      name: "m.pdf",
      bytes: makePdf(["Metod Runge-Kutta", "krok h = 0,1"]),
      now: AT,
    });

    expect(result.markdown).toContain("Metod Runge-Kutta");
    expect(result.markdown).toContain("krok h = 0,1");
  });

  test("extracts headings and paragraphs from a docx", async () => {
    const result = await ingestDocument({
      name: "lab.docx",
      bytes: makeDocx(paragraph("МЕТА РОБОТИ", "Heading1") + paragraph("Дослідити метод.")),
      now: AT,
    });

    expect(result.markdown).toContain("# МЕТА РОБОТИ");
    expect(result.markdown).toContain("Дослідити метод.");
  });

  test("keeps docx list items as a markdown list", async () => {
    const result = await ingestDocument({
      name: "lab.docx",
      bytes: makeDocx(listItem("Крок перший") + listItem("Крок другий")),
      now: AT,
    });

    expect(result.markdown).toContain("- Крок перший");
    expect(result.markdown).toContain("- Крок другий");
  });

  test("keeps a docx table readable as a markdown table", async () => {
    const result = await ingestDocument({
      name: "lab.docx",
      bytes: makeDocx(
        table([
          ["x", "y"],
          ["0,1", "1,105"],
        ]),
      ),
      now: AT,
    });

    expect(result.markdown).toContain("| x | y |");
    expect(result.markdown).toContain("| 0,1 | 1,105 |");
  });

  test("normalises windows line endings", async () => {
    const result = await ingestDocument({
      name: "notes.txt",
      bytes: Buffer.from("first\r\nsecond\r\n", "utf8"),
      now: AT,
    });

    expect(result.markdown).not.toContain("\r");
  });

  test("collapses the runs of blank lines a converter leaves behind", async () => {
    const result = await ingestDocument({
      name: "notes.txt",
      bytes: Buffer.from("first\n\n\n\n\nsecond", "utf8"),
      now: AT,
    });

    expect(result.markdown).not.toContain("\n\n\n");
  });

  test("refuses an empty document rather than writing an empty note", () => {
    expect(
      ingestDocument({ name: "empty.txt", bytes: Buffer.from("   \n\n", "utf8"), now: AT }),
    ).rejects.toBeInstanceOf(IngestError);
  });

  test("names the file when a docx has no document part", () => {
    const broken = makeDocx(paragraph("x")).subarray(0, 40);

    expect(ingestDocument({ name: "broken.docx", bytes: broken, now: AT })).rejects.toBeInstanceOf(
      IngestError,
    );
  });
});
