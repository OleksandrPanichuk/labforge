import { join, resolve } from "node:path";
import { createLogger } from "@labforge/logger";
import { createLabQueue } from "@labforge/queue";
import { labRun, type ParsedArgs, parseArgs } from "./lab-run";

const logger = createLogger({ service: "cli" });

const EXIT = { done: 0, failed: 1, paused: 2 };

async function enqueue(options: ParsedArgs): Promise<number> {
  const queue = createLabQueue();

  let queued: boolean;

  try {
    queued = await queue.enqueue({
      jobId: options.jobId,
      ...(options.taskPath !== "" && { taskPath: resolve(options.taskPath) }),
      ...(options.subject !== undefined && { subject: options.subject }),
      ...(options.teacher !== undefined && { teacher: options.teacher }),
      ...(options.variant !== undefined && { variant: options.variant }),
      ...(options.language !== undefined && { language: options.language }),
      ...(options.answer !== undefined && { answer: options.answer }),
    });
  } finally {
    await queue.close();
  }

  if (!queued) {
    logger.warn({ jobId: options.jobId }, "that lab is already in the queue; nothing to do");

    return EXIT.done;
  }

  logger.info({ jobId: options.jobId }, "the lab is in the queue; run lab:worker to work it off");

  return EXIT.done;
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  if (options.queue === true) {
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
