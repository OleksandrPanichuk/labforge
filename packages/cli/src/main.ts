import { createLogger } from "@labforge/logger";
import { labRun, parseArgs } from "./lab-run";

const logger = createLogger({ service: "cli" });

async function main(): Promise<number> {
  const result = await labRun(parseArgs(process.argv.slice(2)));

  if (result.question !== undefined) {
    logger.warn({ question: result.question }, "the lab needs an answer before it can go on");
  }

  return result.state === "FAILED" ? 1 : 0;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    logger.fatal(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
