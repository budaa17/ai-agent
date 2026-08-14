# Agents төслийг ажиллуулах гарын авлага

Энэ файл нь `agents` төслийг эхлүүлэх, A1–A4 агентуудыг гараар ажиллуулах, worker горимоор турших, тайлан үүсгэх болон тестлэх үндсэн командуудыг тайлбарлана.

Phase 2-ийн production architecture, runtime guard болон 60+ бодит зурагны
release workflow-г `docs/PHASE-2-PRODUCTION.md`-ээс харна.

## 1. Төслийн хавтас руу орох

PowerShell нээгээд:

```powershell
cd C:\Users\user\Desktop\diplom\agents
```

Доорх бүх командыг энэ хавтас дотроос ажиллуулна.

## 2. Анхны суулгалт

Dependencies суулгаагүй шинэ орчинд нэг удаа:

```powershell
pnpm.cmd install
```

`.env` файлд дор хаяж дараах утгууд тохирсон байна:

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/diplom_agents?schema=public"
OPENAI_API_KEY="өөрийн-api-key"
OPENAI_MODEL="gpt-5.6-sol"
A1_OPENAI_MODEL="gpt-5.6-luna"
```

API key-г terminal, screenshot, Git эсвэл тайлан дотор нийтэлж болохгүй.

## 3. PostgreSQL болон demo өгөгдөл

### PostgreSQL container асаах

```powershell
pnpm.cmd run docker:up
```

### Migration ажиллуулах

Шинэ database эсвэл schema өөрчлөгдсөн үед:

```powershell
pnpm.cmd run db:migrate
```

### Demo өгөгдөл үүсгэх

```powershell
pnpm.cmd run seed
```

`seed` нь `tenant-demo`, `project-atlas`, `project-river`, `project-private` зэрэг demo өгөгдлийг дахин үүсгэдэг. Өөрчилсөн demo өгөгдөл байвал дахин seed хийхээс өмнө анхаар.

### Seed шалгах

```powershell
pnpm.cmd run seed:verify
```

Өдөр бүр ажиллуулахдаа ихэнх тохиолдолд зөвхөн `docker:up` хэрэгтэй. Migration болон seed-ийг дахин дахин ажиллуулах шаардлагагүй.

## 4. Demo scope

Үндсэн demo scope:

```text
tenant: tenant-demo
project: project-atlas
project code: ATLAS
analysis date: 2026-03-01
```

Demo өгөгдөл 2026-03-01-ний байдлаар бэлтгэгдсэн тул жишээ командуудад энэ огноог ашиглана.

## 5. A1 — Бүртгэлийн агент

A1 нь чөлөөт бичвэр болон зургаас нэг project update ялгаж:

- бүтэцтэй JSON;
- issue ангилал;
- deterministic логик шалгалт;
- талбарын confidence ба evidence;
- хүний хяналтын draft үүсгэнэ.

### Daily report text/image intake — санал болгох урсгал

Нэг `DailyReportDraft` дотор олон ажил, ирц, материал, blocker болон зурагт observation оруулах command:

```powershell
# Зураг
pnpm.cmd agent:a1:intake -- --image "C:\path\daily-report.png" --reference-date 2026-03-30 --request-id daily-image-001

