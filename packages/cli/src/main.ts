import { join } from "node:path";
import { createLogger } from "@labforge/logger";
import { labRun, type ParsedArgs, parseArgs } from "./lab-run";
import { queueLab } from "./queue-lab";

const logger = createLogger({ service: "cli" });

const EXIT = { done: 0, failed: 1, paused: 2 };

async function enqueue(options: ParsedArgs): Promise<number> {
  const outcome = await queueLab({ options });

  if (outcome.answerDropped) {
    logger.error(
      { jobId: options.jobId },
      "that lab is already in the queue, so the answer was not delivered; wait for it to pause again",
    );

    return EXIT.failed;
  }

  if (!outcome.queued) {
    logger.warn({ jobId: options.jobId }, "that lab is already in the queue; nothing to do");

    return EXIT.done;
  }

  logger.info({ jobId: options.jobId }, "the lab is in the queue; run lab:worker to work it off");

  return EXIT.done;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.queue) {
    return await enqueue(options);
  }

  const result = await labRun(options);
  const jobDir = join(options.jobsDir, options.jobId);

  if (result.state === "FAILED") {
    logger.error({ jobDir, reason: result.reason }, "the lab failed");

    return EXIT.failed;
  }

  if (result.state.startsWith("PAUSED")) {
    logger.warn(
      { jobDir, question: result.question, resumeAt: result.resumeAt, reason: result.reason },
      result.question === undefined
        ? "the lab is waiting; run the same command again to continue"
        : `the lab is waiting for an answer; reply with: bun run lab:run --job ${options.jobId} --answer "..."`,
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
