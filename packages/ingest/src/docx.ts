import { strFromU8, unzipSync } from "fflate";
import { IngestError } from "./errors";

const DOCUMENT_PART = "word/document.xml";

export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;

const HEADING_STYLE_RE = /^(?:heading|заголовок|überschrift)\s*(\d)$/i;
const STYLE_RE = /<w:pStyle\s+w:val="([^"]+)"/;
const OUTLINE_RE = /<w:outlineLvl\s+w:val="(\d+)"/;
const NUMERIC_ENTITY_RE = /&#(x?)([0-9a-fA-F]+);/g;

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

interface Element {
  inner: string;
  start: number;
  end: number;
}

export function docxToMarkdown(bytes: Buffer): string {
  const document = documentPart(bytes);
  const blocks: string[] = [];
  let cursor = 0;

  for (const table of elements(document, "w:tbl")) {
    blocks.push(...paragraphsOf(document.slice(cursor, table.start)));
    blocks.push(tableOf(table.inner));
    cursor = table.end;
  }

  blocks.push(...paragraphsOf(document.slice(cursor)));

  return blocks.filter((block) => block !== "").join("\n\n");
}

function documentPart(bytes: Buffer): string {
  let entry: Uint8Array | undefined;

  try {
    entry = unzipSync(new Uint8Array(bytes), {
      filter: (file) => file.name === DOCUMENT_PART && file.originalSize <= MAX_DOCUMENT_BYTES,
    })[DOCUMENT_PART];
  } catch {
    throw new IngestError("The file is not a readable .docx archive");
  }

  if (entry === undefined) {
    throw new IngestError(
      `The .docx has no readable ${DOCUMENT_PART} within ${MAX_DOCUMENT_BYTES} bytes`,
    );
  }

  if (entry.length > MAX_DOCUMENT_BYTES) {
    throw new IngestError(`${DOCUMENT_PART} is larger than ${MAX_DOCUMENT_BYTES} bytes`);
  }

  return strFromU8(entry);
}

function elements(xml: string, name: string): Element[] {
  const closing = `</${name}>`;
  const found: Element[] = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const open = openingTag(xml, name, cursor);

    if (open === undefined) {
      break;
    }

    const closes = xml.indexOf(closing, open.contentStart);

    if (closes === -1) {
      break;
    }

    found.push({
      inner: xml.slice(open.contentStart, closes),
      start: open.start,
      end: closes + closing.length,
    });
    cursor = closes + closing.length;
  }

  return found;
}

function openingTag(
  xml: string,
  name: string,
  from: number,
): { start: number; contentStart: number } | undefined {
  let cursor = from;

  while (cursor < xml.length) {
    const start = xml.indexOf(`<${name}`, cursor);

    if (start === -1) {
      return undefined;
    }

    const closes = xml.indexOf(">", start);

    if (closes === -1) {
      return undefined;
    }

    const boundary = xml[start + name.length + 1] ?? "";

    if (boundary === ">" || boundary === " " || boundary === "\n" || boundary === "\t") {
      if (xml[closes - 1] === "/") {
        cursor = closes + 1;
        continue;
      }

      return { start, contentStart: closes + 1 };
    }

    cursor = start + name.length + 1;
  }

  return undefined;
}

function paragraphsOf(xml: string): string[] {
  return elements(xml, "w:p").map((paragraph) => paragraphToMarkdown(paragraph.inner));
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
  if (xml.includes("<w:tbl>") || xml.includes("<w:tbl ")) {
    throw new IngestError(
      "The .docx contains a nested table, which cannot be converted without losing its structure",
    );
  }

  const rows = elements(xml, "w:tr").map((row) =>
    elements(row.inner, "w:tc").map((cell) => escapePipes(cellText(cell.inner))),
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
  const paragraphs = elements(xml, "w:p").map((paragraph) => textOf(paragraph.inner));

  if (paragraphs.length === 0) {
    return textOf(xml);
  }

  return paragraphs.filter((text) => text !== "").join(" ");
}

function textOf(xml: string): string {
  let text = "";
  let cursor = 0;

  while (cursor < xml.length) {
    const opens = xml.indexOf("<", cursor);

    if (opens === -1) {
      break;
    }

    const closes = xml.indexOf(">", opens);

    if (closes === -1) {
      break;
    }

    const name = tagName(xml.slice(opens + 1, closes));

    if (name === "w:t") {
      const ends = xml.indexOf("</w:t>", closes);

      if (ends === -1) {
        break;
      }

      text += decode(xml.slice(closes + 1, ends));
      cursor = ends + "</w:t>".length;
      continue;
    }

    if (name === "w:br" || name === "w:cr") {
      text += "\n";
    }

    if (name === "w:tab") {
      text += "\t";
    }

    cursor = closes + 1;
  }

  return text.trim();
}

function tagName(tag: string): string {
  const end = tag.search(/[\s/>]/);

  return end === -1 ? tag : tag.slice(0, end);
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
