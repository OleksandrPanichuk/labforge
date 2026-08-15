import { strFromU8, unzipSync } from "fflate";
import { IngestError } from "./errors";

const DOCUMENT_PART = "word/document.xml";
const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
const ROW_RE = /<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g;
const CELL_RE = /<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g;
const TOKEN_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(br|cr|tab)\b[^>]*\/?>/g;
const STYLE_RE = /<w:pStyle\s+w:val="([^"]+)"/;
const OUTLINE_RE = /<w:outlineLvl\s+w:val="(\d+)"/;
const HEADING_STYLE_RE = /^(?:heading|заголовок|überschrift)\s*(\d)$/i;
const TABLE_RE = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g;
const NESTED_TABLE_RE = /<w:tbl\b/g;
const NUMERIC_ENTITY_RE = /&#(x?)([0-9a-fA-F]+);/g;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

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
    entry = unzipSync(new Uint8Array(bytes), { filter: (file) => file.name === DOCUMENT_PART })[
      DOCUMENT_PART
    ];
  } catch {
    throw new IngestError("The file is not a readable .docx archive");
  }

  if (entry === undefined) {
    throw new IngestError(`The .docx has no ${DOCUMENT_PART} part`);
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

  const level = headingLevel(xml);

  if (level !== undefined) {
    return `${"#".repeat(level)} ${text}`;
  }

  return xml.includes("<w:numPr>") ? `- ${text}` : text;
}

function headingLevel(xml: string): number | undefined {
  const outline = OUTLINE_RE.exec(xml)?.[1];

  if (outline !== undefined) {
    return Math.min(Number(outline) + 1, 6);
  }

  const style = HEADING_STYLE_RE.exec(STYLE_RE.exec(xml)?.[1] ?? "")?.[1];

  return style === undefined ? undefined : Math.min(Number(style), 6);
}

function tableOf(xml: string): string {
  if ((xml.match(NESTED_TABLE_RE) ?? []).length > 1) {
    throw new IngestError(
      "The .docx contains a nested table, which cannot be converted without losing its structure",
    );
  }

  const rows = [...xml.matchAll(new RegExp(ROW_RE.source, "g"))].map((match) =>
    [...(match[1] ?? "").matchAll(new RegExp(CELL_RE.source, "g"))].map((cell) =>
      escapePipes(cellText(cell[1] ?? "")),
    ),
  );

  const header = rows[0];

  if (header === undefined) {
    return "";
  }

  const width = header.length;

  return [
    row(header, width),
    `| ${Array.from({ length: width }, () => "---").join(" | ")} |`,
    ...rows.slice(1).map((cells) => row(cells, width)),
  ].join("\n");
}

function row(cells: string[], width: number): string {
  const padded = [...cells.slice(0, width)];

  while (padded.length < width) {
    padded.push("");
  }

  return `| ${padded.join(" | ")} |`;
}

function cellText(xml: string): string {
  const paragraphs = [...xml.matchAll(new RegExp(PARAGRAPH_RE.source, "g"))].map((match) =>
    textOf(match[1] ?? ""),
  );

  if (paragraphs.length === 0) {
    return textOf(xml);
  }

  return paragraphs.filter((text) => text !== "").join(" ");
}

function textOf(xml: string): string {
  return [...xml.matchAll(new RegExp(TOKEN_RE.source, "g"))]
    .map((match) => (match[2] === undefined ? decode(match[1] ?? "") : whitespaceFor(match[2])))
    .join("")
    .trim();
}

function whitespaceFor(token: string): string {
  return token === "tab" ? "\t" : "\n";
}

function escapePipes(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function decode(text: string): string {
  return text
    .replace(/&(?:lt|gt|quot|apos|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(NUMERIC_ENTITY_RE, (_match, hex: string, code: string) =>
      String.fromCodePoint(Number.parseInt(code, hex === "" ? 10 : 16)),
    )
    .replace(/&amp;/g, "&");
}
