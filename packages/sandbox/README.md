# @labforge/sandbox

Обгортка над dockerode, що стоїть за custom tool `run_in_sandbox`. Агенти не мають
прямого доступу до Docker — тільки через цей тул (CLAUDE.md, інваріант 6).

```ts
const engine = new DockerodeEngine();
const result = await runInSandbox(
  { image: "lab-python", cmd: ["python", "cells/errors.py"], jobDir: "/abs/jobs/job_1" },
  engine,
);
```

`runInSandbox` повертає `{ exitCode, stdout, stderr, durationMs }`. Ненульовий exit —
це результат, а не виняток: рішення приймає викликач (resolver). Виняток кидається лише
на таймаут (`SandboxTimeoutError`) і на недоступність демона (`DockerUnavailableError`).

## Ліміти (`LIMITS`, інваріант 6)

| Параметр | Значення |
|---|---|
| Мережа | `none`; `bridge` тільки з `network: true` на конкретному запуску |
| Памʼять / CPU / PIDs | 1 GiB / 1 CPU / 256 |
| Таймаут | 120 с (перекривається `timeoutMs`) |
| Користувач | `1000:1000`, `CapDrop: ALL`, `no-new-privileges` |
| Монтування | `<jobDir>:/job:ro` + `<jobDir>/artifacts:/job/artifacts:rw` |
| Scratch | tmpfs `/tmp` (64 MB); `HOME`, `MPLCONFIGDIR` вказують туди ж |

`Tty` вимкнено навмисно: інакше Docker зливає stdout і stderr в один потік, і попередження
інтерпретатора ламають JSON, який resolver читає зі stdout. Кадри розбирає `demuxDockerStream`.

## Стан перевірки

Юніт-тести покривають побудову специфікації, демультиплексування потоку, таймаут-кіл,
прибирання контейнера і мапінг помилок демона (26 тестів, фейковий engine).
**Інтеграційної перевірки на живому Docker ще не було** — її треба зробити першим
кроком, коли демон буде піднято: реальний `lab-python`-образ, реальний cell, звірка
stdout/stderr і таймауту.