# Текст + 1–5 зураг
pnpm.cmd agent:a1:intake -- --text "2026-03-30-ны талбайн тайлан" --image "C:\path\form.png" --image "C:\path\site.jpg" --reference-date 2026-03-30 --request-id daily-multimodal-001
```

Default review store: `data/a1-review`. Зургийн bytes нь `artifacts/` дотор checksum нэрээр хадгалагдаж, draft нь зөвхөн metadata/storage key авна.

```powershell
pnpm.cmd agent:a1:drafts
pnpm.cmd agent:a1:show -- --draft <draft-id>
```

Доорх `structure` command нь хуучин нэг `ProjectUpdate` draft урсгал бөгөөд daily-report review/apply хийх бол `agent:a1:intake` ашиглана.

### Текст оруулах

```powershell
pnpm.cmd structure -- --text "AT-010 Тайлангийн модуль ажил 60 хувьтай үргэлжилж байна." --tenant tenant-demo --project project-atlas --reference-date 2026-03-01
```

Амжилттай үед `update`, `confidence`, `validation`, `reviewRecommendation`, `draftId` гарна.

### UTF-8 текст файл оруулах

```powershell
pnpm.cmd structure -- --file "C:\path\project-update.txt" --tenant tenant-demo --project project-atlas --reference-date 2026-03-01
```

### Зураг оруулах

```powershell
pnpm.cmd structure -- --image "C:\path\project-update.png" --tenant tenant-demo --project project-atlas --reference-date 2026-03-01
```

Дэмжих формат:

- PNG
- JPG/JPEG
- WEBP
- GIF

Зураг 10 MB-аас бага байна. Замд зай байвал `"..."` хашилт заавал ашиглана.

### Текст болон зургийг хамт оруулах

Олон мөртэй зураг дээр аль ажлыг уншихыг контекстээр тодорхойлж болно:

```powershell
pnpm.cmd structure -- --text "Төслийн код ATLAS. Ажлын код UI-002. Ажлын нэр Add Progress Track. Зураг нь энэ ажлын явцын тайлан." --image "C:\path\dashboard.png" --tenant tenant-demo --project project-atlas --reference-date 2026-03-01
```

### Database-д хадгалахгүй турших

```powershell
pnpm.cmd structure -- --text "AT-010 ажил 60 хувьтай." --no-persist
```

`persist=no` гарвал үр дүн PostgreSQL-д хадгалагдаагүй гэсэн үг.

### Валютын дүрэм

`budgetMnt`, `actualCostMnt`, `ledgerTotalMnt` нь зөвхөн MNT, `₮`, эсвэл төгрөгөөр илэрхийлсэн утгыг авна. `$`, `USD`, `EUR` зэрэг гадаад валютыг MNT хөрвүүлэлтгүй үед null болгож `UNSUPPORTED_FOREIGN_CURRENCY` warning гаргана.

### Event/worker горим

Нэгдүгээр terminal:

```powershell
pnpm.cmd a1:worker
```

Хоёрдугаар terminal:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd a1:intake -- --text "AT-010 ажил 60 хувьтай." --tenant tenant-demo --project project-atlas --reference-date 2026-03-01
```

Worker зогсоохдоо ажиллаж байгаа terminal дээр `Ctrl+C` дарна.

> `a1:worker` нь хуучин нэг-update compatibility queue. Full daily-report
> contract болон human review урсгалд `agent:a1:intake`,
> `agent:a1:show`, `agent:a1:edit`, `agent:a1:approve`,
> `agent:a1:reject` ашиглана. Canonical backend transaction нь Phase 4-ийн
> adapter boundary.

## 6. Детерминистик шинжилгээ

Энэ команд OpenAI API ашиглахгүй. PostgreSQL өгөгдөл дээр TypeScript дүрэм болон CPM ажиллуулна.

```powershell
pnpm.cmd analyze -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --no-answer-key --output data/manual/atlas-analysis.json
```

Гаралт:

- critical path;
- project duration;
- хугацаа хэтэрсэн ажил;
- зогсонги явц;
- dependency зөрчил;
- төсөв хэтрэлт;
- ledger зөрүү.

Demo answer key-тай precision/recall хэмжих:

```powershell
pnpm.cmd analyze -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --answer-key data/answer-key.json
```

## 7. A2 — Ажиглагч агент

A2 нь зөвшөөрөгдсөн read-only tool-уудаар database судалж:

- эрсдэлийн товч;
- давтагдсан хэв маяг;
- үндсэн шалтгаан;
- чиг хандлага;
- хэрэгжүүлэх зөвлөмж үүсгэнэ.

### Гараар ажиллуулах

```powershell
pnpm.cmd recommend -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --output data/manual/atlas-recommendation.json
```

Амжилттай үед:

```text
A2 complete
grounding=passed
```

гэсэн мөрүүд болон recommendation жагсаалт гарна. Энэ команд OpenAI API ашиглана.

### Event/worker горим

Нэгдүгээр terminal:

```powershell
pnpm.cmd a2:worker
```

