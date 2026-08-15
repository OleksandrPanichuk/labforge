import type { Block } from "@labforge/ir";
import {
  AlignmentType,
  ImportedXmlComponent,
  Paragraph,
  type ParagraphChild,
  Tab,
  TabStopType,
  TextRun,
  XmlComponent,
} from "docx";
import { mml2omml } from "mathml2omml";
import temml from "temml";
import type { BlockContext } from "./blocks";
import { FormulaError, RenderError } from "./errors";
import { mmToTwips } from "./styles";

const A4_WIDTH_MM = 210;

export function latexToOmml(latex: string): string {
  if (latex.trim() === "") {
    throw new FormulaError(latex, "the formula is empty");
  }

  const mathml = toMathml(latex);

  try {
    return mml2omml(mathml);
  } catch (error) {
    throw new FormulaError(latex, describe(error));
  }
}

function toMathml(latex: string): string {
  try {
    return temml.renderToString(latex, { xml: true, throwOnError: true });
  } catch (error) {
    throw new FormulaError(latex, describe(error));
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface FormulaNumbering {
  next(): number;
}

export function createFormulaNumbering(): FormulaNumbering {
  let issued = 0;

  return {
    next() {
      issued += 1;
      return issued;
    },
  };
}

export function renderFormula(
  block: Extract<Block, { type: "formula" }>,
  context: BlockContext,
): Paragraph[] {
  const math = importOmml(latexToOmml(block.latex), block.latex);

  if (!block.numbered) {
    return [new Paragraph({ alignment: AlignmentType.CENTER, children: [math] })];
  }

  const right = textWidthTwips(context);

  return [
    new Paragraph({
      tabStops: [
        { type: TabStopType.CENTER, position: Math.round(right / 2) },
        { type: TabStopType.RIGHT, position: right },
      ],
      children: [
        new TextRun({ children: [new Tab()] }),
        math,
        new TextRun({ children: [new Tab()] }),
        new TextRun(`(${context.formulaNumber.next()})`),
      ],
    }),
  ];
}

// fromXmlString wraps the parsed element in a keyless component; rendering that wrapper
// emits literal <undefined> tags, so the real element has to be taken out of it. This
// re-parse is also what rejects converter output that is not well-formed XML.
function importOmml(omml: string, latex: string): ParagraphChild {
  let element: unknown;

  try {
    const wrapper = ImportedXmlComponent.fromXmlString(omml) as unknown as {
      root?: unknown[];
    };
    element = wrapper.root?.[0];
  } catch (error) {
    throw new FormulaError(latex, `the converted math is not valid XML: ${describe(error)}`);
  }

  if (!(element instanceof XmlComponent)) {
    throw new FormulaError(latex, "the converted math could not be imported into the document");
  }

  return element as unknown as ParagraphChild;
}

function textWidthTwips(context: BlockContext): number {
  const margins = context.page.marginsMm;
  const textWidthMm = A4_WIDTH_MM - margins.left - margins.right;

  if (textWidthMm <= 0) {
    throw new RenderError(`Margins leave no text width: ${margins.left}+${margins.right} mm`);
  }

  return mmToTwips(textWidthMm);
}
