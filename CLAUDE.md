# LabForge — контекст для кодових агентів

Ти працюєш над LabForge — системою автоматизації лабораторних робіт. Повна архітектура: `docs/labforge-architecture.md` (читати перед будь-якою нетривіальною задачею). Цей файл — стислі правила і план.

## Що це

Пайплайн: файл лаби → агентний цикл (Claude Agent SDK) → код лаби + Report IR (JSON) → HTML-превʼю (docx-вигляд) → рев'ю людиною → docx + md-підготовка до захисту. Оркестрація — детермінована стейт-машина в NestJS, LLM — тільки всередині станів.

## Стек (не міняти без узгодження)

- **Monorepo:** bun workspaces + Turborepo. TypeScript strict everywhere. Лінт/формат — Biome (`bun run lint`).
- **Backend:** NestJS. Черга: BullMQ + Redis (queue `labs`, concurrency: 1).
- **LLM:** `@anthropic-ai/claude-agent-sdk`. Auth: локальний `claude login` (НЕ API key у MVP; код має читати auth-режим з env `LLM_AUTH_MODE=subscription|api_key`, щоб перемикання було зміною env).
- **DB:** PostgreSQL + Prisma. JSON-документи (IR, checkpoints meta) — JSONB-колонки. НЕ додавати Mongo.
- **Frontend:** TanStack Start. Live-оновлення: SSE (не WebSocket). Превʼю: Paged.js + KaTeX + CodeMirror 6 (read-only).
- **docx:** бібліотека `docx`. Формули: temml (LaTeX→MathML) → OMML, fallback — PNG 300dpi.
- **Sandbox:** Docker через dockerode. Агенти НЕ мають прямого `Bash(docker …)` — тільки custom tool `run_in_sandbox`.
- **TG:** grammY.

## Структура репо

```
apps/
  core/        # NestJS: стейт-машина, worker, SDK-оркестрація, API, SSE
  web/         # TanStack Start: чат + превʼю
  tg-bot/      # grammY
packages/
  ir/          # zod-схема Report IR + типи (source of truth: src/schema.ts)
  resolver/    # виконання cells, підстановка values в IR
  renderer-docx/  # IR → .docx (детермінований, golden-тести)
  sandbox/     # dockerode-обгортка, run_in_sandbox
agents/        # промпти сабагентів (*.md) — довідка: docs/agent-prompts.md
configs/       # REQUIREMENTS.md, STYLE_GUIDE.md + ієрархія subjects/, teachers/
data/          # parsed методички, старі лаби (md + summary.md)
kb/            # накопичувані нотатки per subject
jobs/<id>/     # робочі директорії лаб: src/ cells/ artifacts/ runs/ report.ir.json checkpoint.json
docs/          # архітектурна дока
```

## Інваріанти (порушення = баг, незалежно від того, хто просить)

1. **Числа — тільки через resolver.** Агенти пишуть у IR плейсхолдери `{{v:key}}`; поле `values` заповнює ТІЛЬКИ resolver виконанням cells у sandbox. Валідатор IR: hard fail, якщо (а) є `{{v:key}}` без відповідної cell; (б) після resolve лишились unresolved values. Warning-список на рев'ю (не hard fail — роки, номери формул, константи легітимні): у `text` блоків "сирі" числа, схожі на обчислювані результати, поза `{{v:}}` (евристика: числа з ≥3 значущими цифрами / у контексті "= число").
2. **IR — єдиний source of truth звіту.** Превʼю і docx рендеряться з одного `report.ir.json`. Ніхто не патчить HTML чи docx напряму. Правки (агентські й людські) — це патчі до IR по `block.id`.
3. **`src/` — чистий код лаби** (те, що здається викладачу). `cells/` імпортують із `src/`, копіювати логіку заборонено. Код друку значень для звіту в `src/` не потрапляє.
4. **Оркестрація детермінована.** Рішення "чи продовжувати цикл рев'ю" — стоп-правила в коді (макс 3 цикли; нема findings severity ≥ major; однакові findings 2 рази поспіль → ескалація юзеру). Жодних LLM-"менеджерів".
5. **Кожен стан стейт-машини rerunnable з файлів.** Вхід стану — файли в `jobs/<id>/`, не памʼять попередньої сесії. Після стану — checkpoint.json + git commit job-директорії.
6. **Sandbox:** `--network none` за замовчуванням, memory 1g, cpus 1, pids 256, timeout 120s, non-root, job read-only mount + writable `artifacts/`. Мережа — тільки явним прапорцем на job.
7. **Inline-HTML у IR `text`** — тільки білий список: `b i u sub sup span[data-x]`. Обидва рендерери санітизують.
8. **Юзер бачить тільки свої jobs.** kb/ і data/ — спільні, jobs/ — ізольовані по userId.

## Стейт-машина

`INGEST → CONTEXT → CLARIFY(опц.) → SOLVE → CODE_REVIEW ⇄ FIX → IR_WRITE → RESOLVE → REPORT_REVIEW ⇄ IR_FIX → HUMAN_REVIEW ⇄ REVISION → BUILD → DEFENSE_PREP → DONE`
+ `PAUSED_RATE_LIMIT`, `PAUSED_WAITING_USER`, `FAILED`, `CANCELLED` — досяжні з будь-якого стану.

