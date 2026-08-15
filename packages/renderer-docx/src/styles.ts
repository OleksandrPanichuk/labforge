import type { StyleDef } from "@labforge/ir";
import { AlignmentType, type IParagraphOptions, type IRunOptions, LineRuleType } from "docx";
import { StyleError } from "./errors";

const TWIPS_PER_POINT = 20;
const TWIPS_PER_CM = 567;
const TWIPS_PER_INCH = 1440;
const MM_PER_INCH = 25.4;
const LINE_UNIT = 240;

const ALIGNMENT: Record<
  NonNullable<StyleDef["align"]>,
  (typeof AlignmentType)[keyof typeof AlignmentType]
> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.BOTH,
};

const CM_RE = /^(-?\d+(?:\.\d+)?)\s*cm$/;

export function ptToHalfPoints(points: number): number {
  return Math.round(points * 2);
}

export function ptToTwips(points: number): number {
  return Math.round(points * TWIPS_PER_POINT);
}

export function cmToTwips(centimetres: number): number {
  return Math.round(centimetres * TWIPS_PER_CM);
}

export function mmToTwips(millimetres: number): number {
  return Math.round((millimetres * TWIPS_PER_INCH) / MM_PER_INCH);
}

export function runOptionsOf(style: StyleDef): IRunOptions {
  return {
    ...(style.font !== undefined && { font: style.font }),
    ...(style.size !== undefined && { size: ptToHalfPoints(style.size) }),
    ...(style.bold !== undefined && { bold: style.bold }),
    ...(style.italic !== undefined && { italics: style.italic }),
    ...(style.caps !== undefined && { allCaps: style.caps }),
  };
}

export function paragraphOptionsOf(style: StyleDef): IParagraphOptions {
  const spacing = spacingOf(style);

  return {
    ...(style.align !== undefined && { alignment: ALIGNMENT[style.align] }),
    ...(spacing !== undefined && { spacing }),
    ...(style.firstLineIndent !== undefined && {
      indent: { firstLine: parseLength(style.firstLineIndent) },
    }),
  };
}

function spacingOf(style: StyleDef): IParagraphOptions["spacing"] {
  const spacing = {
    ...(style.lineHeight !== undefined && {
      line: Math.round(style.lineHeight * LINE_UNIT),
      lineRule: LineRuleType.AUTO,
    }),
    ...(style.spaceBefore !== undefined && { before: ptToTwips(style.spaceBefore) }),
    ...(style.spaceAfter !== undefined && { after: ptToTwips(style.spaceAfter) }),
  };

  return Object.keys(spacing).length > 0 ? spacing : undefined;
}

function parseLength(length: string): number {
  const centimetres = CM_RE.exec(length)?.[1];

  if (centimetres === undefined) {
    throw new StyleError(`Cannot convert "${length}"; lengths must be given in cm`);
  }

  return cmToTwips(Number(centimetres));
}
