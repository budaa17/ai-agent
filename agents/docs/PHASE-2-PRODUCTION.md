# Phase 2 — AI agent production гарын авлага

## 1. Төлөв

Phase 2-ийн agent core, safety contract, deterministic fallback, evaluation,
runtime hardening болон worker packaging хэрэгжсэн.

Хоёр өөр gate байна:

| Gate           | Төлөв                                                                    | Утга                                              |
| -------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| Technical gate | Код, schema, deterministic evaluation, build/test-ээр шалгана            | Frontend/backend-ээс хамаарахгүй agent core бэлэн |
| Release gate   | 60-аас доошгүй бодит, нууцлал арилгасан, хүний label-тэй зургаар шалгана | Бодит талбайн vision чанарыг хүн баталгаажуулсан  |

`pnpm.cmd phase2:gate` нь technical gate-ийг шалгана. Бодит зурагны
manifest өгөөгүй үед `technicalPass=true`, `releasePass=false` байх нь
алдаа биш. Release gate-д зориуд хүний баримт шаардаж байгаа гэсэн үг.

## 2. Архитектурын хил

Phase 2 нь HTTP API, web UI эсвэл production identity system хийхгүй.
Agent бүр version-тэй contract-аар ажиллах цэвэр core/library байна:

```text
Phase 3 frontend
       ↓ shared v1 contract
Phase 4 authorized backend adapter
       ↓ snapshot/repository/queue port
Phase 2 A1–A4 agent core
       ↓ draft + evidence + provenance
Human review / approved backend command
```

AI draft нь canonical project data-г шууд өөрчлөхгүй. Өөрчлөлт зөвхөн
хүний хяналт, зөвшөөрөл болон Phase 4-ийн authorized transaction boundary-г
давсны дараа хийгдэнэ.

## 3. A1 — Бүртгэлийн агент

### Оролт

- Монгол, англи эсвэл холимог чөлөөт бичвэр;
- 1–5 PNG/JPEG/WebP/GIF зураг;
- text + image;
- tenant, project, reference date, request ID.

### Гаралт

`DailyReportDraftV1`:

- олон `progressEntries`;
- quantity, unit, status, progress;
- attendance/headcount/hours;
- material receipt/issue/consumption signal;
- blocker ба blocker taxonomy;
- location, block, stage, report date;
- photo observation;
- field-level confidence;
- exact text/image evidence;
- clarification question;
- validation issue;
- duplicate suspicion;
- `requiresHumanReview=true`.

### Vision safety

- MIME, magic byte, dimension, pixel, side, frame шалгана;
- EXIF auto-orient, resize, compression, metadata stripping хийнэ;
- normalized bytes болон checksum л model/storage руу явна;
- malware scanner port-оор clean болсон зураг л орно;
- зураг нь нотолгооны дохио болохоос automatic alert эсвэл safety
  шийдвэр үүсгэхгүй;
- image-only numeric progress нь visible region evidence-гүй бол
  зөвшөөрөгдөхгүй;
- unreadable зураг баримт зохиохгүй;
- foreign currency-г MNT болгон дур мэдэн хөрвүүлэхгүй.

### AI-7

- blocker taxonomy + confidence;
- tenant terminology dictionary;
- material alias normalization;
- duplicate similarity;
- cross-domain consistency;
- normalization provenance;
- low-confidence үед заавал human review.

### Гол interface

```ts
extractDailyReportDraft(...)
finalizeDailyReportDraft(...)
loadProjectUpdateImage(...)
```

## 4. A2 — Ажиглагч агент

A2 дараах зургаан алхмыг салгаж ажиллана:

1. Scope determination — deterministic.
2. Metrics, rule, forecast — deterministic.
3. Context assembly — deterministic.
4. Pattern/root-cause/options narrative — optional OpenAI gateway.
5. Schema, number, source grounding — deterministic.
6. `PENDING_REVIEW` draft — human decision queue.

`RecommendationDraftV1` нь:

- observation kind, severity, priority;
- affected work item;
- root-cause group;
- exact source refs;
- action options;
- deterministic `estimatedImpactDays`;
- required resources;
- risks ба dependency conflict;
- feasibility/data sufficiency;
- confidence;
- `PENDING_REVIEW` status агуулна.

Context memory-д recent/closed alert, өмнөх recommendation, manager
decision/reason, repeated blocker, terminology, weekly/monthly context болон
data freshness орно.

Trigger:

- manual;
- approved execution event;
- nightly cron;
- tenant timezone;
- dynamic active project list;
- event idempotency;
- downtime catch-up.

OpenAI unavailable үед deterministic analysis алга болохгүй. Draft нь
`AI_UNAVAILABLE` төлөвтэй үлдэж, queue retry/dead-letter/replay ажиллана.

Гол interface:

```ts
runProductionA2(...)
buildProductionRecommendationDrafts(...)
```

## 5. A3 — Баримт бичгийн агент

Production core зургаан төрлийн draft үүсгэнэ:

