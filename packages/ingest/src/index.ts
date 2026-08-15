export { docxToMarkdown, MAX_DOCUMENT_BYTES } from "./docx";
export { IngestError } from "./errors";
export {
  detectFormat,
  type IngestMeta,
  type IngestRequest,
  type IngestResult,
  ingestDocument,
  MAX_INPUT_BYTES,
  MAX_NAME_LENGTH,
  type SourceFormat,
} from "./ingest";
