# Sandbox images

Один образ на мову лаби. Агент образ **не обирає** — його дає runtime-профіль
(`packages/sandbox/src/runtime.ts`) за мовою лаби, і він же знає, як запустити cell
і як дотягтись до `src/`.

```bash
bun run images:build          # зібрати всі
docker build -f docker/lab-python.Dockerfile -t lab-python .
```

| Образ | Для чого | Як cell дістає `src/` |
|---|---|---|
| `lab-python` | numpy, scipy, matplotlib, pandas, sympy | `PYTHONPATH=/job` |
| `lab-node` | JS/TS-лаби | `NODE_PATH=/job` |
| `lab-cpp` | gcc 14, C++20 | `-I /job`, бінарник у `/build` |
| `lab-java` | JDK 21 | `-cp /job:/build`, класи у `/build` |

Усі образи працюють під uid 1000 і без мережі (інваріант 6). Компільовані мови пишуть
у `/build` — окремий writable-маунт, бо `/job` змонтований read-only і об'єктним файлам
там не місце.
