import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { createLogger } from "@labforge/logger";
import { IngestError, ingestDocument } from "./ingest";

const DEFAULT_OUTPUT = "data/parsed";

export interface CliOptions {
  inputs: string[];
  outDir: string;
}

export function parseArgs(argv: string[]): CliOptions {
  const inputs: string[] = [];
  let outDir = DEFAULT_OUTPUT;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--out") {
      index += 1;
      const value = argv[index];

      if (value === undefined) {
        throw new IngestError("--out needs a directory");
      }

      outDir = value;
      continue;
    }

    if (argument?.startsWith("-") === true) {
      throw new IngestError(`Unknown option "${argument}"`);
    }

    if (argument !== undefined) {
      inputs.push(argument);
    }
  }

  if (inputs.length === 0) {
    throw new IngestError("Usage: bun run ingest <file...> [--out data/parsed]");
  }

  return { inputs, outDir };
}

export function markdownNameFor(source: string): string {
  const name = basename(source, extname(source));

  return `${name.replace(/[^\p{L}\p{N}._-]+/gu, "-").toLowerCase()}.md`;
}

export async function runCli(argv: string[]): Promise<number> {
  const logger = createLogger({ service: "cli" });
  let options: CliOptions;

  try {
    options = parseArgs(argv);
    mkdirSync(options.outDir, { recursive: true });
  } catch (error) {
    logger.error(messageOf(error));
    return 1;
  }

  let failures = 0;

  for (const input of options.inputs) {
    try {
      const result = await ingestDocument({ name: basename(input), bytes: readFileSync(input) });
      const target = join(options.outDir, markdownNameFor(input));

      writeFileSync(target, result.markdown, { encoding: "utf8", flag: "wx" });
      logger.info({ source: input, target, format: result.meta.format }, "ingested");
    } catch (error) {
      failures += 1;
      logger.error({ source: input }, describeFailure(error, options.outDir));
    }
  }

  return failures === 0 ? 0 : 1;
}

function describeFailure(error: unknown, outDir: string): string {
  if ((error as { code?: string }).code === "EEXIST") {
    return `a note with this name already exists in ${outDir}; rename the input or ingest it separately`;
  }

  return messageOf(error);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
