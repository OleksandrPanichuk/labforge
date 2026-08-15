export class RenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class UnresolvedValueError extends RenderError {
  constructor(readonly key: string) {
    super(`Value "${key}" has no resolved value; run the resolver before rendering`);
  }
}

export class InlineMarkupError extends RenderError {}

export class StyleError extends RenderError {}

export class FormulaError extends RenderError {
  constructor(
    readonly latex: string,
    reason: string,
  ) {
    super(`Cannot convert formula "${latex}" to Word math: ${reason}`);
  }
}
