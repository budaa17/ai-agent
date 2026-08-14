# A4 — Лавлагааны туслах

## Зорилго

A4 нь зөвшөөрөгдсөн tenant болон project-ийн өгөгдлөөс асуултаар лавлагаа авч, **зөвхөн унших** ажиллагаа хийдэг CLI чат агент. Хариултын claim бүр яг ашигласан tool, entity ID, field-тэй холбогдоно.

A4 өгөгдөл үүсгэх, засах, устгахгүй. Түүний tool багцад зөвхөн `SELECT` төрлийн Prisma query ашигладаг Part 2-ын цөм функцүүд орсон.

## Одоо юу чаддаг вэ?

- Ажлын төлөв, явц, хуваарь, priority, төсөв, бодит зардлыг лавлана.
- Өмнөх/дараах ажлын хамаарал болон төлөвийг шалгана.
- Явцын snapshot-ууд, өөрчлөлт, зогсонги хоногийг харна.
- Төсөв, бүртгэсэн бодит зардал, ledger нийлбэр, зөрүүг тулгана.
- Tenant болон project authorization scope-оос гадуур мөр буцаахгүй.
- Хариултыг claim болгон задалж, claim бүрт source reference хавсаргана.
- Source ID, field, тоо, огноо, төлөв зохиосон бол хариултыг хэрэглэгчид өгөхөөс өмнө татгалзана.
- AI SDK дуудалтыг Langfuse/OpenTelemetry-р trace хийх боломжтой.
- 6 golden case-аар tool сонголт, source coverage, grounding, tenant isolation-ийг хэмжинэ.

## Ажиллах урсгал

1. Хэрэглэгч `pnpm.cmd chat` ажиллуулж асуулт оруулна.
2. CLI нь `.env`-ээс OpenAI model болон authorization scope-ийг уншина.
3. `runProjectChat` эхний research фазад `generateText + tools` ашиглана.
4. Research фазын эхний алхамд model тохирох A4 read-only tool-ийг сонгоно. Provider `toolChoice`-ийг үл хэрэгсвэл deterministic intent router яг ижил read-only core tool-ийг fallback байдлаар ажиллуулна.
5. Tool нь `ToolContext = { tenantId, projectIds }` scope-ийг цөм функц дотор шалгаад PostgreSQL-оос өгөгдөл уншина.
6. Хоёр дахь answer фаз tool evidence-ийг `Output.object + A4Answer` schema-аар claim болон source reference болгон бүтэцлэнэ.
7. Pure TypeScript grounding validator source бүрийг research tool-ийн бодит гаралттай тулгана. Claim доторх тоо, ISO огноо, status/dependency enum бүр тухайн claim-ийн source-д байх ёстой.
8. Шалгалт амжилттай бол CLI хариулт, ашигласан tool, research mode, resolve хийсэн exact source value, grounding төлөвийг хэвлэнэ. Source шалгалт унавал `A4GroundingError` гарч хариулт нийтлэгдэхгүй.

## A4-ийн тусдаа tool багц

| Tool                    | Ашигладаг цөм функц      | Унших мэдээлэл                    |
| ----------------------- | ------------------------ | --------------------------------- |
| `lookupWorkItems`       | `getWorkItemsCore`       | Ажил, төлөв, явц, огноо, төсөв    |
| `lookupDependencies`    | `getDependenciesCore`    | Predecessor/successor хамаарал    |
| `lookupProgressHistory` | `getProgressHistoryCore` | Snapshot, delta, зогсонги хугацаа |
| `lookupCostLedger`      | `getCostLedgerCore`      | Budget, actual, ledger, variance  |

Эдгээр wrapper нь `src/agent/tools.ts` дотор зөвхөн A4-д зориулагдсан нэр, description, tool context-тэй. A2 өөрийн `inspect...` tool багцтай тул agent-уудын prompt болон tool сонголт хоорондоо холилдохгүй.

## Source contract

Model source value зохиож бичдэггүй. Харин дараах reference-ийг буцаана:

```json
{
  "toolName": "lookupWorkItems",
  "sourceId": "wi-atlas-procurement",
  "field": "progressPercent"
}
```

Validator tool-ийн бодит гаралтаас үүнийг дараах exact fact болгон resolve хийнэ:

```json
{
  "toolName": "lookupWorkItems",
  "sourceType": "WORK_ITEM",
  "sourceId": "wi-atlas-procurement",
  "field": "progressPercent",
  "value": 75
}
```

Aggregate source ID нь `<toolName>:aggregate` хэлбэртэй. Жишээлбэл ажлын нийт тоо:

```text
lookupWorkItems:aggregate | total=9
```

## Ажиллуулах

PostgreSQL container, migration, seed бэлэн үед:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd chat
```

Тусгай scope заах:

```powershell
pnpm.cmd chat -- --tenant tenant-demo --projects project-atlas
```

Чат дотор:

```text
/scope  — идэвхтэй tenant/project scope
/clear  — ярианы түүх цэвэрлэх
/help   — тусламж
/exit   — гарах, telemetry flush хийх
```

`pnpm.cmd chat` нь бодит OpenAI API ашиглана. Асуулт болон model-д хэрэгтэй authorized tool results OpenAI руу дамжина. `--record-telemetry-content` сонголтыг зориуд өгсөн үед л prompt/output content Langfuse-д хадгалагдана.

## API ашиглахгүй тестлэх

Targeted unit/integration тест:

```powershell
pnpm.cmd exec vitest run tests/agent
```

6 golden case-ийн deterministic үнэлгээ:

```powershell
pnpm.cmd run seed:a4-eval
pnpm.cmd run eval:a4
```

Энэ горим OpenAI API ашиглахгүй. PostgreSQL, A4 tool, source catalog, validator, evaluator-ийг шалгаад дараах тайлан үүсгэнэ:

```text
data/evaluations/a4-latest.json
data/evaluations/a4-latest.md
```

Бодит model-оор golden evaluation хийх:

```powershell
pnpm.cmd run eval:a4 -- --live
```

`--live` нь deterministic read-only router-оор tool-оо локал ажиллуулаад, source-backed answer үүсгэх нэг OpenAI call хийнэ. Ингэснээр provider native tool-call-ийг дэмжих эсэхээс хамаарахгүй, quota-г давхар зарцуулахгүй. Golden асуулт болон authorized source facts OpenAI руу илгээгдэнэ.

## Golden dataset

`a4-reference-assistant-v1` suite дараах 6 чадварыг хамарна:

1. ATLAS ажлын aggregate тоо.
2. AT-004 төлөв, явц, төлөвлөсөн огноо.
3. AT-005 → AT-006 dependency.
4. AT-005 progress history болон зогсонги хоног.
5. AT-003 төсөв, бодит зардал, variance.
6. PRIVATE tenant isolation.

Evaluator дараах хэмжүүр гаргана:

- Case pass rate.
- Grounding rate.
- Field accuracy.
- Tool precision/recall.
- Source precision/recall.
- Forbidden tenant source ашиглаагүй эсэх.

## Гол файлууд

- `src/agent/chat.ts` — AI SDK research tool loop, answer prompt, structured output.
- `src/agent/tools.ts` — A4-ийн read-only tool багц.
- `src/agent/schema.ts` — answer, claim, source reference schema.
- `src/agent/grounding.ts` — source catalog болон hallucination validator.
- `src/agent/research.ts` — provider fallback intent routing болон read-only execution.
- `src/agent/golden-cases.ts` — 6 golden case.
- `src/agent/evaluator.ts` — A4 хэмжилтийн логик.
- `src/scripts/chat.ts` — interactive CLI.
- `src/scripts/evaluate-a4.ts` — deterministic болон optional live evaluator.
- `tests/agent` — authorization, tool, chat, schema, grounding, golden, evaluator тестүүд.

## Хязгаарлалт

- UI болон HTTP server байхгүй; энэ үе шатанд CLI зориуд ашиглаж байна.
- A4 зөвхөн structured PostgreSQL data-г SQL tool-оор лавлана; vector DB/RAG ашиглах шаардлагагүй.
- “Яагаад” гэсэн үндсэн шалтгааны гүн шинжилгээ, зөвлөмж нь A2-ын үүрэг.
- Тайлан, албан бичиг үүсгэх нь A3-ын үүрэг.
- Source-гүй эсвэл grounding шалгалт унасан model output хэрэглэгчид амжилттай хариулт болж гарахгүй.
