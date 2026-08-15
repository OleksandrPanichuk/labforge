# @labforge/pipeline

Детермінована половина стейт-машини одним викликом: `RESOLVE → BUILD`.
Тут нема LLM — усе, що робить цей пакет, відтворюване і перевіряється тестами.

```ts
const result = await buildReport({
  job,
  cells: { run: (cellRef) => runInSandbox({ image, cmd: ["python", cellRef], jobDir: job.dir }, engine) },
});
```

## Що відбувається

1. **read** — `report.ir.json` з job-директорії, розбір zod-схемою.
2. **validate** — крос-валідація до resolve: плейсхолдер без біндингу, пояснення без
   `data-x`, невідомий стиль, дублікат `block.id` — усе це блокери ще до запуску коду.
3. **resolve** — cells виконуються через порт `CellRunner` (за ним sandbox), значення
   форматуються і підставляються.
4. **verify** — валідація після resolve, уже з доступом до диска: незаповнене значення,
   відсутній `artifacts/*.png`, діапазон рядків поза межами файлу.
5. **render** — `report.docx` поруч із IR.

Логи запусків пишуться в `runs/` — це provenance, на яку посилається `values[key].runRef`.

## Помилки

`BuildError` несе `stage` (`read | validate | resolve | verify | render`), щоб стейт-машина
знала, куди повертатись: `resolve` з `cell-failed` — це FIX по коду, а `validate` — це
помилка report-writer і привід іти в IR_FIX. Попередження (`raw-number`, `value-unused`)
повертаються у `warnings` і не зупиняють збірку — саме так їх описує інваріант 1.

Якщо збірка впала, `report.ir.json` лишається таким, яким був: часткового резолву на диску
не буває.
