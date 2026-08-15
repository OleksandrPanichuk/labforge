# @labforge/ir

Zod-схема Report IR — єдиний source of truth звіту. Превʼю і docx рендеряться з нього
(CLAUDE.md, інваріанти 1, 2, 7; docs/labforge-architecture.md §5).

## Семантика полів, яка не видно зі схеми

- `block.style` — ключ у мапі `styles`, не інлайн-стиль.
- `image.src`, `codeRef`, `runRef` — шляхи відносно `jobs/<id>/`.
- `values[key]` — біндинг значення. Агент оголошує `{ cellRef, format? }` **без** `value`;
  `value` (відформатований рядок для вставки) і `raw` заповнює **тільки** resolver
  виконанням cells. Тому `value` опційне в схемі: до RESOLVE його нема, після — воно
  обовʼязкове, і це перевіряє валідатор (`phase: "post-resolve"`).
- `columnWidths` — частки ширини таблиці (сума = 1, перевіряється схемою).
- Інлайнові формули в v1 заборонені: формула — це завжди окремий `formulaBlock`.
- Нумерацію таблиць/рисунків/формул пише агент у `caption`; авто-нумерація — можливе
  покращення на майбутнє.

## Крос-валідація (`src/validate.ts`)

Викликається перед RESOLVE і перед BUILD. Hard fail:

1. `value-binding-missing` — `{{v:key}}` без запису в `values`.
2. `value-unresolved` — після RESOLVE у біндингу нема `value`.
3. `explanation-missing` / `explanation-unused` — `<span data-x="id">` без пояснення
   і пояснення, на яке ніхто не посилається.
4. `style-missing` — `block.style`, якого нема в `styles`.
5. `block-id-duplicate` — неунікальний `block.id`.
6. `file-missing` / `lines-out-of-range` — `image.src` чи `code-listing.file` не існує,
   або діапазон рядків виходить за межі файлу. Перевіряється лише коли передано `files`
   (`FileProbe`), інакше крок пропускається.

Warning-список на рев'ю (не hard fail — роки, номери формул і константи легітимні):

7. `raw-number` — число з ≥3 значущими цифрами або одразу після `=` у `text` поза `{{v:}}`.
8. `value-unused` — оголошений біндинг, на який не посилається жоден блок.
