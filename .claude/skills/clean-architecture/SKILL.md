---
name: clean-architecture
description: Use when adding or changing any code in apps/core — defines the layer map, the dependency rule, where new code goes, and port/adapter conventions for this repo.
---

# Clean Architecture в apps/core

## Шари і правило залежностей

```
presentation ──┐
               ├──▶ application ──▶ domain
infrastructure ┘         (порти оголошені в domain, реалізовані в infrastructure)
```

Залежності направлені ТІЛЬКИ всередину. `domain` не знає ні про кого. `application`
знає тільки `domain`. `presentation` та `infrastructure` знають `application` і `domain`,
але не одне одного.

## Куди кладеться новий код

| Що пишеш | Шар | Приклад |
|---|---|---|
| Сутність, value object | `domain` | `Job`, `Checkpoint`, `Finding`, `JobState` |
| Порт (інтерфейс до зовнішнього світу) | `domain/ports` | `SandboxPort`, `LlmSessionPort`, `JobRepositoryPort`, `UserNotifierPort` |
| Use case, стейт-машина, стоп-правила | `application` | `RunJobStateUseCase`, `StateMachine` |
| Prisma, BullMQ, dockerode, Agent SDK, fs, git | `infrastructure` | `PrismaJobRepository`, `AgentSdkSession` |
| Контролер, DTO (zod), SSE | `presentation` | `JobsController`, SSE hub |

Спільна логіка поза core (IR-схема, resolver, docx, sandbox-обгортка) — це `packages/*`,
не шари core. Core імпортує пакети тільки з `infrastructure` (окрім типів `@labforge/ir`,
які дозволені всюди — це мова домену).

## Конвенції

- Порт: інтерфейс `XxxPort` + DI-токен `Symbol("XxxPort")` поруч у `domain/ports`.
  Адаптер: клас `<Tech>XxxAdapter` (або `<Tech>XxxRepository`) у `infrastructure`,
  біндиться до токена в NestJS-модулі інфраструктури.
- Use case: один клас — один `execute()`. Без гілкування "на всі випадки життя".
- Помилки зовнішніх систем мапляться на типізовані (`RateLimitError`,
  `SandboxTimeoutError`, …) в адаптері, до перетину межі application.
- Zod-схеми на кожній зовнішній межі: API DTO, tool inputs, checkpoint, IR.
- NestJS-декоратори (`@Injectable`, `@Module`) НЕ використовуються в `domain` і
  `application` — ці шари мають компілюватися без NestJS. Wiring — тільки в модулях
  `infrastructure`/`presentation` (через `useClass`/`useFactory` провайдери).

## Чек-лист перед комітом

- [ ] `domain`/`application` не імпортують nestjs/prisma/bullmq/dockerode/agent-sdk
- [ ] нова зовнішня взаємодія йде через порт, а не прямий імпорт в use case
- [ ] стоп-правила і рішення оркестрації — детермінований код, не LLM (CLAUDE.md, інваріант 4)
- [ ] zod-валідація на нових зовнішніх межах
