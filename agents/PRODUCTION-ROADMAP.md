# BuildWatch Production Gap Audit ба 4 фазын хэрэгжүүлэлтийн roadmap

> **⚠️ ХУУЧИРСАН БАРИМТ (2026-08-05):** Энэ roadmap 2026-07-30-ны төлөвөөр бичигдсэн бөгөөд Phase 3-4-ийг "эхлээгүй" гэж заасан хэдий ч бодит хэрэгжилт (`REQUIREMENT-TRACEABILITY.md`, `docs/phase-9,10,11-*.md`) 2026-08-03/04 гэхэд тэдгээрийг аль хэдийн хийсэн. Одоогийн бодит төлөвийг **`REQUIREMENT-TRACEABILITY.md`** болон **`docs/phase-11-buildwatch-v2.2-production-release.md`**-ээс харна уу. Энэ файлыг зөвхөн Phase 1-2-ын түүхэн context-д зориулж хадгалж байна.

> **Хэрэгжилтийн төлөв — 2026-07-30:** Phase 1-ийн technical gate, 140-case A1 daily-report release evaluation болон agent data/deterministic/tool foundation хэрэгжсэн. Phase 2-ийн A1 vision/AI-7, A2 production observer, A3 six-document core, A4 11-tool read-only core, feedback, runtime budget/circuit/retry/dead-letter, observability metadata, Docker worker болон deterministic production gate кодлогдсон. Одоогийн баталгааг `REQUIREMENT-TRACEABILITY.md` болон `docs/PHASE-2-PRODUCTION.md`-ээс харна.
>
> **Phase 2 gate-ийн тайлбар:** Technical gate нь 120 A1 text contract, 64 synthetic vision contract, 30+ A2, 20+ A3, 80+ A4/11 tool болон LLM-off/runtime/security test-үүдийг шалгана. Full release gate-д зориуд 60+ нууцлал арилгасан бодит барилгын зураг, data-owner consent, хүний label болон OpenAI prediction manifest шаардана. Энэ external evidence-ийг зохиомлоор нөхөхгүй; өгөөгүй үед `technicalPass=true`, `releasePass=false` байна.

> **Requirement эх сурвалж:** `../requirement-v2.0.md` — BuildWatch v2.0, 2026-07-15 (мөн хуучирсан; одоогийн эх сурвалж нь `../buildwatch.md` v2.2)  
> **Кодын аудит:** `C:\Users\user\Desktop\diplom\agents`  
> **Roadmap-ийн огноо:** 2026-07-29  
> **Сонгосон дараалал:** Phase 1–2 = AI agent production, Phase 3 = frontend, Phase 4 = backend

---

## 1. Энэ roadmap-ийн гол шийдвэр

Requirement-ийн §18-д “агентаас эхлэх боломжгүй, агент өгөгдлийн давхарга дээр сууна” гэж зөв анхааруулсан. Гэхдээ энэ төслийн хэрэгжүүлэх дарааллыг дараах байдлаар зориуд өөрчилж байна:

1. **Phase 1:** Agent data contract, deterministic core, tool layer, A1-ийг production түвшинд хүргэнэ.
2. **Phase 2:** A2–A4, vision, evaluation, reliability, observability-г дуусгаж **agent layer production gate** давна.
3. **Phase 3:** Frozen contract дээр frontend-ийг mock server-тэй production-quality байдлаар бүтээнэ.
4. **Phase 4:** Backend, auth, canonical database, API, event integration, deployment-г хийж бүх системийг production болгоно.

Энэ дараалалд хоёр өөр “production” ойлголтыг ялгана:

### Agent production-ready

Agent нь:

- versioned input/output contract-той;
- seed data-гаас хамааралгүй;
- бодит хэлбэрийн data snapshot/зураг/текст авч чаддаг;
- тооцооллыг LLM-ээс тусгаарласан;
- бүх output нь schema, source, grounding шалгалттай;
- retry, idempotency, budget, trace, evaluation-тэй;
- CLI/worker/library хэлбэрээр тогтвортой ажилладаг;
- backend дараа нь дуудахад agent-ийн дотоод логикийг дахин бичих шаардлагагүй;

болсон төлөв.

### Бүтэн систем production-ready

Бодит хэрэглэгч:

- login хийж;
- өөрийн tenant/project хүрээнд;
- frontend-ээс өгөгдөл оруулж;
- backend-ээр батлуулж, хадгалуулж;
- agent-ийн үр дүнг авч;
- audit, notification, backup, security, monitoring-той ашиглах;

болсон төлөв. Энэ нь зөвхөн **Phase 4-ийн төгсгөлд** биелнэ.

> **Чухал:** Phase 1–2 дуусахад agent engine production-ready болно. Гэхдээ ажилтан шууд ашиглах SaaS хараахан production-ready болохгүй. Phase 3 frontend нь backend-гүй үед contract mock ашиглана. Full production release Phase 4-ийн дараа хийгдэнэ.

---

## 2. Одоогийн implementation бүхэлдээ mock мөн үү?

Үгүй. Одоогийн төсөлд бодитоор ажиллаж байгаа хэсэг олон байна:

- OpenAI API ашигласан текст болон зураг extraction;
- PostgreSQL + Prisma;
- `pg-boss` queue, retry, schedule, worker;
- critical path тооцоолол;
- deterministic 5 issue detector;
- A2 tool use, pattern/root-cause/trend, source grounding;
- A3 HTML/PDF, document draft, approve/reject;
- A4 read-only tool chat, exact source validation;
- Langfuse/OpenTelemetry integration;
- tenant/project scope-ийн тест;
- нийт 168 automated test;
- A1–A4 live evaluation амжилттай ажилласан.

Гэхдээ бодит бизнес өгөгдлийн оронд жижиг deterministic seed ашиглаж байна:

- 2 tenant;
- 3 project;
- 12 work item;
- 10 dependency;
- 11 progress snapshot;
- 12 cost entry;
- 5 зориуд шигтгэсэн issue.

Requirement-д шаардсан:

- 40–60 ажилтай төсөл;
- 12 долоо хоногийн түүх;
- материал;
- агуулах;
- ирц;
- хүн-өдөр/бүтээмж;
- туслан гүйцэтгэгч;
- өдрийн тайлан;
- alert lifecycle;
- өмнөх шийдвэр;

одоогийн seed болон Prisma model-д байхгүй.

Иймээс **AI plumbing бодит, харин business domain coverage ба production integration дутуу** гэж дүгнэнэ.

---

## 3. Requirement-тэй тулгасан ерөнхий үнэлгээ

Тэмдэглэгээ:

- ✅ — одоогийн scope дотор үндсэндээ хийсэн;
- 🟡 — хэсэгчлэн хийсэн, production gap үлдсэн;
- ❌ — байхгүй эсвэл requirement-ийн утгыг хангахгүй.

### 3.1 Үндсэн зарчмууд P1–P7

| Requirement                       | Төлөв | Одоогийн нотолгоо                                      | Дутуу зүйл                                                                               |
| --------------------------------- | ----: | ------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| P1 AI бэлдэнэ, хүн батална        |    🟡 | A1 `requiresHumanReview`; A3 approve/reject            | A1 review/apply workflow, A2 decision, final diff, бодит user audit байхгүй              |
| P2 Систем график өөрөө өөрчлөхгүй |    ✅ | Agent tool-ууд read-only; schedule update tool байхгүй | Recommendation баталсны дараах шинэ baseline version backend-д хэрэгжинэ                 |
| P3 LLM хилийн цэгт                |    🟡 | CPM, rules, grounding TypeScript дээр                  | Projected finish, material, productivity, stock, impact simulation дутуу                 |
| P4 Тоо LLM-ээс гарахгүй           |    🟡 | A2/A4 numeric grounding; A3 number guard               | Бүх шаардлагатай тооцоо байхгүй; recommendation impact days одоогоор гардаггүй           |
| P5 Чат read-only                  |    🟡 | A4 tool бүр read-only                                  | Write/report хүсэлтийг deterministic intent policy-оор татгалзаж дэлгэц рүү чиглүүлэхгүй |
| P6 Эрт илрүүлэлт                  |    🟡 | Trend observation, stalled/overdue detector            | Босго давахаас өмнөх forecast, material/productivity/stock early signal байхгүй          |
| P7 Автономи нотолгоотой суларна   |    ❌ | Golden evaluation байна                                | Production feedback, 4 долоо хоногийн metric, autonomy gate байхгүй                      |

### 3.2 Agent tool layer

Requirement 11 read-only tool шаардсан. Одоогоор 4 tool байна.

| Requirement tool              | Төлөв | Одоогийн equivalent / gap                                        |
| ----------------------------- | ----: | ---------------------------------------------------------------- |
| `getProjectSummary`           |    🟡 | Work item aggregate болон analysis summary тархай байдлаар байна |
| `getWorkItems`                |    ✅ | `lookup/inspectWorkItems`                                        |
| `getProgressHistory`          |    ✅ | `lookup/inspectProgressHistory`                                  |
| `getStockStatus`              |    ❌ | Material/stock model байхгүй                                     |
| `getConsumptionVsNorm`        |    ❌ | MaterialNorm, consumption байхгүй                                |
| `getAttendanceStats`          |    ❌ | Attendance model байхгүй                                         |
| `getBlockerHistory`           |    ❌ | DailyReport/blocker history байхгүй                              |
| `getAlerts`                   |    ❌ | Persistent Alert lifecycle байхгүй                               |
| `getScheduleForecast`         |    🟡 | Planned CPM байна; actual pace projected finish tool байхгүй     |
| `getSubcontractorPerformance` |    ❌ | Subcontractor data/model байхгүй                                 |
| `searchDailyReports`          |    ❌ | DailyReport model/search байхгүй                                 |

