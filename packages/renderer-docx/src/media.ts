import type { Block } from "@labforge/ir";
import { AlignmentType, ImageRun, PageBreak, Paragraph, TextRun } from "docx";
import type { BlockContext } from "./blocks";
import { RenderError } from "./errors";
import type { JobFiles } from "./files";
import { readPngSize } from "./png";
import { textRunsOf } from "./runs";

const A4_WIDTH_MM = 210;
const PX_PER_INCH = 96;
const MM_PER_INCH = 25.4;
const CAPTION_STYLE = "caption";
const CODE_FONT = "Courier New";
const CODE_SIZE_HALF_POINTS = 20;
const PERCENT_RE = /^(\d+(?:\.\d+)?)%$/;

export function renderImage(
  block: Extract<Block, { type: "image" }>,
  context: BlockContext,
): Paragraph[] {
  const data = filesOf(context).read(block.src);
  const source = readPngSize(data);
  const width = pixelsAcross(context, fractionOf(block.width));
  const height = Math.round((width * source.height) / source.width);

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({ data, type: "png", transformation: { width, height } })],
    }),
    ...captionBelow(block.caption, context),
  ];
}

export function renderCodeListing(
  block: Extract<Block, { type: "code-listing" }>,
  context: BlockContext,
): Paragraph[] {
  const content = filesOf(context).read(block.file).toString("utf8");
  const lines = selectLines(content, block.lines);

  return [
    ...lines.map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line, font: CODE_FONT, size: CODE_SIZE_HALF_POINTS })],
        }),
    ),
    ...captionBelow(block.caption, context),
  ];
}

export function renderPageBreak(): Paragraph[] {
  return [new Paragraph({ children: [new PageBreak()] })];
}

function selectLines(content: string, range: readonly [number, number] | undefined): string[] {
  const lines = content.replace(/\n$/, "").split("\n");

  if (range === undefined) {
    return lines;
  }

  return lines.slice(range[0] - 1, range[1]);
}

function captionBelow(caption: string | undefined, context: BlockContext): Paragraph[] {
  if (caption === undefined) {
    return [];
  }

  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      style: CAPTION_STYLE in context.styles ? CAPTION_STYLE : undefined,
      children: textRunsOf(caption, context.values),
    }),
  ];
}

function filesOf(context: BlockContext): JobFiles {
  if (context.files === undefined) {
    throw new RenderError(
      "This document references files; render it with a jobDir so they can be read",
    );
  }

  return context.files;
}

function fractionOf(width: string): number {
  const percent = PERCENT_RE.exec(width)?.[1];

  if (percent === undefined) {
    throw new RenderError(`Image width must be a percentage, got "${width}"`);
  }

  return Number(percent) / 100;
}

function pixelsAcross(context: BlockContext, fraction: number): number {
  const margins = context.page.marginsMm;
  const textWidthMm = A4_WIDTH_MM - margins.left - margins.right;

  return Math.round(((textWidthMm * fraction) / MM_PER_INCH) * PX_PER_INCH);
}
