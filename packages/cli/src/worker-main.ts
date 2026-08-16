import { createLogger } from "@labforge/logger";
import { startLabWorker } from "./worker";

const logger = createLogger({ service: "cli" });

const worker = startLabWorker({
  jobsDir: process.env.LABFORGE_JOBS_DIR ?? "jobs",
  configsDir: process.env.LABFORGE_CONFIGS_DIR ?? "configs",
  agentsDir: process.env.LABFORGE_AGENTS_DIR ?? "agents",
});

logger.info({}, "the worker is up; one lab at a time");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "finishing the lab in hand, then stopping");

    worker
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((error: unknown) => {
        logger.error({ error: String(error) }, "the worker did not stop cleanly");
        process.exit(1);
      });
  });
}
