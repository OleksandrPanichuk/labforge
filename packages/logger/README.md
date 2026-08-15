# @labforge/logger

Спільний структурований логер (pino) для core, tg-bot, web і CLI-скриптів.
`console.*` у продуктовому коді заборонений — усе через цей пакет.

## Використання

```ts
import { createLogger, withContext } from "@labforge/logger";

const logger = createLogger({ service: "core" });

logger.info({ jobId }, "job accepted");

const jobLog = withContext(logger, { jobId, state: "SOLVE" });
jobLog.error({ err }, "state failed");
```

`withContext` приймає `LogContext` — спільний словник наскрізних полів (`jobId`, `userId`,
`state`, `agent`, `sessionId`, `cellRef`, `runId`, …). Нове наскрізне поле спершу додається
в `LogContext`, інакше той самий факт осідає в логах під різними іменами.

## NestJS

```ts
import { NestLoggerAdapter } from "@labforge/logger/nest";

const app = await NestFactory.create(AppModule, {
  logger: new NestLoggerAdapter(logger),
});
```

Внутрішні логи Nest ідуть тим самим форматом, що й прикладні.

## Конфігурація

| Env | Дефолт | Значення |
|---|---|---|
| `LOG_LEVEL` | `debug` (`info` у production) | trace \| debug \| info \| warn \| error \| fatal |
| `LOG_PRETTY` | `true` (`false` у production) | людиночитний вивід замість JSON |

Секрети (`token`, `apiKey`, `password`, `authorization`, `cookie`, `TG_BOT_TOKEN`,
`ANTHROPIC_API_KEY`, `DATABASE_URL`, …) редагуються автоматично на верхньому рівні
і на один рівень вкладеності. Новий секрет — додати в `REDACT_PATHS`.