Tool layer-ийн дүрмүүд:

| Дүрэм                                      | Төлөв | Gap                                                                    |
| ------------------------------------------ | ----: | ---------------------------------------------------------------------- |
| T-1 tenant + project + user эрх tool дотор |    🟡 | tenant/project scope байна; authenticated user/role permission байхгүй |
| T-2 write tool байхгүй                     |    ✅ | A2/A4 read-only                                                        |
| T-3 trace + args + row count + token       |    🟡 | trace/tool args байна; row count, token/cost schema бүрэн биш          |
| T-4 15 tool call + token budget            |    🟡 | max steps байна; per-run/per-tenant monetary budget байхгүй            |
| T-5 aggregate + sample                     |    ✅ | collection window, truncation summary байна                            |

### 3.3 A1 — Бүртгэлийн агент

Одоогоор хийсэн:

- Монгол/Англи/холимог текст;
- PNG/JPEG/WEBP/GIF зураг;
- MIME/magic bytes, 10 MB limit, checksum;
- project/work-item code, status, progress, date, budget/cost extraction;
- field confidence + evidence;
- deterministic validation;
- `RegistrationDraft`;
- queue/worker/idempotency;
- text golden case 25/25.

Requirement-тэй харьцуулахад дутуу:

- нэг input-оос олон `ProgressEntry` гаргах;
- гүйцэтгэсэн тоо хэмжээ, нэгж;
- материалын дохио;
- attendance/headcount/hours;
- blocker reason + taxonomy;
- daily report-level огноо, байршил, block/stage;
- 1–5 photo collection;
- тодорхойгүй талбарт structured clarification question;
- candidate work item/material сонголт;
- low-confidence field-ийн review metadata;
- human edit/approve/reject/apply;
- approved draft-ийг canonical data/event болгох;
- duplicate daily report detection;
- material name normalization;
- cross-domain logic checks;
- construction photo work-type recognition;
- declared progress vs image contradiction;
- safety advisory observation;
- delivery/material preliminary receipt;
- image evidence-г “дохио, нотолгоо биш” гэж enforced schema-р ялгах;
- 100+ text golden dataset;
- 60+ image golden dataset;
- confidence calibration;
- real production image privacy/storage.

Одоогийн A1 schema нь нэг `ProjectUpdate` объект. Requirement-ийн A1 schema нь нэг `DailyReportDraft` дотор олон progress, attendance, material, blocker, photo observation агуулдаг байх шаардлагатай.

### 3.4 Deterministic analysis core

Одоогоор:

- FS/SS/FF/SF dependency;
- lag;
- DAG/cycle validation;
- planned critical path;
- overdue;
- stalled progress;
- dependency violation;
- budget overrun;
- ledger mismatch.

Requirement-ийн 7 standard rule-тай strict харьцуулахад:

| Required rule                      |                                Төлөв |
| ---------------------------------- | -----------------------------------: |
| Ажил n хоногоос дээш хоцорсон      |                                   ✅ |
| Материал нормоос n% хэтэрсэн       |                                   ❌ |
| Агуулах ирэх n хоногийг хангахгүй  |                                   ❌ |
| Бүтээмж n хоног дараалан доогуур   | ❌ — stalled progress нь яг адил биш |
| Төсвийн хэрэгжилт явцаас түрүүлсэн |   ❌ — budget overrun нь яг адил биш |
| Туслан гүйцэтгэгч графикаас зөрсөн |                                   ❌ |
| Өдрийн тайлан n хоног ирээгүй      |                                   ❌ |

Нэмэлтээр:

- GoRules ZEN runtime байхгүй;
- JDM rule artifact/version байхгүй;
- JDM Editor integration байхгүй;
- Alert persistent lifecycle байхгүй;
- baseline calendar/holiday байхгүй;
- baseline version/lock байхгүй;
- actual production rate-аар projected finish байхгүй;
- delay propagation-ийн actual forecast байхгүй;
- recommendation option бүрийн impact simulation байхгүй.

### 3.5 A2 — Ажиглагч агент

Одоогоор хийсэн:

- manual/event/nightly trigger;
- `pg-boss` retry/schedule;
- 4 read-only tool;
- deterministic analysis + CPM context;
- PATTERN/ROOT_CAUSE/TREND;
- exact sources;
- numeric/date grounding;
- recommendation coverage;
- `AgentRun`/`AgentToolCall`;
- 3 golden case, live 3/3.

Production gap:

- requirement-ийн 11 tool бүрэн биш;
- 12 долоо хоногийн давтамжийн өгөгдөл байхгүй;
- material/supplier/productivity/subcontractor pattern боломжгүй;
- alert-уудыг нэг root-cause group болгох persistent model байхгүй;
- pre-threshold risk forecast байхгүй;
- recommendation alternatives байхгүй;
- `estimatedImpactDays` deterministic утга байхгүй;
- required resource байхгүй;
- option risk/dependency conflict байхгүй;
- recommendation feasibility simulation байхгүй;
- manager approve/edit/discard байхгүй;
- decision reason дараагийн context-д ордоггүй;
- previous alert/decision memory байхгүй;
- tenant profile/terminology memory байхгүй;
- dynamic multi-tenant schedule DB-д байхгүй;
- failed job dead-letter/replay workflow байхгүй;
- output нь dedicated `Recommendation` draft биш, `AgentRun.output` JSON;
- 30+ delay scenario evaluation байхгүй;
- early detection day metric байхгүй.

### 3.6 A3 — Баримт бичгийн агент

Одоогоор хийсэн:

- project report;
- executive conclusion;
- official letter;
- deterministic narrative option;
- OpenAI qualitative narrative;
- number guard;
- source issue/recommendation IDs;
- HTML + embedded font + PDF;
- queue/schedule;
- approve/reject;
- edit comparison utility;
- 3 golden case.

Production gap:

- weekly period semantics;
- monthly period semantics;
- material, attendance, cost, next-week plan sections;
- approved report immutable `Report` model;
- edited final content persistence;
- draft-vs-final diff persistence;
- edit category;
- company template/logo/signature configuration;
- өмнөх approved document style memory;
- official letter recipient/context variants;
- report version/checksum;
- local filesystem-ийн оронд object storage;
- signed URL;
- schedule-ийн `asOf` demo/static огнооноос execution period руу шилжих;
- 20+ report bundle evaluation;
- “бодит бус мэдэгдэл = 0” full-domain evaluation.

### 3.7 A4 — Лавлагааны туслах

Одоогоор хийсэн:

- read-only tool calling;
- raw SQL үүсгэдэггүй;
- 4 tool;
- tenant/project scope;
- deterministic fallback router;
- exact source catalog;
- number/date/status grounding;
- insufficient evidence status;
- 6 live golden case, 6/6.

Production gap:

- full 11 tool coverage;
- user/role/project membership context;
- write intent-д deterministic refusal;
- report generation intent-д deterministic refusal;
- зохих UI route/action code буцаах;
- ChatSession/ChatMessage persistence;
- retention/deletion policy;
- conversation token compaction;
- material/attendance/alert/subcontractor/daily report асуулт;
- 80+ golden question;
- adversarial prompt injection suite;
- IDOR/security suite full backend context дээр;
- latency/cost budget.

### 3.8 AI-7 жижиг чадварууд

| Capability                  |                                          Төлөв |
| --------------------------- | ---------------------------------------------: |
| Саадын шалтгаан ангилах     |                                             ❌ |
| Материалын нэр стандартчлах |                                             ❌ |
| Давхардсан бүртгэл сэжиглэх |                                             ❌ |
| Cross-domain логик зөрчил   | 🟡 — зөвхөн date/status/cost/dependency subset |

### 3.9 Context, memory, feedback

Одоогоор progress snapshots болон cost history ашигладаг. Дутуу:

- өдөр → долоо хоног → сар hierarchical summary;
- project memory table;
- resolved issue history;
- previous recommendation decision/reason;
- tenant terminology/profile;
- approved document style profile;
- human edit category;
- production feedback metric;
- stable pattern-ийг rule болгох workflow.

### 3.10 Evaluation ба дипломын нотолгоо