1. weekly report;
2. monthly report;
3. deviation conclusion;
4. subcontractor reminder;
5. supplier demand;
6. client notice.

Period, completed work, plan-vs-actual, delay, material, attendance,
productivity, cost, alert, forecast, next plan зэрэг тоон баримтыг
deterministic fact ledger-ээс авна. OpenAI gateway нь зөвхөн qualitative
narrative баяжуулж болно. Number guard болон prohibited-claim guard зөрчвөл
deterministic хувилбар руу fallback хийнэ.

Artifact:

- Markdown;
- safe escaped HTML;
- Puppeteer PDF;
- content hash;
- relative storage key;
- malware scan;
- retention metadata;
- `ArtifactStore` port.

Review:

- AI draft;
- edited final;
- diff ба edit distance;
- edit category;
- reviewer/time/reason;
- immutable approved checksum.

Гол interface:

```ts
runProductionA3(...)
persistRenderedA3DocumentArtifacts(...)
renderA3DocumentHtml(...)
```

## 6. A4 — Лавлагааны туслах

A4 нь зөвхөн read-only:

- 11/11 production tool intent routing;
- multi-tool question;
- aggregate ба sample ялгалт;
- `asOf` огноо;
- tenant/project authorization;
- exact source/value/date claim;
- no-data болон insufficient-evidence output;
- prompt injection болон stored instruction-ийг data гэж үзэх;
- cross-tenant leakage хамгаалалт.

Deterministic policy:

| Хүсэлт                      | Үр дүн                     |
| --------------------------- | -------------------------- |
| Read-only project question  | Authorized tool research   |
| Write/update/delete/raw SQL | `REFUSED_WRITE_ACTION`     |
| Report/official document    | `REDIRECT_REPORT_WORKFLOW` |
| Unknown/no evidence         | `INSUFFICIENT_EVIDENCE`    |

Гол interface:

```ts
askProductionA4(...)
routeA4Question(...)
```

## 7. Runtime ба operations

Phase 2 runtime дараах хамгаалалттай:

- strict Zod v1 schema;
- source/number/entity/date/status validation;
- prompt/tool allow-list;
- input/output token limit;
- per-run болон per-tenant monthly cost cap;
- model timeout;
- bounded exponential retry;
- provider/model circuit breaker;
- PostgreSQL atomic budget reservation;
- structured JSON log;
- content болон secret redaction;
- OpenTelemetry/Langfuse;
- optional Sentry;
- retry/dead-letter/replay;
- configurable concurrency/heartbeat;
- graceful shutdown;
- production seed guard;
- liveness/readiness command;
- non-root, read-only Docker worker;
- immutable artifact checksum/retention;
- prompt/model/tool/schema/snapshot/usage metadata.

Host Chromium sandbox default-аар идэвхтэй. Docker Desktop-ийн namespace
хязгаарлалтаас шалтгаалан зөвхөн container image-д
`PUPPETEER_DISABLE_SANDBOX=true` тохируулсан; container нь non-root,
read-only, no-new-privileges бөгөөд A3 зөвхөн escaped internal HTML render
хийнэ.

Production үед model price `0` байвал A1/A2 worker fail-fast хийнэ. Энэ нь
cost cap-ийг худал “идэвхтэй” гэж үзэхээс хамгаална.

## 8. Evaluation coverage

Technical gate дараах deterministic suite-ийг шалгана:

- A1 text contract: 120 balanced case;
- A1 synthetic vision contract: 64 case;
- A2: 30-аас дээш 12-week scenario;
- A3: 20-оос дээш document bundle;
- A4: 80-аас дээш question, 11 tool;
- LLM-off fallback;
- tenant leakage;
- unsupported claim;
- source precision/recall;
- early detection;
- actual progress эхэлсэн, pace тооцох өгөгдөлтэй forecast-ийн
  accuracy: 30+ sample, MAE/P90/max тус бүр 7 calendar day-аас ихгүй;
- `INSUFFICIENT_DATA` болон эхлээгүй ажлыг accuracy score-д
  оруулахгүй, харин excluded count-оор ил тод тайлагнана;
- false accusation.

Release vision gate:

- 60+ давтагдаагүй бодит зураг;
- 8 scene family бүгд;
- clear, blurred, night, angle, occluded, low-contrast, multi-object,
  distant difficulty бүгд;
- хүний label;
- contradiction case-д declared `sourceText`;
- visible-region evidence;
- precision ≥ 0.90;
- recall ≥ 0.85;
- false accusation = 0;
- missing visible region = 0.

## 9. Technical gate ажиллуулах

Node.js 22 ашиглана:

```powershell
node --version
```

