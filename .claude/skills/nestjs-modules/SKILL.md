---
name: nestjs-modules
description: Use when adding or changing any code in apps/core — defines the default NestJS module structure, file naming, and responsibility split (controller/service/repository) for this repo.
---

# Структура apps/core: стандартні NestJS-модулі

Без окремих clean-architecture шарів. Один фічер = одна папка в `src/modules/<feature>/`,
підключена в `AppModule`.

## Файли модуля

```
src/modules/<feature>/
  <feature>.module.ts        # wiring: imports, providers, exports
  <feature>.controller.ts    # HTTP/SSE ендпоінти
  <feature>.service.ts       # бізнес-логіка
  <feature>.repository.ts    # ВЕСЬ доступ до Prisma цього фічера
  <feature>.errors.ts        # типізовані помилки фічера (якщо є)
  dto/                       # zod-схеми + z.infer типи на межі модуля
```

Великий модуль може мати кілька сервісів (`state-machine.service.ts`,
`agent-session.service.ts`) — суфікси лишаються, файл називається за роллю.

## Розподіл відповідальностей

- **Controller** — тонкий: парсинг/валідація входу (zod), виклик сервісу, мапінг
  відповіді. Жодної бізнес-логіки, жодного Prisma.
- **Service** — бізнес-логіка. До БД — тільки через repository; до зовнішніх систем
  (Docker, Agent SDK, Telegram) — через відповідний сервіс/пакет, не інлайном.
- **Repository** — єдине місце з Prisma-запитами фічера. Повертає доменні типи/об'єкти,
  не "сирі" селекти з include-хащами назовні.
- Помилки зовнішніх систем мапляться на типізовані (`RateLimitError`,
  `SandboxTimeoutError`, …) у сервісі-обгортці, а не ловляться рядковим матчингом
  по всьому коду.

## Правила репо (з CLAUDE.md — обовʼязкові)

- Zod-схеми на всі зовнішні межі: API DTO, tool inputs, checkpoint, IR.
- Оркестрація детермінована: стоп-правила і рішення циклів — код у сервісі
  стейт-машини, не LLM.
- Спільна логіка поза core (IR, resolver, docx, sandbox-обгортка) — `packages/*`;
  core лише викликає їх.
- Крос-модульні залежності — через exports модуля; не імпортувати внутрішні файли
  чужого модуля напряму.

## Чек-лист перед комітом

- [ ] Prisma-виклики тільки в `*.repository.ts`
- [ ] контролери без бізнес-логіки
- [ ] нові зовнішні межі мають zod-схеми в `dto/`
- [ ] модуль підключено в `AppModule`, а не імпортом файлів навпростець
