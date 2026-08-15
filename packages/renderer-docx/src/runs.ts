import type { ValueEntry } from "@labforge/ir";
import { TextRun } from "docx";
import { type InlineRun, parseInline } from "./inline";

export function textRunsOf(text: string, values: Record<string, ValueEntry>): TextRun[] {
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
