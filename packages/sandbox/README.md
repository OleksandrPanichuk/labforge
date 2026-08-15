# @labforge/sandbox

Обгортка над dockerode, що стоїть за custom tool `run_in_sandbox`. Агенти не мають
прямого доступу до Docker — тільки через цей тул (CLAUDE.md, інваріант 6).
Реалізація — Фаза 1.

Жорсткі ліміти запуску: `--network none` (мережа — лише явним прапорцем на job),
memory 1g, cpus 1, pids 256, timeout 120 s, non-root, job-директорія read-only +
writable `artifacts/`, tmpfs для `/tmp`.