Дараа нь:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd run docker:up
pnpm.cmd run db:migrate:deploy
pnpm.cmd run db:generate
pnpm.cmd run check
pnpm.cmd run build
pnpm.cmd test
pnpm.cmd phase2:gate -- --output data/evaluations/phase2-final.json
pnpm.cmd run health
pnpm.cmd run health:ready
```

Нэгтгэсэн smoke:

```powershell
pnpm.cmd run smoke:phase2
```

`phase2:gate` OpenAI API ашиглахгүй.

## 10. 60+ бодит зурагны release gate

### 10.1 Dataset бэлтгэх

Зургуудаас хүний нүүр, утас, имэйл, гэрээний нууц мэдээлэл, GPS болон
танигдах metadata-г арилгана. Зураг цуглуулах зөвшөөрлийг data owner-оос
баталгаажуулна.

```powershell
pnpm.cmd phase2:images:init -- `
  --directory "C:\path\anonymized-construction-images" `
  --output "data\evaluations\a1-real-images.workspace.json" `
  --reviewer "reviewer-id" `
  --dataset-id "a1-real-images-v1" `
  --anonymized `
  --consent-confirmed
```

Энэ команд зураг бүрийг safety/preprocessing pipeline-аар оруулж, checksum
давхардлыг хасна. 60-аас цөөн unique зураг байвал нэмж цуглуулна.

### 10.2 Human label хийх

Workspace JSON-ийн case бүрт:

- `sceneFamily`;
- `difficulty`;
- `expectedKinds`;
- `requireVisibleRegionEvidence`;
- `humanReviewed=true`;
- шаардлагатай тайлбар;
- `CONTRADICTION` case-д `sourceText`;

бөглөнө. Дээд түвшний `reviewedAt`-д timezone-тэй ISO datetime оруулна.

### 10.3 OpenAI prediction ажиллуулах

```powershell
pnpm.cmd phase2:images:predict -- `
  --workspace "data\evaluations\a1-real-images.workspace.json" `
  --output "data\evaluations\a1-real-images.manifest.json" `
  --delay-ms 500
```

Энэ алхам OpenAI API quota/credit ашиглана. Case бүрийн дараа
`.progress.json` checkpoint үүсэх тул тасарсан командыг яг адил аргументаар
дахин ажиллуулахад дууссан case-үүдийг алгасана. Human label өөрчлөгдсөн бол
нягтлаад `--fresh` хэрэглэнэ.

### 10.4 Release gate

```powershell
pnpm.cmd phase2:release-gate -- `
  --real-image-manifest "data\evaluations\a1-real-images.manifest.json" `
  --output "data\evaluations\phase2-release-final.json"
```

`releasePass=true` гарсны дараа Phase 2 release evidence бүрэн болно.

## 11. Docker worker

Эхлээд migration-аа host-оос ажиллуулна:

```powershell
pnpm.cmd run docker:up
pnpm.cmd run db:migrate:deploy
```

Дараа нь хүссэн worker-ээ тусгай profile-оор асаана:

```powershell
docker --config .docker compose --profile agents up -d --build a1-worker
docker --config .docker compose --profile agents up -d --build a2-worker
docker --config .docker compose --profile agents up -d --build a3-worker
```

Төлөв:

```powershell
docker --config .docker compose ps
docker --config .docker compose logs --tail 100 a2-worker
```

Зогсоох:

```powershell
docker --config .docker compose --profile agents stop a1-worker a2-worker a3-worker
```

`pnpm.cmd run docker:up` дангаараа agent worker асаахгүй.

## 12. Таны хийх шаардлагатай зүйл

Phase 2 core code-оос үлдсэн хөгжүүлэлт биш, бодит release/deployment
evidence-д дараах зүйлс танай талаас хэрэгтэй:

1. Host development-д Node.js 22 ашиглах. Node 24 дээр engine warning гарна.
2. `.env` дэх OpenAI key-г нууц хэвээр хадгалах; чат эсвэл Git-д оруулахгүй.
3. Тохируулсан model-уудын тухайн үеийн албан ёсны хамгийн өндөр
   input/output тарифыг micro-USD хэлбэрээр runtime cost env-д оруулах.
4. 60-аас доошгүй нууцлал арилгасан бодит барилгын зураг болон data-owner
   consent өгөх.
5. Тэр dataset-ийг domain мэдлэгтэй хүнээр label/review хийлгэх.
6. Production deployment хийх үед Sentry/Langfuse, secret manager,
   cloud object storage, backup/alerting infrastructure-г байгууллагын
   орчноор тохируулах.

3–5 дугаар ажил хийгдээгүй үед technical gate pass байсан ч vision release
gate-ийг бүрэн болсон гэж тэмдэглэхгүй.

## 13. Phase 3 ба Phase 4-т үлдэх хил

- Phase 3: role-based web/PWA UI, offline intake, review/dashboard/chat UX.
- Phase 4: AuthN/AuthZ/RBAC API, canonical transaction/outbox, cloud object
  storage adapter, notification, backup/restore, deployment infrastructure.

Эдгээр нь Phase 2 agent core-ийн дутуу код биш. Phase 2-ийн shared v1
contract болон port-уудыг adapter-аар ашиглана.
