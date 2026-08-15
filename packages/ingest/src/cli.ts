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
      outDir = argv[index] ?? DEFAULT_OUTPUT;
      continue;
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
  } catch (error) {
    logger.error(messageOf(error));
    return 1;
  }

  mkdirSync(options.outDir, { recursive: true });
  let failures = 0;

  for (const input of options.inputs) {
    try {
      const result = await ingestDocument({ name: basename(input), bytes: readFileSync(input) });
      const target = join(options.outDir, markdownNameFor(input));

      writeFileSync(target, result.markdown, "utf8");
      logger.info({ source: input, target, format: result.meta.format }, "ingested");
    } catch (error) {
      failures += 1;
      logger.error({ source: input }, messageOf(error));
    }
  }

  return failures === 0 ? 0 : 1;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
