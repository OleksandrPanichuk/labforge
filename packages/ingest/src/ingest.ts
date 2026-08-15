import { extractText, getDocumentProxy } from "unpdf";
import { docxToMarkdown } from "./docx";
import { IngestError } from "./errors";

export { IngestError };

export type SourceFormat = "pdf" | "docx" | "markdown";

const PDF_SIGNATURE = "%PDF";
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export interface IngestRequest {
  name: string;
  bytes: Buffer;
  now?: string;
}

export interface IngestMeta {
  source: string;
  format: SourceFormat;
  ingestedAt: string;
}

export interface IngestResult {
  markdown: string;
  meta: IngestMeta;
}

export function detectFormat(name: string, bytes: Buffer): SourceFormat {
  if (bytes.subarray(0, PDF_SIGNATURE.length).toString("latin1") === PDF_SIGNATURE) {
    return "pdf";
  }

  if (bytes.subarray(0, ZIP_SIGNATURE.length).equals(ZIP_SIGNATURE)) {
    return "docx";
  }

  if (hasBinaryBytes(bytes) || bytes.toString("utf8").includes("\ufffd")) {
    throw new IngestError(`"${name}" is neither a PDF, a .docx, nor readable text`);
  }

  return "markdown";
}

function hasBinaryBytes(bytes: Buffer): boolean {
  return bytes.some(
    (byte) => (byte < 0x09 && byte !== 0x00) || byte === 0x00 || (byte > 0x0d && byte < 0x20),
  );
}

export async function ingestDocument(request: IngestRequest): Promise<IngestResult> {
  const format = detectFormat(request.name, request.bytes);
  const meta: IngestMeta = {
    source: request.name,
    format,
    ingestedAt: request.now ?? new Date().toISOString(),
  };

  const body = tidy(await extract(format, request.bytes));

  if (body === "") {
    throw new IngestError(`"${request.name}" produced no text to ingest`);
  }

  return { markdown: `${frontmatter(meta)}\n\n${body}\n`, meta };
}

async function extract(format: SourceFormat, bytes: Buffer): Promise<string> {
  if (format === "pdf") {
    return await pdfToText(bytes);
  }

  if (format === "docx") {
    return docxToMarkdown(bytes);
  }

  return bytes.toString("utf8");
}

async function pdfToText(bytes: Buffer): Promise<string> {
  try {
    const document = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(document, { mergePages: true });

    return Array.isArray(text) ? text.join("\n\n") : text;
  } catch (error) {
    throw new IngestError(
      `The PDF could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function frontmatter(meta: IngestMeta): string {
  return [
    "---",
    `source: ${meta.source}`,
    `format: ${meta.format}`,
    `ingestedAt: ${meta.ingestedAt}`,
    "---",
  ].join("\n");
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
