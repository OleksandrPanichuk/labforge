# LabForge — context for coding agents

You are working on LabForge, a system that automates university lab assignments. Full architecture: `docs/labforge-architecture.md` (read it before any non-trivial task). This file holds the condensed rules and the plan.

## What this is

Pipeline: lab task file → agent loop (Claude Agent SDK) → lab code + Report IR (JSON) → HTML preview (docx-looking) → human review → docx + markdown defense prep. Orchestration is a deterministic state machine in NestJS; the LLM runs only inside states.

## Stack (do not change without agreement)

- **Monorepo:** bun workspaces + Turborepo. TypeScript strict everywhere. Lint/format: Biome (`bun run lint`). Tests: built-in `bun test`.
- **Backend:** NestJS. Queue: BullMQ + Redis (queue `labs`, concurrency: 1).
- **LLM:** `@anthropic-ai/claude-agent-sdk`. Auth: local `claude login` (NOT an API key in the MVP; the code reads the auth mode from `LLM_AUTH_MODE=subscription|api_key` so switching is an env change).
- **DB:** PostgreSQL + Prisma. JSON documents (IR, checkpoint meta) live in JSONB columns. Do NOT add Mongo.
- **Frontend:** TanStack Start. Live updates: SSE (not WebSocket). Preview: Paged.js + KaTeX + CodeMirror 6 (read-only).
- **docx:** the `docx` library. Formulas: temml (LaTeX→MathML) → OMML, fallback PNG 300 dpi.
- **Sandbox:** Docker via dockerode. Agents get NO direct `Bash(docker …)` — only the custom tool `run_in_sandbox`.
- **Telegram:** grammY.
- **Logging:** `@labforge/logger` (pino).

## Repo layout

```
apps/
  core/            # NestJS: state machine, worker, SDK orchestration, API, SSE
    src/modules/   # one folder per feature (see the nestjs-modules skill)
  web/             # TanStack Start: chat + preview
  tg-bot/          # grammY
packages/
  ir/              # zod schema of the Report IR + types (source of truth: src/schema.ts)
  resolver/        # runs cells, substitutes values into the IR
  renderer-docx/   # IR → .docx (deterministic, golden tests)
  sandbox/         # dockerode wrapper, run_in_sandbox
  logger/          # shared structured logger
agents/            # subagent prompts (*.md) — reference: docs/agent-prompts.md
configs/           # REQUIREMENTS.md, STYLE_GUIDE.md + subjects/, teachers/ hierarchy
data/             # parsed methodology docs, past labs (md + summary.md)
kb/                # accumulated notes per subject
jobs/<id>/         # per-lab working dirs: src/ cells/ artifacts/ runs/ report.ir.json checkpoint.json
docs/              # architecture documentation
```

## Invariants (a violation is a bug, no matter who asked for it)

1. **Numbers come only from the resolver.** Agents write `{{v:key}}` placeholders into the IR; the `values` field is filled ONLY by the resolver executing cells in the sandbox. IR validator hard-fails when: (a) a `{{v:key}}` has no matching cell; (b) unresolved values remain after resolve. Review warning (not a hard fail — years, formula numbers and constants are legitimate): raw computed-looking numbers in block `text` outside `{{v:}}` (heuristic: numbers with ≥3 significant digits, or in a "= number" context).
2. **The IR is the single source of truth for the report.** Preview and docx both render from one `report.ir.json`. Nobody patches HTML or docx directly. Edits — agent and human alike — are patches to the IR keyed by `block.id`.
3. **`src/` holds clean lab code** (what gets submitted to the teacher). `cells/` import from `src/`; copying logic is forbidden. Report-only value printing never lands in `src/`.
4. **Orchestration is deterministic.** "Should the review loop continue?" is decided by stop rules in code (max 3 cycles; no findings of severity ≥ major; identical findings twice in a row → escalate to the user). No LLM "managers".
5. **Every state is rerunnable from files.** A state's input is the files in `jobs/<id>/`, never the memory of a previous session. After each state: `checkpoint.json` + a git commit of the job directory.
6. **Sandbox:** `--network none` by default, memory 1g, cpus 1, pids 256, timeout 120 s, non-root, read-only job mount + writable `artifacts/`. Network access only via an explicit per-job flag.
7. **Inline HTML in IR `text`** — allowlist only: `b i u sub sup span[data-x]`. Both renderers sanitize.
8. **A user sees only their own jobs.** `kb/` and `data/` are shared; `jobs/` are isolated per userId.

## State machine

`INGEST → CONTEXT → CLARIFY(optional) → SOLVE → CODE_REVIEW ⇄ FIX → IR_WRITE → RESOLVE → REPORT_REVIEW ⇄ IR_FIX → HUMAN_REVIEW ⇄ REVISION → BUILD → DEFENSE_PREP → DONE`
plus `PAUSED_RATE_LIMIT`, `PAUSED_WAITING_USER`, `FAILED`, `CANCELLED` — reachable from any state.