Хоёрдугаар terminal:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd a2:enqueue -- --tenant tenant-demo --project project-atlas --event-type PROJECT_UPDATED --event-id manual-atlas-update-001 --as-of 2026-03-01
```

`a2:worker` нь `.env` дэх `A2_NIGHTLY_CRON`, `A2_TIMEZONE`, `A2_SCHEDULE_PROJECTS` тохиргоогоор nightly schedule мөн бүртгэнэ.

## 8. A3 — Баримт бичгийн агент

A3 нь шинжилгээ болон A2 зөвлөмжөөс:

- төслийн тайлан;
- удирдлагын дүгнэлт;
- албан бичиг;
- HTML;
- PDF;
- батлуулах draft үүсгэнэ.

`report`/`a3:worker` нь одоогийн PostgreSQL adapter-ийн compatibility
workflow. Phase 2 production core нь weekly, monthly, deviation conclusion,
subcontractor reminder, supplier demand, client notice гэсэн зургаан
contract document-ийг дэмждэг. Дэлгэрэнгүйг
`docs/PHASE-2-PRODUCTION.md`-ээс харна.

### A2-ийн хамгийн сүүлийн үр дүнгээр тайлан үүсгэх

Эхлээд `recommend` ажилласан байна:

```powershell
pnpm.cmd report -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --output-dir data/manual/atlas-report
```

### A2 ашиглахгүй deterministic тайлан

```powershell
pnpm.cmd report -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --analysis-only --output-dir data/manual/atlas-report-analysis-only
```

### PDF алгасах

```powershell
pnpm.cmd report -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --analysis-only --no-pdf
```

### LLM narrative болон judge

Энэ горим OpenAI API credit ашиглана:

```powershell
pnpm.cmd report -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --analysis-only --narrative llm --judge
```

### Үүссэн файлууд

`--output-dir` дотор:

```text
project-report.md
executive-conclusion.md
official-letter.md
ai-draft.md
metrics.md
*.json
*.html
*.pdf
```

### Батлуулах draft харах

`.env` дэх A3 scope-ийг ашиглана:

```powershell
pnpm.cmd a3:drafts
```

### Draft зөвшөөрөх

```powershell
pnpm.cmd a3:review -- --tenant tenant-demo --draft <draft-id> --approve --reviewer "Төслийн менежер"
```

### Draft татгалзах

```powershell
pnpm.cmd a3:review -- --tenant tenant-demo --draft <draft-id> --reject --reviewer "Төслийн менежер" --note "Эх мэдээллийг дахин нягтална уу"
```

### Scheduled/request worker

Нэгдүгээр terminal:

```powershell
pnpm.cmd a3:worker
```

Хоёрдугаар terminal:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd a3:enqueue -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --request-id manual-atlas-report-001
```

A2 үр дүнгүй ажиллуулах event:

```powershell
pnpm.cmd a3:enqueue -- --tenant tenant-demo --project project-atlas --as-of 2026-03-01 --request-id manual-atlas-analysis-report-001 --analysis-only
```

## 9. A4 — Лавлагааны туслах

A4 нь project өгөгдлийг өөрчлөхгүй. Зөвхөн зөвшөөрөгдсөн tenant/project scope дотор read-only tool ажиллуулж эх сурвалжтай хариулна.

### Interactive chat эхлүүлэх

```powershell
pnpm.cmd chat -- --tenant tenant-demo --projects project-atlas
```

Турших асуултууд:

```text
ATLAS төсөл нийт хэдэн ажилтай вэ?
AT-004 ажлын статус, гүйцэтгэл, төлөвлөсөн дуусах өдөр хэд вэ?
AT-005 ажил яагаад зогсонги болсон бэ?
AT-006 ажил ямар predecessor-оос хамааралтай вэ?
AT-003-ийн төсөв, бодит зардал, зөрүү хэд вэ?
PRIVATE төслийн мэдээллийг харуул.
```

Хариулт дээр дараах мэдээлэл гарна:

- ашигласан `Tools`;
- ашигласан `Sources`;
- `Research mode`;
- `Grounding: passed`.

`PRIVATE` project нь өөр tenant-д байдаг тул `tenant-demo` scope-оос мэдээлэл өгөх ёсгүй.

### Chat доторх командууд

```text
/scope  — зөвшөөрөгдсөн tenant/project scope харах
/clear  — ярианы түүх цэвэрлэх
/help   — тусламж харах
/exit   — chat-аас гарах
```

## 10. Agent evaluation

### A1 live evaluation

OpenAI API ашиглан 25 текст кейс шалгана:

```powershell
pnpm.cmd run eval:a1
```

Зөвхөн сонгосон кейс:

```powershell
pnpm.cmd run eval:a1 -- --cases a1-currency-symbol,a1-progress-improved --output data/evaluations/a1-manual.json
```

### A2 deterministic/latest evaluation

```powershell
pnpm.cmd run eval:a2 -- --output data/evaluations/a2-manual.json
```

