import type { Block, ReportIR, StyleDef, ValueEntry } from "@labforge/ir";
import {
  BorderStyle,
  type IBorderOptions,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from "docx";
import type { JobFiles } from "./files";
import type { FormulaNumbering } from "./formula";
import { textRunsOf } from "./runs";

export const ORDERED_LIST_REFERENCE = "labforge-ordered";
const CAPTION_STYLE = "caption";

const CELL_BORDER: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: "000000" };

const TABLE_BORDERS = {
  top: CELL_BORDER,
  bottom: CELL_BORDER,
  left: CELL_BORDER,
  right: CELL_BORDER,
  insideHorizontal: CELL_BORDER,
  insideVertical: CELL_BORDER,
};

export interface ListInstances {
  next(): number;
}

export function createListInstances(): ListInstances {
  let issued = 0;

  return {
    next() {
      issued += 1;
      return issued;
    },
  };
}

export interface BlockContext {
  values: Record<string, ValueEntry>;
  styles: Record<string, StyleDef>;
  page: ReportIR["page"];
  files?: JobFiles;
  listInstance: ListInstances;
  formulaNumber: FormulaNumbering;
}

export function renderList(
  block: Extract<Block, { type: "list" }>,
  context: BlockContext,
): Paragraph[] {
  const instance = block.ordered ? context.listInstance.next() : 0;

  return block.items.map(
    (item) =>
      new Paragraph({
        style: block.style,
        ...(block.ordered
          ? { numbering: { reference: ORDERED_LIST_REFERENCE, level: 0, instance } }
          : { bullet: { level: 0 } }),
        children: textRunsOf(item, context.values),
      }),
  );
}

export function renderTable(
  block: Extract<Block, { type: "table" }>,
  context: BlockContext,
): (Paragraph | Table)[] {
  const caption = block.caption === undefined ? [] : [captionParagraph(block.caption, context)];

  const width = block.header.length;
  const header = new TableRow({
    tableHeader: true,
    children: block.header.map((cell, column) => tableCell(cell, column, block, context)),
  });

  const body = block.rows.map(
    (row) =>
      new TableRow({
        children: fit(row, width).map((cell, column) => tableCell(cell, column, block, context)),
      }),
  );

  return [
    ...caption,
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: TABLE_BORDERS,
      rows: [header, ...body],
    }),
    new Paragraph({}),
  ];
}

function fit(row: string[], width: number): string[] {
  const cells = row.slice(0, width);

  while (cells.length < width) {
    cells.push("");
  }

  return cells;
}

function captionParagraph(caption: string, context: BlockContext): Paragraph {
  return new Paragraph({
    style: CAPTION_STYLE in context.styles ? CAPTION_STYLE : undefined,
    children: textRunsOf(caption, context.values),
  });
}

function tableCell(
  text: string,
  column: number,
  block: Extract<Block, { type: "table" }>,
  context: BlockContext,
): TableCell {
  const fraction = block.columnWidths?.[column];

  return new TableCell({
    ...(fraction === undefined
      ? {}
      : { width: { size: fraction * 100, type: WidthType.PERCENTAGE } }),
    children: [new Paragraph({ style: block.style, children: textRunsOf(text, context.values) })],
  });
}
