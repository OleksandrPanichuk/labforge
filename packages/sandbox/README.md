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
| Import path | `PYTHONPATH=/job` — інакше `cells/x.py` не бачить `src/` (інваріант 3) |

`Tty` вимкнено навмисно: інакше Docker зливає stdout і stderr в один потік, і попередження
інтерпретатора ламають JSON, який resolver читає зі stdout. Кадри розбирає `demuxDockerStream`.

## Підключення до демона

`new DockerodeEngine()` шукає сокет у такому порядку: `DOCKER_HOST` (тоді все віддається
dockerode) → `LABFORGE_DOCKER_SOCKET` → `/var/run/docker.sock` → OrbStack → Docker Desktop →
Colima. Дефолт dockerode (`/var/run/docker.sock`) не працює на macOS з OrbStack чи Colima,
де цього файлу просто нема.

## Стан перевірки

Юніт-тести (31): специфікація контейнера, демультиплексування потоку, таймаут-кіл,
прибирання, мапінг помилок демона, резолв сокета — усе на фейковому engine.

Інтеграційні тести (9) на **живому демоні** (`docker.integration.test.ts`, автоматично
пропускаються, якщо сокета нема): реальний Python-cell і його stdout, розділення stderr,
ненульовий код виходу, uid 1000, заблокована мережа, read-only `/job`, записуваний
`/job/artifacts`, кіл по таймауту, відсутність залишених контейнерів.
Перевірено на OrbStack (Docker 29.4, образ `python:3.12-slim`; інший образ —
через `LABFORGE_TEST_IMAGE`).

**Каверза:** `artifacts/` має існувати на хості до запуску — інакше Docker створює його сам,
і на деяких рантаймах (Docker Desktop, Linux) він буде root-owned, а cell під uid 1000
не зможе туди писати. Job-директорії створює core, тому це його відповідальність.
