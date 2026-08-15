export type CellValue = number | string;

const SCI_RE = /^sci:(\d+)$/;
const FIXED_RE = /^fixed:(\d+)$/;

export function formatValue(
  raw: CellValue,
  format: string | undefined,
  decimalSeparator: string,
): string {
  if (typeof raw === "string") {
    return raw;
  }

  return applySeparator(render(raw, format), decimalSeparator);
}

function render(raw: number, format: string | undefined): string {
  if (format === undefined) {
    return String(raw);
  }

  if (format === "int") {
    return String(Math.round(raw));
  }

  const sci = SCI_RE.exec(format);
  if (sci?.[1] !== undefined) {
    return raw.toExponential(Number(sci[1])).replace(/e([+-])(\d)$/, "e$1$2");
  }

  const fixed = FIXED_RE.exec(format);
  if (fixed?.[1] !== undefined) {
    return raw.toFixed(Number(fixed[1]));
  }

  throw new Error(`Unknown format "${format}"`);
}

function applySeparator(rendered: string, decimalSeparator: string): string {
  return decimalSeparator === "." ? rendered : rendered.replace(".", decimalSeparator);
}