| Requirement                           |               Одоогийн хэмжээ | Gap                                                           |
| ------------------------------------- | ----------------------------: | ------------------------------------------------------------- |
| A1 text 100+                          |                            25 | +75-аас доошгүй, domain coverage                              |
| A1 image 60+                          |         0 formal image golden | 60+ annotation                                                |
| A2 12-week simulation                 |            Жижиг snapshot set | 40–60 work item × 12 week                                     |
| A2 recommendation 30+                 | 1 risk-heavy + 2 safety cases | 30+ impact scenario                                           |
| A3 20+                                |                             3 | 17+ full report bundle                                        |
| A4 80+                                |                             6 | 74+ intent/source/security case                               |
| Simulation recall/earliness/precision |           Issue P/R хэсэгчлэн | early days, false alert, forecast accuracy                    |
| Human edit %                          |                Utility байгаа | бодит persisted diff dataset байхгүй                          |
| Prompt regression CI                  |                            🟡 | workflow зөвхөн цөөн source path trigger; full suite gate биш |

Одоогийн 100% evaluation нь одоогийн жижиг suite дээрх 100% болохоос requirement-ийн production coverage дээрх 100% биш.

### 3.11 Agent runtime ба operations

Одоогоор хийсэн:

- graceful worker shutdown;
- queue retry/backoff;
- singleton/idempotency key;
- optional Langfuse trace;
- telemetry content default off;
- PostgreSQL Docker;
- CI regression.

Production gap:

- production build script;
- compiled runtime artifact;
- Dockerfile;
- worker image;
- health/readiness probe;
- queue depth metric;
- dead-letter/replay command;
- concurrency/backpressure config;
- per-tenant schedule storage;
- per-run timeout/abort policy;
- quota circuit breaker;
- per-tenant token/cost budget;
- usage persistence;
- model/prompt/tool version persistence;
- provider/model fallback policy;
- structured JSON logs;
- Sentry;
- production Langfuse deployment/config;
- PII redaction/retention;
- secret manager;
- dependency version pinning (`latest` олон байна);
- production seed guard;
- backup/restore;
- staging/prod environment separation.

### 3.12 Frontend ба backend

Одоогоор:

- React frontend байхгүй;
- PWA/offline queue байхгүй;
- Express backend байхгүй;
- auth/RBAC байхгүй;
- Excel import байхгүй;
- full domain API байхгүй;
- RabbitMQ байхгүй;
- Cloudflare R2 байхгүй;
- GoRules/JDM Editor байхгүй;
- Vercel/Render deployment байхгүй.

Prisma, PostgreSQL, queue, agent scripts байгаа нь backend-ийн зарим infrastructure prototype боловч requirement-ийн modular backend биш.

### 3.13 Цөм функциональ шаардлага FR-1…FR-8

| Requirement                                                      | Төлөв | Одоогийн coverage                                 | Үлдсэн phase                                                          |
| ---------------------------------------------------------------- | ----: | ------------------------------------------------- | --------------------------------------------------------------------- |
| FR-1 Суурь, auth, RBAC, project structure                        |    ❌ | Tenant/Project/WorkItem-ийн хялбар schema л байна | Phase 4                                                               |
| FR-2 Baseline, Excel, version, calendar, Gantt                   |    🟡 | WorkItem/dependency болон planned CPM байна       | Agent forecast Phase 1; UI Phase 3; canonical backend Phase 4         |
| FR-3 Daily execution, attendance, stock, cost, approval, offline |    ❌ | A1 draft prototype + generic cost entry           | Agent contract Phase 1–2; UI Phase 3; backend Phase 4                 |
| FR-4 Continuous comparison, rules, alert lifecycle               |    🟡 | 5 TypeScript detector + jobs                      | Required rules Phase 1; UI Phase 3; persistence/GoRules Phase 4       |
| FR-5 Forecast, propagation, recommendation, schedule version     |    🟡 | Planned CPM + qualitative recommendation          | Forecast/impact Phase 1–2; decision UI Phase 3; apply/version Phase 4 |
| FR-6 Weekly/monthly report, immutable approval, PDF              |    🟡 | Generic report/PDF/draft approval                 | A3 Phase 2; UI Phase 3; final persistence Phase 4                     |
| FR-7 Dashboard, portfolio, notification                          |    ❌ | CLI/artifact only                                 | UI Phase 3; API/RabbitMQ Phase 4                                      |
| FR-8 Admin, subscription, AuditLog                               |    ❌ | Agent trace metadata хэсэгчлэн                    | UI Phase 3; backend Phase 4                                           |

### 3.14 Функциональ бус шаардлага NFR-1…NFR-9

| Requirement                                | Төлөв | Gap ба батлах phase                                                          |
| ------------------------------------------ | ----: | ---------------------------------------------------------------------------- |
| NFR-1 Tenant/project isolation             |    🟡 | Tool scope tests сайн; principal/RBAC/API IDOR Phase 2/4                     |
| NFR-2 Mobile ≤2 min, ≤10 taps, offline     |    ❌ | Phase 3 UX/PWA, Phase 4 sync/idempotency                                     |
| NFR-3 Calculation correctness              |    🟡 | CPM/ledger subset test-тэй; full forecast/material/productivity Phase 1      |
| NFR-4 G-1…G-8                              |    🟡 | Schema/source/grounding сайн; budget, full human gate, full fallback Phase 2 |
| NFR-5 API/dashboard/nightly performance    |    ❌ | Agent benchmark Phase 2; frontend Phase 3; API/load Phase 4                  |
| NFR-6 OWASP, signed URL, rate limit, audit |    ❌ | File type/checksum subset; full security Phase 4                             |
| NFR-7 Logs, Sentry, Langfuse               |    🟡 | Optional Langfuse/OTel; usage/log/Sentry/alerts Phase 2/4                    |
| NFR-8 Integration tests                    |    🟡 | Existing subset 168 tests; full domain/agent/E2E Phase 1–4                   |
| NFR-9 Mongolian UI/report/glossary         |    🟡 | Agent/report Монгол; glossary болон UI Phase 2/3                             |

### 3.15 Нээлттэй асуултуудаас заавал шийдэх зүйл

1. **Өгөгдөл оруулагч:** талбайн ахлагч уу, оффисын инженер үү — Phase 3 mobile UX-ээс өмнө шийднэ.
2. **Baseline Excel:** synthetic mapping fixture `data/sample-workbooks/`-д орсон. Гэхдээ workbook өөрөө “бодит мэт зохиомол” гэж тодорхойлсон тул дор хаяж нэг data-owner-attested anonymized бодит Монгол Excel авах шаардлага нээлттэй.
3. **Rule threshold:** domain expert-ийн default + tenant override policy тодорхойлно.
4. **Model:** төсөл OpenAI-only болсон тул requirement-ийн model open question-ийг ADR-аар хаана.
5. **Монгол нэр томьёо:** Phase 1–2 dataset-аас glossary шаардлагыг хэмжиж tenant dictionary contract гаргана.
6. **Тайлбарлах чадвар:** critical path, forecast, agent loop бүрийг диплом хамгаалалт дээр код/diagram-аар тайлбарлах material бэлтгэнэ.
7. **API budget:** tenant/run/month cap болон owner-ийг Phase 2-оос өмнө тогтооно.

### 3.16 Deferred scope

Requirement-ийн MVP зүрхэнд ороогүй дараах ажлыг Phase 4 production gate-д заавал чихэхгүй:

- зураг төслийн drawing автомат уншилт;
- хүлээлгэн өгөх актын модуль;
- нэхэмжлэх/баримтын бүрэн OCR;
- БНбД/гэрээний RAG;
- vector database;
- гадагш албан бичгийг хүний approval-гүй автоматаар илгээх.

Энд A1-ийн **талбайн өдөр тутмын зураг** болон **зураг төслийн drawing OCR**-ийг ялгана. Daily photo vision Phase 2-т орно; drawing understanding нь дараагийн product phase.

---

## 4. Target architecture — agent-first, contract-driven

Phase 1–2-т frontend/backend хийхгүй ч agent-ийг шууд current Prisma schema-д хатуу уяхгүй.

```text
                    ┌─────────────────────────────────┐
File/Text/JSON ───► │ Versioned Agent Input Contracts │
                    └──────────────┬──────────────────┘
                                   ▼
                       A1 DailyReportDraft
                                   ▼
                  CLI human review / test harness
                                   ▼
                    ApprovedDailyReportCommand
                                   ▼
               Agent Read-Model / Simulation Adapter
                                   ▼
             Deterministic metrics + rules + forecast
                                   ▼
                  11 authorized read-only tools
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
                   A2             A3             A4
                    ▼              ▼              ▼
              Draft artifacts + sources + validation
```

Phase 4-т backend:

```text
Frontend
   ▼
Express API + Auth/RBAC
   ▼
Canonical domain transaction
   ├─ PostgreSQL
   ├─ R2 files
   ├─ AuditLog
   └─ OutboxEvent
           ▼
     Agent input/read-model adapter
           ▼
       A1 / A2 / A3 / A4
```

### 4.1 Agent core-ийн port/interface

Agent code дараах port-уудтай байна:

- `AgentDataProvider` — authorized project snapshot унших;
- `AgentDraftRepository` — A1/A2/A3 draft хадгалах;
- `AgentRunRepository` — run/tool/token/cost metadata;
- `ArtifactStore` — source image, report, PDF;
- `AgentQueue` — enqueue/schedule/retry;
- `TelemetryPort` — trace/metrics;
- `ModelGateway` — OpenAI model;
- `Clock` — deterministic as-of;
- `AuthorizationContext` — tenant/project/principal/permissions;
- `EventPublisher` — draft/analysis lifecycle event.

