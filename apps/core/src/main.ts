import { createLogger } from "@labforge/logger";
import { NestLoggerAdapter } from "@labforge/logger/nest";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap(): Promise<void> {
  const logger = createLogger({ service: "core" });
  const app = await NestFactory.create(AppModule, { logger: new NestLoggerAdapter(logger) });
  const port = Number(process.env.PORT ?? 3000);

  await app.listen(port);
  logger.info({ port }, "core listening");
}

void bootstrap();