- Rate limit from the SDK → `PAUSED_RATE_LIMIT`, a delayed BullMQ job scheduled for the reset time, then `resume: sessionId`; if the session has expired, rerun the current state from its checkpoint.
- The `ask_user` tool → `PAUSED_WAITING_USER`, session id stored, worker released; an answer from Telegram or the web resumes it.
- Watchdog: a state with no progress for 30 min alerts the owner on Telegram.

## Code conventions

- **Code is English ONLY.** Identifiers, strings, error and log messages, zod validation messages, comments, commit messages. No Ukrainian text in code files (`.ts`, `.prisma`, `.yml`, configs). Ukrainian belongs only in agent prompts (`agents/*.md`), the content of `configs/*.md`, prose in `docs/`, and text the end user reads (report content, Telegram and web messages).
- **`apps/core` uses the default NestJS structure** (details: the `nestjs-modules` skill): one feature = one folder `src/modules/<feature>/` containing `<feature>.module.ts / .controller.ts / .service.ts / .repository.ts / dto/`. Controllers stay thin; Prisma lives only in repositories; business logic lives in services; cross-module access goes through the module's exports.
- **Comments: the default is to write none.** A comment is an exception, allowed only when the information cannot be derived from the code (an external constraint, a non-obvious invariant, the reason behind a non-obvious decision). Before adding one, think twice: (1) can the code itself express it — a name, a type, a structure, a validation (e.g. a zod refine with a message instead of a comment)? if yes, do that and write no comment; (2) would a reader actually get it wrong without it? if no, do not write it. "How it works" explanations and specs belong in the package README, not in the code. Strictly forbidden: comments restating the next line, "what" instead of "why", TODO plans, change history, comments justifying a change to a reviewer.
- **Logging goes only through `@labforge/logger`** (`createLogger({ service })`, `withContext` for `jobId`/`state`/`agent`). `console.*` is banned in production code (enforced by Biome). A new cross-cutting log field is added to `LogContext` first.
- zod schemas on every external boundary (API DTOs, IR, checkpoint, tool inputs).
- SDK and sandbox errors are typed (`RateLimitError`, `SandboxTimeoutError`, …), caught in the worker and mapped to states.
- Tests: golden tests for renderer-docx (fixture IR → snapshot XML) and unit tests for the resolver and the IR validator are required before merging those packages.

## Phases and acceptance criteria

**Phase 0 — preprocessing.** Script `bun run ingest <file...>` → md in `data/` (PDF, .docx and text). Skeleton `configs/` with base REQUIREMENTS.md and STYLE_GUIDE.md (stubs, the owner fills them in).
✅ An arbitrary methodology PDF converts into readable md.

**Phase 1 — core without the web.** packages/ir + resolver + sandbox + state machine + the condensed flow (Scout+Solver → Reviewer+Fixer → ReportWriter self-review) through the Agent SDK. Entry point: `bun run lab:run <path-to-task-file> --subject X --teacher Y`. Output: `jobs/<id>/` with `src/`, `report.ir.json` (resolved), `report.docx`.
✅ A real lab goes END-TO-END without the web; all values resolved; the docx opens in Word without errors; rerunning a state from a checkpoint works.

**Phase 2 — Telegram + queue.** grammY bot (whitelist by tg id), BullMQ, `ask_user` through Telegram, rate-limit pause/resume, status updates to the user.
✅ A lab dropped into Telegram reaches a finished docx in Telegram; a second lab waits in the queue; hitting a limit mid-run pauses and then auto-continues.

**Phase 3 — web preview.** TanStack Start, deep link from Telegram (JWT, 15 min), IR rendered through Paged.js (A4, margins 20/10/20/20 mm, page numbers), KaTeX, dotted-underline explanations + side panel (text: explanation + sources; code: CodeMirror + Run in the sandbox + chat on a selection), selection → per-block chat, SSE updates, a menu on generated images.
✅ The preview matches the docx page by page; clicking a number shows its cell and Run works; a user comment on a block patches the IR and the preview updates without a reload.

**Phase 4 — full cycle.** Separate reviewer/fixer subagents (the `--full-cycle` flag), defense prep agent, kb accumulation after DONE, per-agent model mixing, cloudflared.
✅ `--full-cycle` runs separate review sessions with the stop rules; after DONE a note appears in `kb/<subject>/notes.md`; `defense.md` contains all 6 sections from the spec (docs, §9).

## What NOT to do

- Do not add databases, brokers or frameworks outside the stack list.
- Do not grant agents broader `allowedTools` than `agents/*.md` declare.
- Do not generate the docx from HTML — only from the IR.
- Do not store secrets in the repo; env goes through `.env` (gitignored) + `.env.example`.
- Do not add yourself as Co-Author in commits.