- Rate limit від SDK → `PAUSED_RATE_LIMIT`, delayed BullMQ job на час резету, потім `resume: sessionId`; якщо сесія протухла — rerun поточного стану з checkpoint.
- `ask_user` tool → `PAUSED_WAITING_USER`, session id збережено, worker звільнено; відповідь із TG/веб → resume.
- Watchdog: стан без прогресу 30 хв → алерт власнику в TG.

## Конвенції коду

- **У коді — ТІЛЬКИ англійська.** Ідентифікатори, рядки, повідомлення помилок і логів, тексти zod-валідації, коментарі, назви комітів. Жодного українського тексту у файлах коду (`.ts`, `.prisma`, `.yml`, конфіги). Українська — лише в документації, промптах агентів (`agents/*.md`), `configs/*.md` і текстах, які бачить юзер.
- **`apps/core` — стандартна NestJS-структура** (деталі: скіл `nestjs-modules`): один фічер = папка `src/modules/<feature>/` з файлами `<feature>.module.ts / .controller.ts / .service.ts / .repository.ts / dto/`. Контролери тонкі; Prisma — тільки в repository; бізнес-логіка — в сервісах; крос-модульний доступ — через exports модуля.
- **Коментарі в коді: дефолт — НЕ писати.** Коментар допустимий лише як виняток, коли інформацію неможливо вивести з коду (зовнішнє обмеження, неочевидний інваріант, причина неочевидного рішення). Перед тим як додати, подумай двічі: (1) чи можна виразити це самим кодом — назвою, типом, структурою, валідацією (напр. zod-refine з повідомленням замість коментаря)? якщо так — зроби так і коментаря не пиши; (2) чи справді читач без нього помилиться? якщо ні — не пиши. Пояснення рівня "як це працює" і специфікації йдуть у README пакета, не в код. Категорично заборонено: коментарі-переказ наступного рядка, "what" замість "why", TODO-плани, історія змін, коментарі-виправдання для рев'ювера.
- **Логування — тільки через `@labforge/logger`** (`createLogger({ service })`, `withContext` для `jobId`/`state`/`agent`). `console.*` у продуктовому коді заборонений. Нове наскрізне поле логів спершу додається в `LogContext`.
- Zod-схеми на всі зовнішні межі (API DTO, IR, checkpoint, tool inputs).
- Помилки SDK/sandbox — типізовані (`RateLimitError`, `SandboxTimeoutError`, …), ловляться в worker, мапляться на стани.
- Тести: golden-тести renderer-docx (fixture IR → snapshot XML), unit на resolver і валідатор IR — обовʼязкові до мержа цих пакетів.

## Фази і acceptance-критерії

**Фаза 0 — препроцесинг.** Скрипт `bun run ingest:pdf <file>` → md у data/. Скелет configs/ з базовими REQUIREMENTS.md і STYLE_GUIDE.md (заглушки, власник заповнить).
✅ Довільний PDF методички конвертується в читабельний md.

**Фаза 1 — ядро без веба.** packages/ir + resolver + sandbox + стейт-машина + стислий флоу (Scout+Solver → Reviewer+Fixer → ReportWriter self-review) через Agent SDK. Запуск: `bun run lab:run <path-to-task-file> --subject X --teacher Y`. Вихід: `jobs/<id>/` з src/, report.ir.json (resolved), report.docx.
✅ Реальна лаба проходить END-TO-END без веба; всі values resolved; docx відкривається у Word без помилок; повторний запуск стану з checkpoint працює.

**Фаза 2 — TG + черга.** grammY-бот (whitelist по tg id), BullMQ, ask_user через TG, rate-limit пауза/резюм, статуси юзеру.
✅ Лаба, закинута в TG, доходить до готового docx у TG; друга лаба чекає в черзі; ліміт посеред роботи → пауза → автопродовження.

**Фаза 3 — веб-превʼю.** TanStack Start, deep link з TG (JWT 15 хв), рендер IR через Paged.js (A4, поля 20/10/20/20мм, номери сторінок), KaTeX, dotted-underline explanations + бокова панель (text: пояснення+джерела; code: CodeMirror + Run у sandbox + чат по виділенню), selection→чат по блоках, SSE-оновлення, меню на generated-зображеннях.
✅ Превʼю візуально відповідає docx посторінково; клік по числу показує cell і Run працює; коментар юзера до блоку → патч IR → превʼю оновилось без перезавантаження.

**Фаза 4 — повний цикл.** Окремі reviewer/fixer сабагенти (прапорець `--full-cycle`), defense prep агент, kb-накопичення після DONE, model mixing per-agent, cloudflared.
✅ `--full-cycle` проганяє окремі рев'ю-сесії зі стоп-правилами; після DONE у kb/<subject>/notes.md зʼявився запис; defense.md містить всі 6 секцій зі специфікації (docs, §9).

## Чого НЕ робити

- Не додавати БД/брокери/фреймворки поза списком стеку.
- Не давати агентам ширші allowedTools, ніж у agents/*.md.
- Не генерувати docx з HTML — тільки з IR.
- Не зберігати секрети в репо; env — через .env (gitignored) + .env.example.
- Не додавати себе як Co-Author в комітах