Одоогийн Prisma, pg-boss, local filesystem, OpenAI implementations нь adapter болно. Phase 4 backend эдгээр contract-ийг өөрчлөхгүйгээр бодит adapter нийлүүлнэ.

### 4.2 Shared contract package

Phase 2-ийн төгсгөлд:

```text
diplom/
├─ agents/
├─ packages/
│  └─ contracts/
├─ frontend/       # Phase 3
└─ backend/        # Phase 4
```

`packages/contracts` дотор:

- Zod request/response schema;
- domain enums;
- agent input/output version;
- source reference;
- error code;
- event payload;
- OpenAPI-д хөрвүүлэх contract;

байрлана.

---

# PHASE 1 — Agent data foundation + A1 production

## 5. Phase 1 зорилго

Backend/UI-гүйгээр:

- requirement-ийн agent-д шаардлагатай data contract;
- deterministic core;
- simulation/read-model;
- 11 tool;
- A1 text intake;
- human review command;

бодит production түвшний үндэстэй болно.

Phase 1-д **хийхгүй**:

- React;
- Express API;
- login/JWT;
- real employee UI;
- RabbitMQ notification;
- subscription/admin UI.

Гэхдээ agent ажиллахад зайлшгүй data model, repository interface, CLI review harness-ийг хийнэ.

## 6. Phase 1.1 — Requirement traceability ба ADR

### Хийх ажил

- Requirement ID бүрийг code/test/deliverable-тэй холбосон `REQUIREMENT-TRACEABILITY.md` үүсгэнэ.
- Status: `NOT_STARTED`, `PARTIAL`, `DONE`, `DEFERRED`, `OUT_OF_SCOPE`.
- Agent contract өөрчлөлт бүр schema version-тэй байна.
- Existing нэг ADR дээр дараах ADR-уудыг нэмнэ:
  1. Agent-first contract architecture;
  2. OpenAI-only model policy;
  3. GoRules runtime vs TypeScript rules;
  4. pg-boss vs RabbitMQ responsibility;
  5. artifact storage, retention, privacy;
  6. human approval + idempotent apply/outbox;
  7. structured data without vector DB.

### Шийдэх зөрчил

- Requirement FR-4.2 GoRules шаардсан, existing ADR TypeScript rules-ийг түр сонгосон.
- ADR-0001/0004-ийн шийдвэрээр Phase 1-д strict runtime boundary ба deterministic TypeScript oracle ашиглаж, GoRules/JDM runtime/persistence-ийг Phase 4-т холбоно.
- JDM Editor UI Phase 3, rule persistence/deployment Phase 4-д орно.

### Exit criteria

- Requirement-ийн AI/tool/NFR мөр бүр owner, phase, test-тэй.
- 6+ ADR нийтдээ бэлэн.
- “Done” гэсэн ойлголт golden score-оор биш requirement coverage-оор хэмжигддэг болсон.

## 7. Phase 1.2 — Full agent data contract

### A1 contract

`ProjectUpdate`-ийг requirement-ийн `DailyReportDraftV1` рүү өргөтгөнө:

```text
DailyReportDraft
├─ projectRef
├─ reportDate
├─ location / block / stage
├─ rawText
├─ progressEntries[]
│  ├─ workItemRef/candidates
│  ├─ qtyDone + unit
│  ├─ percentDone
│  ├─ blocker
│  ├─ note
│  └─ confidence/evidence
├─ attendanceEntries[]
├─ materialSignals[]
├─ photoObservations[]
├─ clarificationQuestions[]
├─ duplicateCandidates[]
├─ validationIssues[]
└─ overallConfidence
```

### Analysis snapshot contract

`ProjectAnalysisSnapshotV1`:

- tenant/project identity;
- baseline version;
- WBS tree;
- work quantities;
- dependencies;
- calendar;
- material norms;
- daily reports;
- progress history;
- attendance;
- stock movements;
- cost entries;
- blockers;
- alerts;
- forecasts;
- subcontractors;
- previous recommendations/decisions;
- tenant profile;
- as-of.

### Гаралтын contract

- `DeterministicAnalysisV1`;
- `RecommendationDraftV1`;
- `DocumentBundleV1`;
- `ReferenceAnswerV1`;
- `AgentRunEnvelopeV1`;
- `AgentSourceRefV1`;
- `AgentUsageV1`;
- `AgentErrorV1`.

### Exit criteria

- Contract бүр strict Zod schema-тай.
- Unknown field reject хийнэ.
- Schema migration/backward compatibility test-тэй.
- JSON sample fixture бүр valid.
- Frontend/backend дараа нь contract-ийг import хийж ашиглах боломжтой.

## 8. Phase 1.3 — Simulation ба бодит хэлбэрийн өгөгдөл

### Requirement-ийн simulation

- 40–60 work item;
- WBS parent/child;
- FS/SS dependency;
- calendar/holiday;
- baseline quantity/cost/date;
- material norm;
- 12 долоо хоногийн daily report;
- attendance;
- stock movement;
- subcontractor;
- cost;
- manager decision;
- alert history.

### Зориуд шигтгэх scenario

- critical delay;
- material over-consumption;
- stock shortage;
- productivity decline;
- cost ahead of progress;
- subcontractor delay;
- missing daily report;
- repeated supplier blocker;
- linked alert root cause;
- dependency violation;
- ledger mismatch;
- healthy/no-risk control;
- cross-tenant secret data.

### Data separation

- Demo seed;
- deterministic unit fixture;
- golden evaluation dataset;
- anonymized synthetic mapping sample;
- anonymized real sample;
- production database;

хоорондоо тусдаа байна.

### Exit criteria

- Answer key issue бүр effective date, expected evidence-тэй.
- Simulation deterministic seed-тэй.
- 12-week replay ажилладаг.
- Hidden answer key agent context-д ордоггүй.
- Current 12 work item seed-ээс тусдаа full simulation үүссэн.

## 9. Phase 1.4 — Deterministic core production

### CPM ба forecast

- Existing FS/SS/FF/SF CPM-ийг хадгална.
- Calendar/working day нэмнэ.
- Baseline version-аас planned critical path бодно.
- Actual quantity/progress rate-аас remaining duration бодно.
- Work item projected finish бодно.
- Project projected finish бодно.
- Delay propagation dependency graph-аар бодно.
- Forecast confidence/data sufficiency гаргана.
- Scenario simulation:
  - parallelization;
  - extra crew/resource;
  - resequencing;
  - subcontractor option.

LLM scenario-ийн хоногийг өөрөө зохиохгүй. Deterministic scenario engine л `estimatedImpactDays` буцаана.

### Required rules

Бүх 7 rule:

1. overdue critical/noncritical;
2. material consumption vs norm;
3. stock coverage 7/14 days;
4. productivity decline;
5. cost progress ahead of physical progress;
6. subcontractor schedule deviation;
7. missing daily report.

Existing:

- dependency violation;
- budget overrun;
- ledger mismatch;
- stalled progress;

дүрмүүд нэмэлтээр үлдэж болно.

### Alert semantics

- deterministic `Deviation`;
- transparent `RuleEvaluation`;
- dedupe/group key;
- severity;
- explanation = rule + actual + threshold + source;
- lifecycle contract;
- root-cause group link.

### Exit criteria

- Calendar-aware CPM unit tests.
- Cycle/invalid dependency tests.
- Forecast benchmark fixtures.
- Required 7 rule тус бүр positive/negative/boundary case-тэй.
- Ledger reconciliation exact decimal хэвээр.
- Scenario impact бүхэлдээ deterministic.
- LLM package import deterministic module-д байхгүй.

## 10. Phase 1.5 — 11 tool production implementation

### Tool бүрийн нийтлэг шаардлага

- `AuthorizationContext` дотроос scope шалгана.
- Caller-supplied tenant scope-д итгэхгүй.
- Read-only repository method ашиглана.
- Strict input/output schema.
- Aggregate + sample + `truncated`.
- Row count.
- Duration.
- Source catalog.
- As-of semantics.
- Max row limit.
- No raw SQL from model.
- Sensitive field allow-list.

### Хэрэгжүүлэх tool

1. `getProjectSummary`
2. `getWorkItems`
3. `getProgressHistory`
4. `getStockStatus`
5. `getConsumptionVsNorm`
6. `getAttendanceStats`
7. `getBlockerHistory`
8. `getAlerts`
9. `getScheduleForecast`
10. `getSubcontractorPerformance`
11. `searchDailyReports`

### Security tests

- wrong tenant;
- allowed tenant/wrong project;
- project not in principal scope;
- crafted project ID;
- empty scope;
- aggregate leakage;
- truncated sample leakage;
- source ID from another tenant;
- malicious text inside DB record.

### Exit criteria

- 11/11 tool core function test.
- 11/11 AI SDK wrapper test.
- User authorization adapter fixture.
- Cross-tenant leakage 0.
- Tool output source catalog-той таарна.

## 11. Phase 1.6 — A1 text production + review harness

### A1 text чадвар

- Монгол/Англи/холимог daily report;
- олон ажил нэг report-д;
- quantity + percent;
- attendance;
- material signal;
- blocker classification;
- location/stage;
- duplicate suspicion;
- deterministic status/date logic;
- material normalization;
- clarification question.

