# @labforge/jobs

Робоча директорія лаби і checkpoint — те, на чому тримається інваріант 5:
кожен стан стейт-машини має бути rerunnable з файлів, а не з памʼяті сесії.

```ts
const store = createJobStore("jobs");
const job = store.createJob("job_42");

job.advanceTo("SOLVE");
```

## Структура job-директорії

```
jobs/<id>/
  src/ cells/ artifacts/ runs/ context/ review/
  checkpoint.json
  report.ir.json
```

Усі директорії створюються одразу — зокрема `artifacts/`. Якщо її не створити, Docker
змонтує її сам і на частині рантаймів вона буде root-owned, а cell під uid 1000 не зможе
туди писати (див. README пакета sandbox).

## Checkpoint

Zod-схема з переліком станів із CLAUDE.md, лічильниками входжень (`cycles`) — на них
спираються стоп-правила рев'ю-циклів — і session id-ами для resume після rate limit.
Побитий або несхемний checkpoint — це `JobStoreError`, а не тихо проігнорований файл:
краще впасти, ніж почати стан із порожньої памʼяті.

## advanceTo

`advanceTo(state)` робить обидві половини інваріанта 5 одним викликом: пише checkpoint
і комітить job-директорію. Тому історія станів завжди є, і відкат до попереднього стану —
це звичайний git. Коміти йдуть під власною ідентичністю (`LabForge <labforge@localhost>`),
щоб не залежати від того, чи налаштований git на машині.
