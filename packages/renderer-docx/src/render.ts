import type { Block, ReportIR, StyleDef } from "@labforge/ir";
import {
  AlignmentType,
  Document,
  Footer,
  type ISectionOptions,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  type Table,
  TextRun,
} from "docx";
import {
  type BlockContext,
  createListInstances,
  ORDERED_LIST_REFERENCE,
  renderList,
  renderTable,
} from "./blocks";
import { type JobFiles, jobFilesAt } from "./files";
import { renderCodeListing, renderImage, renderPageBreak } from "./media";
import { textRunsOf } from "./runs";
import { mmToTwips, paragraphOptionsOf, runOptionsOf, styleIdOf } from "./styles";

export type DocumentPart = "document" | "styles" | "footer1";

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const DEFAULT_STYLE = "default";

export interface RenderOptions {
  jobDir?: string;
  files?: JobFiles;
}

export async function renderReport(ir: ReportIR, options: RenderOptions = {}): Promise<Buffer> {
  return await Packer.toBuffer(buildDocument(ir, options));
}

export function buildDocument(ir: ReportIR, options: RenderOptions = {}): Document {
  return new Document({
    creator: ir.meta.student.name,
    title: ir.meta.title,
    styles: {
      default: { document: styleOf(ir, DEFAULT_STYLE) },
      paragraphStyles: namedStyles(ir),
    },
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REFERENCE,
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: "%1.",
              alignment: AlignmentType.LEFT,
            },
          ],
        },
      ],
    },
    sections: [section(ir, options)],
  });
}

function renderBlocks(ir: ReportIR, options: RenderOptions): (Paragraph | Table)[] {
  const context = blockContext(ir, options);

  return ir.blocks.flatMap((block) => renderBlock(block, context));
}

function blockContext(ir: ReportIR, options: RenderOptions): BlockContext {
  const files =
    options.files ?? (options.jobDir === undefined ? undefined : jobFilesAt(options.jobDir));

  return {
    values: ir.values,
    styles: ir.styles,
    page: ir.page,
    files,
    listInstance: createListInstances(),
  };
}

function section(ir: ReportIR, options: RenderOptions): ISectionOptions {
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
    children: renderBlocks(ir, options),
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

function renderBlock(block: Block, context: BlockContext): (Paragraph | Table)[] {
  switch (block.type) {
    case "paragraph":
      return [
        new Paragraph({ style: styleRef(block.style), children: runsOf(block.text, context) }),
      ];
    case "heading":
      return [
        new Paragraph({
          style: styleRef(block.style),
          outlineLevel: block.level - 1,
          children: runsOf(block.text, context),
        }),
      ];
    case "list":
      return renderList(block, context);
    case "table":
      return renderTable(block, context);
    case "image":
      return renderImage(block, context);
    case "code-listing":
      return renderCodeListing(block, context);
    case "pagebreak":
      return renderPageBreak();
    default:
      return [];
  }
}

function styleRef(style: string | undefined): string | undefined {
  return style === undefined ? undefined : styleIdOf(style);
}

function runsOf(text: string, context: BlockContext): TextRun[] {
  return textRunsOf(text, context.values);
}