### Human-in-the-loop

Frontend/backend хүлээлгүй agent-ийг шалгахын тулд operator CLI:

```text
agent:a1:intake
agent:a1:drafts
agent:a1:show
agent:a1:edit
agent:a1:approve
agent:a1:reject
agent:a1:apply-simulation
```

Эдгээр command бүгд хэрэгжсэн бөгөөд `docs/phase-1-agent-data-and-a1.md`-д ажиллуулах дараалал бий.

### Apply contract

A1 өөрөө product DB update хийхгүй. Approve хийсний дараа:

- `ApprovedDailyReportCommand`;
- `PROJECT_EXECUTION_APPROVED` event;
- field provenance;
- human edit markers;

гаргана.

Phase 1-ийн simulation adapter энэ command-ийг agent read-model-д apply хийж A2-г end-to-end туршина. Phase 4 backend яг энэ command/event contract-ийг canonical transaction-аас гаргана.

### Exit criteria

- Requirement AI-1.1–AI-1.5 test-тэй.
- Low-confidence талбар бүр evidence/question-тэй.
- A1 unknown value таамаглахгүй.
- Human approval-гүй apply болохгүй.
- Duplicate request id хоёр draft үүсгэхгүй.
- 100+ text golden dataset.
- Field accuracy, clarification precision, confidence calibration report гарна.

## 12. Phase 1 exit gate

- [x] Requirement traceability бэлэн.
- [x] 6+ ADR нийтдээ бэлэн.
- [x] Full agent contracts versioned.
- [x] 40–60 work item, 12-week simulation бэлэн.
- [x] Calendar-aware CPM + projected finish бэлэн.
- [x] Required 7 rules ажилладаг.
- [x] Deterministic scenario impact engine бэлэн.
- [x] 11/11 read-only tool ажилладаг.
- [x] A1 daily-report text schema requirement хангадаг.
- [x] Human review CLI/harness ажилладаг.
- [x] 100+ A1 text eval case release gate-тэй.
- [x] Cross-tenant tool test 100%.
- [x] Synthetic anonymized Excel mapping fixture checksum/manifest test-тэй.
- [ ] Data-owner-attested anonymized бодит Монгол Excel sample авсан.

---

# PHASE 2 — A1 vision + A2/A3/A4 + agent production hardening

## 13. Phase 2 зорилго

Phase 1-ийн data/tool/deterministic foundation дээр:

- A1 vision;
- AI-7;
- A2 full observer;
- A3 full document agent;
- A4 full reference assistant;
- context memory;
- evaluation;
- runtime/operations;

дуусгана.

Phase 2-ын төгсгөлд **Agent Production Gate** давна.

## 14. Phase 2.1 — A1 vision production

### Image pipeline

- multi-photo input 1–5;
- EXIF orientation;
- resize/compression;
- max pixel/page guard;
- MIME + magic byte;
- checksum/dedup;
- malware scan port;
- artifact storage port;
- signed read reference contract;
- retention/deletion metadata.

> **Хэрэгжсэн safety slice — 2026-07-30:** PNG/JPEG/WebP/GIF dimension parser, EXIF orientation detection/display dimension, 40MP ба 20,000px side guard, single-frame policy, malformed/truncated header rejection нь `src/structuring/image-inspection.ts` болон `tests/structuring/image-inspection.test.ts`-ээр баталгаажсан.
>
> **Хэрэгжсэн vision/runtime slice — 2026-07-30:** `src/structuring/image-preprocessing.ts` нь Sharp ашиглан EXIF auto-orient, 2048px inside resize, no-enlargement, JPEG/PNG/WebP compression, static GIF→PNG conversion болон metadata stripping хийдэг. Model болон artifact store-д зөвхөн normalized bytes/checksum дамжина. Source/output inspection, checksum, operation metadata нь queue, `RegistrationDraft.sourceImageMetadata`, review-store provenance sidecar-аар хадгалагдана. Malware scanner болон `ArtifactStore` port, immutable local adapter, signed read contract, retention/deletion lifecycle, 64 synthetic image contract, balanced 60+ real-image annotation/prediction/release workflow хэрэгжсэн. Cloud object-store/malware adapter нь Phase 4 deployment; бодит 60+ image evidence нь data owner/reviewer-оос хамаарна.

### Vision output

- possible work type;
- visible progress cue;
- declared progress contradiction question;
- visible safety advisory;
- delivery/material candidate;
- unreadable/insufficient image status;
- visible region evidence;
- confidence.

### Safety rule

Image:

- нотолгоо биш;
- automatic alert үүсгэхгүй;
- automatic safety decision хийхгүй;
- зөвхөн review question/advisory үүсгэнэ.

### Evaluation

- 60+ image;
- work type labels;
- contradiction labels;
- safety advisory labels;
- delivery/material labels;
- difficult/blurred/night/angle cases;
- precision/recall;
- false accusation metric.

### Exit criteria

- AI-2.1–AI-2.4 contract болон tests.
- 60+ image eval.
- Image-only claim evidenceгүй гардаггүй.
- Unreadable image таамаг үүсгэдэггүй.
- Foreign currency/material text буруу canonical value болдоггүй.

## 15. Phase 2.2 — AI-7 production

- Blocker taxonomy + confidence.
- Tenant terminology dictionary.
- Material alias normalization.
- Duplicate similarity detector.
- Cross-domain consistency:
  - progress but no quantity;
  - concrete work but no concrete issue/consumption;
  - attendance absent but labor cost;
  - completed status but unfinished quantity;
  - stock issue vs movement;
  - report date outside project period.
- AI suggestion + deterministic validation separation.

### Exit criteria

- AI-7.1–AI-7.4 golden cases.
- Auto-normalization reversible/provenance-тэй.
- Low-confidence normalization human review шаарддаг.

## 16. Phase 2.3 — A2 full production

### Requirement-ийн 6 алхмыг яг хэрэгжүүлэх

1. Scope determination — deterministic.
2. Metrics/rules/forecast — deterministic.
3. Context assembly — deterministic.
4. LLM analysis — pattern/root cause/options.
5. Grounding/schema/number validation.
6. Draft queue for human decision.

### A2 output

`RecommendationDraftV1` бүр:

- observation kind;
- severity/priority;
- work item(s);
- root-cause group;
- source refs;
- action option;
- deterministic `estimatedImpactDays`;
- required resources;
- option risks;
- dependency conflicts;
- feasibility status;
- data sufficiency;
- confidence;
- status=`PENDING_REVIEW`.

### Context memory

- recent alerts;
- closed alerts;
- previous recommendations;
- manager decision/reason;
- repeated blocker groups;
- tenant terminology;
- monthly/weekly summary;
- data freshness.

### Trigger

- manual;
- approved execution event;
- nightly;
- schedule time zone;
- dynamic project list;
- event idempotency;
- catch-up after downtime.

### Failure handling

- OpenAI unavailable → deterministic analysis/alerts хадгалагдана;
- recommendation draft `AI_UNAVAILABLE`;
- retryable/non-retryable error distinction;
- dead-letter;
- replay;
- duplicate run protection;
- stale as-of prevention.

### Evaluation

- 12-week simulation replay;
- 30+ recommendation scenario;
- precision;
- recall;
- early detection days;
- forecast accuracy;
- option feasibility;
- recommendation impact correctness;
- false alert rate;
- root-cause linking.

### Exit criteria

- AI-3, AI-4, AI-5 requirements бүр test-тэй.
- 11 tool-оос шаардлагатайг ашигладаг.
- Impact days LLM-ээс гарах боломжгүй.
- Manager decision memory дараагийн run-д ордог.
- A2 output dedicated persisted draft artifact.
- Nightly/event worker restart-safe.

## 17. Phase 2.4 — A3 full production

### Document types

- weekly report;
- monthly report;
- deviation conclusion;
- subcontractor reminder;
- supplier demand;
- client notice.

### Deterministic content

- period;
- completed work;
- plan vs actual;
- delay;
- material;
- attendance/productivity;
- cost;
- open alerts;
- forecast;
- next period plan.

Тоон утга template/source data-аас орно. LLM зөвхөн qualitative narrative бичнэ.

### Human feedback

- AI draft;
- edited final;
- diff;
- edit distance;
- edit category;
- reviewer;
- approval time;
- immutable approved version;
- checksum;
- rejected reason.

### Style memory

- company report template;
- terminology;
- approved prior document patterns;
- logo/signature placeholders;
- recipient style;
- prohibited claims.

### Artifact storage

- local filesystem = dev adapter;
- production `ArtifactStore`;
- PDF/HTML/Markdown;
- content hash;
- storage key;
- no absolute local path in domain artifact.

### Evaluation

- 20+ report bundle;
- factual consistency;
- number guard;
- source coverage;
- Mongolian quality;
- human edit percentage;
- PDF render snapshot;
- tenant isolation.

### Exit criteria

- AI-6.1–AI-6.5 бүрэн.
- Weekly/monthly period зөв.
- Approved final immutable.
- Diff persisted.
- 20+ eval case.
- Unsupported factual claim 0.

