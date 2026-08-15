---
name: new-package
description: Use when adding a new workspace package or app to the monorepo — package.json/tsconfig templates, turbo pipeline, test requirements, and what NOT to add.
---

# Новий пакет у монорепо

Спершу перевір, чи місце нового коду — не існуючий пакет чи модуль apps/core
(див. скіл `nestjs-modules`). Новий пакет виправданий, коли код переюзається
кількома apps або має власний життєвий цикл тестів (як renderer-docx з golden-тестами).

## Кроки

1. Директорія: `packages/<name>/src/` (або `apps/<name>/src/` для застосунку).
2. `package.json`:

```json
{
  "name": "@labforge/<name>",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

3. `tsconfig.json`: extends `../../tsconfig.base.json`, `outDir: dist`,
   `declaration: true`, `include: ["src"]`.
4. Залежності: `cd packages/<name> && bun add <dep>`; на workspace-пакет —
   `bun add @labforge/ir@workspace:*`.
5. Turbo підхопить пакет автоматично (workspaces glob) — нічого не міняти в turbo.json,
   якщо скрипти називаються build/typecheck/test.
6. Перевір: `bun install && bun run typecheck && bun run lint`.

## Вимоги до тестів (CLAUDE.md)

- `renderer-docx`: golden-тести (fixture IR → snapshot XML) — обовʼязкові до мержа.
- `resolver`, валідатор `ir`: unit-тести — обовʼязкові до мержа.
- Тест-раннер — vitest, файли `*.test.ts` поруч із кодом.

## Чого не робити

- Не додавати нову БД/брокер/фреймворк поза стеком CLAUDE.md.
- Не створювати пакет під одну функцію — спершу шукай існуюче місце.
- Не публікувати (`private: true` завжди).
