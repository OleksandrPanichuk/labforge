import type { Block, ReportIR, StyleDef, ValueEntry } from "@labforge/ir";
import {
  AlignmentType,
  Document,
  Footer,
  type ISectionOptions,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import { type InlineRun, parseInline } from "./inline";
import { mmToTwips, paragraphOptionsOf, runOptionsOf, styleIdOf } from "./styles";

export type DocumentPart = "document" | "styles" | "footer1";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const DEFAULT_STYLE = "default";

export async function renderReport(ir: ReportIR): Promise<Buffer> {
  return await Packer.toBuffer(buildDocument(ir));
}

export function buildDocument(ir: ReportIR): Document {
  return new Document({
    creator: ir.meta.student.name,
    title: ir.meta.title,
    styles: {
      default: { document: styleOf(ir, DEFAULT_STYLE) },
      paragraphStyles: namedStyles(ir),
    },
    sections: [section(ir)],
  });
}

function section(ir: ReportIR): ISectionOptions {
  const margins = ir.page.marginsMm;

  return {
    properties: {
      page: {
        size: {
          width: mmToTwips(A4_WIDTH_MM),
          height: mmToTwips(A4_HEIGHT_MM),
        },
        margin: {
          top: mmToTwips(margins.top),
          right: mmToTwips(margins.right),
          bottom: mmToTwips(margins.bottom),
          left: mmToTwips(margins.left),
        },
      },
    },
    footers: ir.page.pageNumbers ? { default: pageNumberFooter() } : undefined,
    children: ir.blocks.flatMap((block) => renderBlock(block, ir.values)),
  };
}

function pageNumberFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT] })],
      }),
    ],
  });
}

function styleOf(
  ir: ReportIR,
  name: string,
): { run: ReturnType<typeof runOptionsOf>; paragraph: ReturnType<typeof paragraphOptionsOf> } {
  const definition: StyleDef = ir.styles[name] ?? {};

  return { run: runOptionsOf(definition), paragraph: paragraphOptionsOf(definition) };
}

function namedStyles(ir: ReportIR) {
  return Object.entries(ir.styles)
    .filter(([name]) => name !== DEFAULT_STYLE)
    .map(([name, definition]) => ({
      id: styleIdOf(name),
      name,
      basedOn: "Normal",
      quickFormat: true,
      run: runOptionsOf(definition),
      paragraph: paragraphOptionsOf(definition),
    }));
}

function renderBlock(block: Block, values: Record<string, ValueEntry>): Paragraph[] {
  if (block.type === "paragraph") {
    return [new Paragraph({ style: styleRef(block.style), children: runsOf(block.text, values) })];
  }

  if (block.type === "heading") {
    return [
      new Paragraph({
        style: styleRef(block.style),
        outlineLevel: block.level - 1,
        children: runsOf(block.text, values),
      }),
    ];
  }

  return [];
}

function styleRef(style: string | undefined): string | undefined {
  return style === undefined ? undefined : styleIdOf(style);
}

function runsOf(text: string, values: Record<string, ValueEntry>): TextRun[] {
  return parseInline(text, values).map(toTextRun);
}

function toTextRun(run: InlineRun): TextRun {
  return new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    underline: run.underline === true ? {} : undefined,
    subScript: run.subscript,
    superScript: run.superscript,
  });
}