## 18. Phase 2.5 — A4 full production

### Tool coverage

- 11 tool бүхэлдээ intent router-т орно.
- Multi-tool question plan.
- Aggregate vs sample semantics.
- As-of question.

### Deterministic policy

- Read question → tool research.
- Write/update request → `REFUSED_WRITE_ACTION`.
- Report/document request → `REDIRECT_REPORT_WORKFLOW`.
- Unknown/out-of-scope → `INSUFFICIENT_EVIDENCE`.
- Unauthorized scope → safe access error.
- Raw SQL request → refuse.

### Output

- claim;
- exact source;
- source value;
- as-of;
- status;
- suggested UI route code;
- no hidden chain-of-thought.

### Evaluation

- 80+ questions;
- all tool intents;
- no-data;
- aggregation;
- cross-project;
- cross-tenant;
- malicious prompt;
- embedded instruction in DB content;
- write/report refusal;
- number/date/source grounding;
- Mongolian mixed-language.

### Exit criteria

- AI-8.1–AI-8.6 бүрэн.
- Source precision/recall release gate.
- Tenant leakage 0.
- Write/report request 100% policy match.
- 80+ case.

## 19. Phase 2.6 — Reliability G-1…G-8

| Guard | Production implementation                              |
| ----- | ------------------------------------------------------ |
| G-1   | Number provenance catalog + unsupported number reject  |
| G-2   | Strict versioned Zod output + bounded repair           |
| G-3   | Claim/source exact match                               |
| G-4   | Entity/date/status/value existence validation          |
| G-5   | Insufficient evidence/clarification first-class output |
| G-6   | Draft status + human gate                              |
| G-7   | LLM-off deterministic pipeline tests                   |
| G-8   | Token/cost budget + circuit breaker                    |

### Нэмэлт guard

- prompt injection handling;
- tool allow-list;
- schema size limit;
- output length limit;
- model timeout;
- retry budget;
- no secret in prompt/log;
- PII content logging default off;
- model/prompt/tool bundle version;
- result provenance.

## 20. Phase 2.7 — Agent observability ба usage

`AgentRun`-д нэмэх:

- trigger;
- request/event ID;
- prompt version;
- tool bundle version;
- schema version;
- provider/model;
- tokens in/out;
- cached tokens;
- estimated/actual cost;
- latency;
- retries;
- status;
- failure category;
- trace ID;
- data snapshot version.

`AgentToolCall`-д:

- authorized scope hash;
- args;
- row count;
- truncated;
- duration;
- output hash;
- status/error.

Operational:

- structured JSON logs;
- OpenTelemetry;
- Langfuse trace;
- Sentry;
- queue depth;
- run success/failure;
- grounding rejection;
- confidence distribution;
- token/cost dashboard;
- per-tenant budget alert.

## 21. Phase 2.8 — Agent runtime hardening

- All dependency version pin.
- `pnpm build`.
- production-only TypeScript compile.
- Dockerfile.
- non-root container.
- health command/probe.
- graceful shutdown.
- configurable concurrency.
- retry/backoff.
- dead-letter/replay.
- no fixed demo `asOf`.
- UTC storage + tenant timezone scheduling.
- production seed guard.
- migration deploy command.
- secret manager contract.
- artifact retention.
- OpenAI quota/circuit-breaker state.
- one-command smoke test.

## 21.1 Phase 2.9 — Feedback loop ба autonomy gate

### Feedback capture

- A1 field-level human edit;
- A2 recommendation approve/edit/discard + reason;
- A3 draft vs final diff + category;
- A4 incorrect/helpful feedback;
- false/true alert decision;
- model/prompt/tool/data version;

бүгд evaluation-д дахин ашиглах боломжтой structured record болно.

### Сайжруулах давталт

1. Human edit/decision цуглуулах.
2. Алдааг `GROUNDING`, `MISSING_CONTEXT`, `PROMPT`, `RULE`, `DATA_QUALITY`, `UX` гэж ангилах.
3. Golden dataset-д regression case нэмэх.
4. Prompt/context/rule-г өөрчлөх.
5. Full regression ажиллуулах.
6. Тогтвортой pattern-ийг GoRules rule болгох.

Model fine-tuning нь default арга биш. Эхлээд data quality, context, deterministic validation, rule-ээр засна.

### Autonomy

| Level                                              | Phase 2 agent gate дээр     | Full production дээр                                           |
| -------------------------------------------------- | --------------------------- | -------------------------------------------------------------- |
| L1 — classification/metrics/alert draft            | Автомат байж болно          | Автомат                                                        |
| L2 — low-risk normalization auto-save              | Contract бэлэн, default OFF | Golden ≥97%, production 4 долоо хоног ≥95% үед тусад нь enable |
| L3 — internal report auto-send                     | OFF                         | Human edit 4 долоо хоног <10% бол дараагийн release            |
| L4 — routine notification auto-send                | OFF                         | False alert <5% бол дараагийн release                          |
| Schedule/contract/finance/external official action | Хэзээ ч автомат биш         | Хэзээ ч автомат биш                                            |

### Exit criteria

- Human feedback structured хадгалагдана.
- Diff/decision regression case болж чадна.
- Autonomy feature flag default safe.
- Metric босго хүрээгүй үед L2–L4 идэвхжихгүй.

## 22. Agent Production Gate — Phase 2 exit

- [x] A1 text 100+ golden case.
- [x] A1 synthetic image contract 60+ case.
- [ ] A1 бодит image 60+ human-reviewed release evidence — data owner/reviewer external gate.
- [x] A1 full daily report draft contract.
- [x] AI-7 four capability бүрэн.
- [x] 40–60 work item, 12-week simulation.
- [x] 11/11 tool.
- [x] 7 required rule + existing useful rules.
- [x] Actual pace projected finish.
- [x] Deterministic recommendation impact.
- [x] A2 30+ scenario, early-detection metric, actual-pace forecast
      accuracy gate (30+ sample; MAE/P90/max <= 7 calendar day).
- [x] A3 20+ report set, persisted diff, unsupported claim 0.
- [x] A4 80+ question, tenant leak 0.
- [x] G-1…G-8 бүрэн.
- [x] LLM-off deterministic system test.
- [x] Agent runs token/cost/trace/version metadata.
- [x] Worker Dockerfile/Compose, retry, replay, health implementation.
- [x] Shared contracts frozen as `v1`.
- [x] Agent API/library interface documented.
- [x] No frontend/backend implementation dependency.

Technical gate-ийн бүх мөр хэрэгжсэн. Agent Production **release** gate нь
зөвхөн 60+ бодит image evidence pass болсны дараа хаагдана.

Phase 2 дууссаны дараа agent дотоод логикийг “бүрэн” гэж үзнэ. Үүнээс хойших Phase 3–4 агентын core behavior-ийг өөрчлөх бус contract-аар ашиглана.

---

# PHASE 3 — Frontend production-quality implementation

## 23. Phase 3-ын онцгой нөхцөл

User-ийн сонгосон дарааллаар frontend backend-ээс өмнө хийгдэнэ. Иймээс frontend:

- frozen shared contracts;
- OpenAPI draft;
- MSW/mock server;
- deterministic fixture;
- agent artifact samples;

дээр хийгдэнэ.

Phase 3-ын төгсгөлд frontend code production-quality болно. Гэхдээ real production data-тай бүрэн систем биш. Phase 4 backend холбогдсоны дараа full release хийнэ.

### Rework-оос хамгаалах дүрэм

- UI өөрийн дурын response shape зохиохгүй.
- Бүх mock shared Zod/OpenAPI contract-оос үүснэ.
- API client generated байна.
- Backend Phase 4 contract test-ээр яг адил response нийлүүлнэ.
- Mock-specific logic component дотор орохгүй.

## 24. Phase 3.1 — Frontend foundation

- React + TypeScript;
- Tailwind;
- router;
- query/cache layer;
- typed API client;
- MSW;
- form/schema validation;
- Mongolian localization;
- error boundary;
- toast/notification;
- role-based route metadata;
- accessible component system;
- responsive layout;
- dark/light биш, эхлээд field usability.

## 25. Phase 3.2 — Role-based application shell

Role:

- Super Admin;
- Company Admin;
- Manager;
- Engineer/PTO;
- Site Supervisor;
- Storekeeper;
- Observer.

Mock authorization:

- route guard;
- menu visibility;
- action permission;
- project switcher;
- tenant switcher only super admin.

Phase 4 backend token claim бодитоор нийлүүлнэ.

## 26. Phase 3.3 — Baseline UI

- Excel upload;
- sheet/column mapping;
- validation error table;
- WBS tree;
- work item editor;
- quantity/unit/cost;
- dependency editor;
- calendar;
- baseline version list;
- approve/lock;
- change reason;
- baseline vs current;
- Gantt;
- planned vs actual;
- critical path highlight.

Mock data нь Phase 1 simulation contract-оос ирнэ.

## 27. Phase 3.4 — Daily execution PWA

### 2 минутын flow

- project/date auto;
- work item quick search/recent;
- quantity/progress;
- 1–5 photos;
- voice/text note optional;
- blocker chips;
- attendance;
- material signal;
- save draft;
- submit.

