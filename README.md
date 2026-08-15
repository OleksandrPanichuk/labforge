# LabForge

Система автоматизації лабораторних робіт: файл лаби → агентний цикл (Claude Agent SDK) →
код + Report IR → HTML-превʼю → рев'ю людиною → docx + підготовка до захисту.

- Архітектура: [docs/labforge-architecture.md](docs/labforge-architecture.md)
- Правила для агентів і людей: [CLAUDE.md](CLAUDE.md)
- Промпти сабагентів: [agents/](agents/) (довідка: [docs/agent-prompts.md](docs/agent-prompts.md))

## Швидкий старт

```bash
docker compose up -d      # postgres + redis
cp .env.example .env      # заповнити секрети
bun install
bun run build
bun run lint
```

## Структура

| Шлях | Що це |
|---|---|
| `apps/core` | NestJS: стейт-машина, worker, SDK-оркестрація, API, SSE |
| `apps/web` | TanStack Start: чат + превʼю (Фаза 3) |
| `apps/tg-bot` | grammY-бот (Фаза 2) |
| `packages/ir` | zod-схема Report IR |
| `packages/resolver` | виконання cells, підстановка values |
| `packages/renderer-docx` | IR → .docx |
| `packages/sandbox` | dockerode-обгортка, `run_in_sandbox` |
| `agents/` | промпти сабагентів |
| `configs/` | REQUIREMENTS.md / STYLE_GUIDE.md ієрархія |
