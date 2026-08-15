import { strFromU8, unzipSync } from "fflate";
import { IngestError } from "./errors";

const PARAGRAPH_RE = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
const ROW_RE = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
const TEXT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const STYLE_RE = /<w:pStyle\s+w:val="([^"]+)"/;
const HEADING_RE = /^heading\s*(\d)$/i;
const TABLE_RE = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;

export function docxToMarkdown(bytes: Buffer): string {
  const document = documentPart(bytes);
  const blocks: string[] = [];
  let cursor = 0;

  for (const match of document.matchAll(new RegExp(TABLE_RE.source, "g"))) {
    const index = match.index ?? 0;
    blocks.push(...paragraphsOf(document.slice(cursor, index)));
    blocks.push(tableOf(match[0]));
    cursor = index + match[0].length;
  }

  blocks.push(...paragraphsOf(document.slice(cursor)));

  return blocks.filter((block) => block !== "").join("\n\n");
}

function documentPart(bytes: Buffer): string {
  let entry: Uint8Array | undefined;

  try {
    entry = unzipSync(new Uint8Array(bytes))["word/document.xml"];
  } catch {
    throw new IngestError("The file is not a readable .docx archive");
  }

  if (entry === undefined) {
    throw new IngestError("The .docx has no word/document.xml part");
  }

  return strFromU8(entry);
}

function paragraphsOf(xml: string): string[] {
  return [...xml.matchAll(new RegExp(PARAGRAPH_RE.source, "g"))].map((match) =>
    paragraphToMarkdown(match[1] ?? ""),
  );
}

function paragraphToMarkdown(xml: string): string {
  const text = textOf(xml);

  if (text === "") {
    return "";
  }

  const heading = HEADING_RE.exec(STYLE_RE.exec(xml)?.[1] ?? "");

  if (heading?.[1] !== undefined) {
    return `${"#".repeat(Math.min(Number(heading[1]), 6))} ${text}`;
  }

  return xml.includes("<w:numPr>") ? `- ${text}` : text;
}

function tableOf(xml: string): string {
  const rows = [...xml.matchAll(new RegExp(ROW_RE.source, "g"))].map((match) =>
    [...(match[1] ?? "").matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((cell) =>
      textOf(cell[1] ?? ""),
    ),
  );

  if (rows.length === 0) {
    return "";
  }

  const [header, ...body] = rows;
  const width = header?.length ?? 0;

  return [
    `| ${(header ?? []).join(" | ")} |`,
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function textOf(xml: string): string {
  return [...xml.matchAll(new RegExp(TEXT_RE.source, "g"))]
    .map((match) => decode(match[1] ?? ""))
    .join("")
    .trim();
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}