### A1 review UX

- original text/image;
- structured fields;
- confidence color;
- evidence;
- clarification question;
- candidate selector;
- human edit indicator;
- approve/reject;
- duplicate warning.

### Offline

- service worker;
- IndexedDB outbox;
- local attachment queue;
- retry;
- conflict state;
- duplicate idempotency key;
- sync status.

### Gate

- realistic usability test ≤ 2 минут;
- ≤ 10 primary taps;
- offline create/reload/sync test;
- no data loss.

## 28. Phase 3.5 — Execution modules

- attendance entry;
- subcontractor headcount/hours;
- stock receipt;
- stock issue to work item;
- reversal/correction flow;
- document photo;
- cost entry;
- daily report approval queue;
- return with reason;
- immutable approved view.

## 29. Phase 3.6 — Analysis, alert, recommendation UI

- project dashboard;
- S-curve plan vs actual;
- projected finish/delay;
- budget vs cost;
- material risk;
- open alerts;
- severity/status;
- rule explanation;
- evidence drawer;
- alert acknowledge/assign/action/close;
- root-cause grouping;
- A2 recommendation options;
- deterministic impact days;
- resources/risk/dependency conflict;
- approve/edit/discard;
- decision reason.

## 30. Phase 3.7 — A3 болон A4 UI

### A3

- weekly/monthly report list;
- draft preview;
- source/evidence;
- edit;
- diff;
- approve/reject;
- PDF preview/download;
- immutable approved version.

### A4

- chat;
- streaming response placeholder;
- source chips;
- source detail drawer;
- insufficient evidence state;
- write request redirect;
- scope indicator;
- clear/new session.

## 31. Phase 3.8 — Admin, rules, subscription

- users/projects mock management;
- project membership;
- role matrix;
- report template settings;
- terminology settings;
- GoRules JDM Editor component;
- rule version/history;
- tenant plan/usage dashboard;
- audit timeline;
- agent cost dashboard.

## 32. Phase 3.9 — Frontend quality

- unit/component tests;
- Storybook эсвэл component catalog;
- MSW integration tests;
- Playwright E2E mock flows;
- accessibility;
- keyboard navigation;
- responsive desktop/mobile;
- Lighthouse budget;
- initial bundle budget;
- dashboard fixture render < 2 sec target;
- error/empty/loading/offline states;
- Mongolian typography/UTF-8;
- no secret/environment key in bundle.

## 33. Frontend Gate — Phase 3 exit

- [ ] Shared API contract-оос generated client ашигласан.
- [ ] Mock API contract drift 0.
- [ ] Role бүрийн үндсэн flow.
- [ ] Baseline import/mapping/Gantt UI.
- [ ] Daily report ≤ 2 минут, ≤ 10 tap usability check.
- [ ] PWA offline queue no-data-loss.
- [ ] A1 review UI.
- [ ] Alert/recommendation decision UI.
- [ ] A3 review/PDF UI.
- [ ] A4 source-backed chat UI.
- [ ] Admin/JDM/settings screens.
- [ ] Component + E2E mock tests.
- [ ] Accessible/responsive production build.

> Phase 3 дээр “амьд production system” гэж зарлахгүй. Backend integration Phase 4-д заавал үлдэнэ.

---

# PHASE 4 — Backend, integration, deployment, full production

## 34. Phase 4 зорилго

Requirement-ийн:

- Express modular monolith;
- canonical data model;
- auth/RBAC;
- file storage;
- Excel import;
- execution ledger;
- rules/alerts;
- agent orchestration;
- reporting/chat persistence;
- RabbitMQ notification;
- audit;
- security/performance/deploy;

бүгдийг хэрэгжүүлж Phase 3 frontend-тэй холбоно.

## 35. Phase 4.1 — Backend foundation

- Node.js + Express + TypeScript;
- modular monolith;
- config validation;
- OpenAPI;
- shared Zod contracts;
- standard error envelope;
- request/correlation ID;
- structured logging;
- health/live/readiness;
- graceful shutdown;
- transaction helper;
- idempotency middleware;
- pagination/filter/sort conventions;
- UTC/timezone policy.

Module:

- `identity`;
- `tenancy`;
- `projects`;
- `baseline`;
- `execution`;
- `inventory`;
- `costs`;
- `analysis`;
- `agents`;
- `alerts`;
- `reports`;
- `chat`;
- `notifications`;
- `admin`;
- `audit`.

## 36. Phase 4.2 — Identity, auth, RBAC

- Email/password;
- secure password hashing;
- invitation;
- email verification/reset;
- JWT access;
- refresh rotation;
- token family/revocation;
- session/device metadata;
- brute-force/rate limit;
- Super Admin;
- Company Admin;
- Manager;
- Engineer;
- Site Supervisor;
- Storekeeper;
- Observer;
- project-level membership.

Security:

- tenant/project scope server-derived;
- no client-trusted tenant ID;
- repository/service policy;
- IDOR tests;
- optional PostgreSQL RLS;
- composite tenant/project integrity constraints.

## 37. Phase 4.3 — Canonical database

Requirement-ийн full model:

- Tenant/User/Project/ProjectMember;
- BaselineVersion;
- WorkItem tree;
- WorkDependency;
- Material/MaterialNorm;
- Subcontractor/Calendar;
- DailyReport;
- ProgressEntry;
- AttendanceEntry;
- StockMovement append-only;
- CostEntry;
- AnalysisRun;
- Deviation;
- Alert;
- ScheduleForecast;
- Recommendation;
- AgentRun/AgentToolCall;
- AiDraft;
- EvalCase/EvalResult;
- Report;
- ChatSession/ChatMessage;
- Notification;
- AuditLog;
- FileAsset;
- OutboxEvent.

Invariant:

- baseline immutable version;
- stock append-only;
- correction reverses old movement;
- approved daily report immutable;
- report final immutable;
- tenant consistency;
- decimal exactness;
- provenance.

## 38. Phase 4.4 — Baseline backend

- Excel upload;
- parser;
- column mapping preview;
- validation report;
- import job;
- WBS tree;
- quantity/unit/cost;
- dependency;
- calendar;
- critical path;
- draft baseline;
- approval/lock;
- new version + reason;
- baseline vs current API;
- Gantt query.

## 39. Phase 4.5 — Daily execution backend

- draft daily report;
- text/photo intake;
- A1 asynchronous request;
- A1 draft attach;
- human edit;
- approve/reject;
- approved report transaction;
- progress entries;
- attendance;
- stock movement;
- cost;
- file links;
- duplicate protection;
- offline idempotency;
- return reason;
- audit.

### Transactional event

DailyReport approval нэг transaction дотор:

1. approval/version check;
2. progress/attendance/stock/cost write;
3. audit write;
4. agent read-model update marker;
5. `PROJECT_EXECUTION_APPROVED` outbox event;

үүсгэнэ.

Outbox relay `pg-boss` analysis/A2 queue руу найдвартай илгээнэ.

## 40. Phase 4.6 — Inventory, cost, ledger

- receipt;
- issue;
- transfer if needed;
- reversal;
- current balance derived from ledger;
- reconciliation;
- material norm usage;
- future demand;
- unit price/currency policy;
- labor cost from attendance × rate;
- equipment/subcontractor/other cost;
- source linkage;
- transaction tests.

## 41. Phase 4.7 — Analysis, GoRules, alert

- approved event trigger;
- nightly trigger;
- deterministic metrics;
- GoRules decision evaluation;
- rule version/deploy;
- JDM storage;
- alert dedupe;
- root-cause group;
- lifecycle;
- assignment;
- close note;
- forecast persistence;
- A2 enqueue;
- notification event.

pg-boss:

- analysis/agent workflow;
- retries/schedules.

RabbitMQ:

- notification;
- email/in-app side effect;
- external integration.

Хоёр технологийн responsibility-г холихгүй.

## 42. Phase 4.8 — Agent integration

### A1

- backend file URL/bytes → A1 contract;
- draft persistence;
- human review;
- canonical apply;
- provenance.

### A2

- backend snapshot → `AgentDataProvider`;
- approved event/nightly;
- draft Recommendation persistence;
- decision feedback memory.

### A3

- report request/schedule;
- immutable final;
- PDF to R2;
- approval/diff.

### A4

- backend authorization context;
- ChatSession/Message;
- streaming endpoint;
- rate/cost limit;
- source links.

Agent core Phase 2-оос хойш өөрчлөгдөхгүй; зөвхөн adapters нэмэгдэнэ.

## 43. Phase 4.9 — File storage

- Cloudflare R2;
- presigned upload;
- signed download;
- MIME/magic bytes;
- size/pixel limit;
- malware scan;
- checksum;
- tenant/project object key;
- encryption;
- retention;
- delete;
- orphan cleanup;
- PDF/report storage;
- no unbounded image bytes in PostgreSQL.

## 44. Phase 4.10 — Notification

- RabbitMQ;
- in-app notification;
- email adapter;
- alert;
- approval waiting;
- missing report reminder;
- retry/dead-letter;
- idempotency;
- user preference;
- no duplicate notification.

## 45. Phase 4.11 — Audit ба governance

Audit:

