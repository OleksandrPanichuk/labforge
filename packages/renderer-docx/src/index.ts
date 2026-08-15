export {
  InlineMarkupError,
  RenderError,
  StyleError,
  UnresolvedValueError,
} from "./errors";
export { type InlineRun, parseInline } from "./inline";
export { buildDocument, type DocumentPart, renderReport } from "./render";
export {
  cmToTwips,
  paragraphOptionsOf,
  ptToHalfPoints,
  ptToTwips,
  runOptionsOf,
} from "./styles";