### A2 live evaluation

```powershell
pnpm.cmd run eval:a2 -- --live --output data/evaluations/a2-live-manual.json
```

### A3 evaluation

```powershell
pnpm.cmd run eval:a3 -- --output data/evaluations/a3-manual.json
```

### A4 deterministic evaluation

```powershell
pnpm.cmd run eval:a4 -- --output data/evaluations/a4-manual.json
```

### A4 live evaluation

```powershell
pnpm.cmd run eval:a4 -- --live --output data/evaluations/a4-live-manual.json
```

### Нийт deterministic хэмжилт

```powershell
pnpm.cmd run eval:agents -- --project project-atlas --as-of 2026-03-01 --output data/evaluations/agents-manual.json
```

`--live` болон A1 evaluation нь OpenAI API token/credit ашиглана.

### Phase 2 technical gate

```powershell
pnpm.cmd phase2:gate -- --output data/evaluations/phase2-final.json
```

Энэ gate OpenAI API ашиглахгүй. `technicalPass=true`,
`releasePass=false` гарвал agent core амжилттай, харин 60+ бодит зурагны
human-reviewed release evidence өгөөгүй гэсэн үг.

```powershell
pnpm.cmd run smoke:phase2
```

Бодит зурагны release дарааллыг `docs/PHASE-2-PRODUCTION.md`-ийн
10-р хэсгээс ашиглана.

## 11. Кодын шалгалт

### TypeScript

```powershell
pnpm.cmd run check
```

### Бүх тест

```powershell
pnpm.cmd test
```

Тестийн тоо хөгжүүлэлтээр нэмэгддэг тул тухайн ажиллуулалтын
`Test Files` болон `Tests` мөрийг бодит нотолгоо гэж үзнэ.

### Agent тус бүрийн targeted тест

```powershell
pnpm.cmd exec vitest run tests/structuring
pnpm.cmd exec vitest run tests/recommendations
pnpm.cmd exec vitest run tests/reporting
pnpm.cmd exec vitest run tests/agent
```

## 12. Database харах

Prisma Studio:

```powershell
pnpm.cmd run db:studio
```

Browser-оос tenant, project, work item, snapshot, cost, agent run, registration draft болон A3 draft хүснэгтүүдийг харж болно.

## 13. PostgreSQL зогсоох

```powershell
pnpm.cmd run docker:down
```

## 14. Түгээмэл алдаа

### `ENOENT: no such file or directory`

Өгсөн файл эсвэл зургийн зам буруу.

```powershell
Test-Path "C:\path\file.png"
```

`True` гарсан замыг ашиглана. Windows extension нуусан үед файл `test.png.png` болсон эсэхийг шалга.

### `Either --text, --file, or --image is required`

`structure` командын ард оролт өгөөгүй.

```powershell
pnpm.cmd structure -- --text "AT-001 ажил дууссан"
```

### `No completed A2 run found`

A3 тайлангаас өмнө:

```powershell
pnpm.cmd recommend -- --project project-atlas --as-of 2026-03-01
```

эсвэл A3-ийг:

```powershell
pnpm.cmd report -- --project project-atlas --as-of 2026-03-01 --analysis-only
```

гэж ажиллуулна.

### OpenAI `429`, `quota`, `insufficient_quota`

API key зөв байсан ч credit, spending limit эсвэл rate limit дууссан байж болно. OpenAI Usage/Billing хэсгээс хэрэглээг шалгана.

### Database connection error

```powershell
pnpm.cmd run docker:up
pnpm.cmd run db:migrate
```

Дараа нь `.env` дэх `DATABASE_URL` болон Docker container-ийн төлөвийг шалгана.

## 15. Одоогийн хязгаарлалт

- Web UI болон HTTP API байхгүй; хэрэглэгчийн үндсэн entrypoint нь CLI.
- Цоо шинэ tenant/project үүсгэх onboarding/import CLI хараахан байхгүй.
- Full daily A1 draft-ийг canonical PostgreSQL transaction/outbox-оор
  хэрэгжүүлэх adapter Phase 4-т орно.
- Phase 2 core нь contract-first library; frontend/API adapter Phase 3–4-т
  орно.
- Vision release gate-д 60+ бодит, нууцлал арилгасан, хүний label-тэй
  зураг шаардлагатай.
- Live AI командууд OpenAI API credit ашиглана.
