import { createLogger } from "@labforge/logger";

const logger = createLogger({ service: "tg-bot" });

if (!process.env.TG_BOT_TOKEN) {
  logger.fatal("TG_BOT_TOKEN is not set");
  process.exit(1);
}

logger.info("tg-bot bootstrap placeholder, bot flow lands in phase 2");
