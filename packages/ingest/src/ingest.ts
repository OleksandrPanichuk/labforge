import { extractText } from "unpdf";
import { z } from "zod";
import { docxToMarkdown } from "./docx";
import { IngestError } from "./errors";

export { IngestError };

export type SourceFormat = "pdf" | "docx" | "markdown";

export const MAX_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_NAME_LENGTH = 255;

const PDF_SIGNATURE = "%PDF";
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const SNIFF_BYTES = 64 * 1024;

const nameSchema = z
  .string()
  .min(1)
  .max(MAX_NAME_LENGTH)
  .refine((value) => ![...value].some((character) => isControl(character)), {
    message: "a document name cannot contain control characters",
  });

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

  if (hasBinaryBytes(bytes.subarray(0, SNIFF_BYTES)) || !decodesAsUtf8(bytes)) {
    throw new IngestError(`"${name}" is neither a PDF, a .docx, nor readable text`);
  }

  return "markdown";
}

export async function ingestDocument(request: IngestRequest): Promise<IngestResult> {
  const name = safeName(request.name);

  if (request.bytes.length > MAX_INPUT_BYTES) {
    throw new IngestError(
      `"${name}" is ${request.bytes.length} bytes, over the ${MAX_INPUT_BYTES} byte ingest limit`,
    );
  }

  const format = detectFormat(name, request.bytes);
  const meta: IngestMeta = {
    source: name,
    format,
    ingestedAt: request.now ?? new Date().toISOString(),
  };

  const body = tidy(await extract(format, request.bytes));

  if (body === "") {
    throw new IngestError(`"${name}" produced no text to ingest`);
  }

  return { markdown: `${frontmatter(meta)}\n\n${body}\n`, meta };
}

function safeName(name: string): string {
  const parsed = nameSchema.safeParse(name);

  if (!parsed.success) {
    throw new IngestError(`The document name is not usable: ${parsed.error.issues[0]?.message}`);
  }

  return parsed.data;
}

function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;

  return code < 0x20 || code === 0x7f;
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
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: true });

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
    `source: ${JSON.stringify(meta.source)}`,
    `format: ${meta.format}`,
    `ingestedAt: ${JSON.stringify(meta.ingestedAt)}`,
    "---",
  ].join("\n");
}

function hasBinaryBytes(bytes: Buffer): boolean {
  return bytes.some((byte) => byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f);
}

function decodesAsUtf8(bytes: Buffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, SNIFF_BYTES));

    return true;
  } catch {
    return false;
  }
}

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