- auth/security;
- role/membership;
- baseline approve/change;
- daily report approve/reject;
- stock reversal;
- alert lifecycle;
- recommendation decision;
- report approve;
- agent run reference;
- rules deploy;
- file access.

AI governance:

- prompt version;
- model version;
- data snapshot;
- sources;
- human decision;
- usage/cost;
- retention;
- export/delete.

## 46. Phase 4.12 — Security

- OWASP Top 10;
- IDOR;
- CSRF strategy;
- CORS;
- CSP;
- secure headers;
- rate limit;
- input/body limit;
- upload security;
- JWT rotation;
- secret manager;
- least privilege;
- DB encryption/TLS;
- dependency/SBOM scan;
- SAST;
- prompt injection;
- data exfiltration;
- audit tamper protection;
- penetration test checklist.

## 47. Phase 4.13 — Performance/NFR

Target:

- API p95 < 400 ms;
- dashboard < 2 sec;
- 50 work item deterministic nightly analysis < 30 sec;
- mobile report ≤ 2 minute;
- ≤ 10 taps;
- no ledger mismatch;
- no tenant leakage.

Хийх:

- indexes/query plan;
- pagination;
- cache where safe;
- background job;
- connection pool;
- load test;
- queue saturation test;
- object upload test;
- OpenAI timeout;
- graceful degradation.

## 48. Phase 4.14 — Observability

- JSON logs;
- Sentry;
- OpenTelemetry;
- Langfuse;
- API metrics;
- queue depth;
- job latency;
- DB pool;
- RabbitMQ;
- storage;
- agent tokens/cost;
- grounding rejection;
- alert false-positive feedback;
- dashboard/alerts;
- incident runbook.

## 49. Phase 4.15 — Deployment

- Frontend: Vercel;
- Backend/workers: Render;
- PostgreSQL managed;
- RabbitMQ managed/service;
- Langfuse approved deployment;
- R2;
- staging;
- production;
- secret manager;
- migration deploy;
- backup/PITR;
- restore drill;
- canary/rollback;
- domain/TLS;
- CI/CD.

CI gate:

1. format/lint/typecheck;
2. unit/integration;
3. deterministic evaluation;
4. live evaluation policy;
5. migration check;
6. security scan;
7. build;
8. staging deploy;
9. E2E;
10. production approval.

## 50. Phase 4.16 — Frontend integration

- Remove MSW production handler.
- Generated client points to real API.
- Contract test.
- Auth/session.
- signed upload.
- offline sync.
- conflict UX.
- A1 review.
- A2 decision.
- A3 report.
- A4 streaming.
- admin/rules.
- full role E2E.

## 51. Full Production Gate — Phase 4 exit

### Core

- [ ] Excel baseline import + lock/version.
- [ ] Calendar-aware critical path.
- [ ] Daily report mobile ≤ 2 минут.
- [ ] Offline no-data-loss.
- [ ] Attendance/material/stock/cost.
- [ ] Append-only ledger reconciliation.
- [ ] 7 required rule + transparent alert.
- [ ] JDM Editor rule update.
- [ ] Projected finish + delay propagation.
- [ ] System never auto-changes schedule.

### AI

- [ ] Agent Production Gate хэвээр pass.
- [ ] A1 real backend flow.
- [ ] A2 event/nightly + deterministic impact.
- [ ] A3 immutable report/PDF.
- [ ] A4 source-backed read-only.
- [ ] Number hallucination reject.
- [ ] LLM-off core flow.
- [ ] Langfuse trace/usage.

### Security/NFR

- [ ] Two-tenant API/agent/chat isolation 100%.
- [ ] OWASP/security checklist.
- [ ] API p95 target.
- [ ] Dashboard target.
- [ ] Queue restart/replay.
- [ ] Backup restore.
- [ ] Cost budget.
- [ ] Audit coverage.

### Дипломын нотолгоо

- [ ] 12-week simulation report.
- [ ] Recall.
- [ ] Precision.
- [ ] Early detection days.
- [ ] Forecast accuracy.
- [ ] Human edit percentage.
- [ ] Unsupported factual claim 0.
- [ ] ER diagram.
- [ ] Architecture diagram.
- [ ] 6+ ADR.
- [ ] Live deployed link.

---

## 52. Нэн түрүүнд хийх дараагийн 20 ажил

Backend/frontend рүү орохоос өмнөх agent P0:

1. Requirement traceability matrix.
2. Agent-first architecture ADR.
3. GoRules decision ADR.
4. Full `DailyReportDraftV1`.
5. Full `ProjectAnalysisSnapshotV1`.
6. Agent ports/interfaces.
7. 40–60 work item simulation generator.
8. 12-week execution generator.
9. Material/attendance/stock/subcontractor fixture.
10. Calendar-aware CPM.
11. Actual pace forecast.
12. 7 required rules.
13. Deterministic recommendation scenario engine.
14. Missing 7 tools.
15. A1 text review/apply harness.
16. A1 100+ text dataset.
17. A1 60+ image dataset.
18. A2 30+ scenario evaluation.
19. A3 20+ / A4 80+ datasets.
20. Agent Docker/runtime/usage/trace hardening.

Эдгээрээс 4–14 дуусаагүй байхад A2-г requirement-ийн бодит production agent гэж үзэх боломжгүй.

---

## 53. Одоохондоо хийхгүй байх зүйлс

- A2-д зураг шууд уншуулахгүй; зураг A1-ийн үүрэг.
- LLM-д raw SQL өгөхгүй.
- LLM-д critical path/forecast/impact days бодуулахгүй.
- Human approval-гүй schedule/financial write хийхгүй.
- Vector DB нэмэхгүй.
- Agent framework зөвхөн “agent харагдуулах” зорилгоор нэмэхгүй.
- Frontend Phase 3-аас өмнө эхлэхгүй.
- Backend Phase 4-өөс өмнө full API/auth хийхгүй.
- Phase 3 mock response-ийг shared contract-аас зөрүүлж зохиохгүй.
- Current 25/3/3/6 golden suite-ийн 100%-ийг production complete гэж нэрлэхгүй.
- Seed/evaluation data-г production database-д ажиллуулахгүй.
- Fixed `2026-03-01` as-of production schedule-д ашиглахгүй.
- Local `data/reports`-ийг production storage гэж үзэхгүй.
- Image bytes-ийг хязгааргүй PostgreSQL-д хадгалахгүй.
- OpenAI API key-г frontend рүү гаргахгүй.

---

## 54. Гол эрсдэл ба бууруулах арга

| Эрсдэл                          | Нөлөө                          | Бууруулах арга                                               |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| Agent-first нь backend data-гүй | Agent contract буруу болох     | Full simulation + versioned provider contract                |
| Frontend backend-ээс өмнө       | API rework                     | OpenAPI/Zod contract + generated client + MSW                |
| Requirement domain маш том      | Phase 4 хэт томрох             | Agent read-model ба backend canonical model-ийн хил тодорхой |
| Golden dataset жижиг            | Хуурамч 100%                   | Requirement хэмжээний dataset, hidden test                   |
| Vision false claim              | Хүний буруу шийдвэр            | Signal/question only, false accusation metric                |
| LLM quota/cost                  | Worker failure                 | Budget, circuit breaker, deterministic fallback              |
| Tool tenant leak                | Critical security              | Principal scope inside tool + adversarial tests              |
| Recommendation impact зохиомол  | Schedule буруу                 | Deterministic scenario engine                                |
| Rule mismatch                   | Alert чанар муу                | GoRules version + boundary tests + explanation               |
| Frontend offline conflict       | Data duplicate/loss            | Idempotency key, outbox, conflict UX                         |
| Artifact local storage          | Deploy/restart дээр алга болно | ArtifactStore port → R2 adapter                              |
| Current dependency `latest`     | Unexpected regression          | Pin + lockfile + update policy                               |
| Production seed execution       | Бодит data устах               | Hard production guard + separate DB                          |

---

## 55. Эцсийн дүгнэлт

Одоогийн A1–A4 prototype нь сайн хамгаалалттай agent **суурь** болсон:

- tool scope;
- deterministic analysis;
- numeric grounding;
- structured outputs;
- queue;
- tests;
- live OpenAI verification;

байна.

Гэхдээ requirement-ийн production agent болохын тулд хамгийн том дутуу зүйлс:

1. full construction domain snapshot;
2. full daily report A1 schema;
3. 11 tool;
4. required 7 rule;
5. actual projected finish;
6. deterministic recommendation impact;
7. human decision memory;
8. production-size golden dataset;
9. runtime/cost/trace/version hardening;

юм.

Тиймээс зөв дараалал:

```text
Phase 1: Agent data foundation + A1
    ↓
Phase 2: A2–A4 + evaluation + production hardening
    ↓  AGENT PRODUCTION GATE
Phase 3: Frontend contract-first
    ↓
Phase 4: Backend + integration + deploy
    ↓  FULL SYSTEM PRODUCTION GATE
```

Энэ дарааллаар явбал frontend/backend эхлэх үед agent-ийн behavior, schema, source, evaluation тогтвортой болсон байна. Phase 4-д agent-ийг дахин зохиохгүй, зөвхөн production adapter болон business workflow-той холбоно.
