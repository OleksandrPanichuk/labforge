import { join } from "node:path";
import { createLogger } from "@labforge/logger";
import { labRun, parseArgs } from "./lab-run";

const logger = createLogger({ service: "cli" });

const EXIT = { done: 0, failed: 1, paused: 2 };

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const result = await labRun(options);
  const jobDir = join(options.jobsDir, options.jobId);

  if (result.state === "FAILED") {
    logger.error({ jobDir, reason: result.reason }, "the lab failed");

    return EXIT.failed;
  }

  if (result.state.startsWith("PAUSED")) {
    logger.warn(
      { jobDir, question: result.question, resumeAt: result.resumeAt, reason: result.reason },
      "the lab is waiting; run the same command again to continue",
    );

    return EXIT.paused;
  }

  logger.info({ jobDir, report: join(jobDir, "report.docx") }, "the lab is ready for review");

  return EXIT.done;
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    logger.fatal(error instanceof Error ? error.message : String(error));
    process.exit(EXIT.failed);
  });
