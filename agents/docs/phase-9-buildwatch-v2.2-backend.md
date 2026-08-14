# BuildWatch v2.2 — Phase 9 canonical backend, auth, database ба events

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase9:v22:gate`  
**System of record:** PostgreSQL 16 + Prisma 7  
**API:** Express 5 + OpenAPI 3.1

## 1. Зорилго

Phase 9 нь Phase 0–8-ийн contract, deterministic service, tool orchestration-ийг
production system-of-record-той холбосон canonical backend boundary юм. Энэ
үеэс батлагдсан өгөгдөл файл эсвэл in-memory state биш PostgreSQL-д хадгалагдана.

Үндсэн урсгал:

```text
JWT principal
→ tenant/project RBAC
→ review decision
→ approved immutable version
→ SERIALIZABLE command transaction
→ canonical write + audit + outbox + idempotency
→ pg-boss/RabbitMQ fan-out
→ A0–A5 versioned adapter
```

AI model нь canonical хүснэгтэд шууд бичихгүй. Зөвхөн хүний баталсан version-д
хамаарах idempotent command write boundary-г давна.

Production persistence adapter нь `PrismaPhase9Store`; unit/evaluation орчин нь
ижил transaction contract хэрэгжүүлсэн `InMemoryPhase9Store` ашиглана.

## 2. Backend module ба ownership

| Domain                | Canonical ownership                                                |
| --------------------- | ------------------------------------------------------------------ |
| identity/tenants      | User, credential, invitation, session, tenant                      |
| projects              | Project, ProjectMember, project-scoped authorization               |
| artifacts             | FileAsset, object key, SHA-256, signed access                      |
| design                | Document, revision, page, scale, element, geometry, source         |
| quantity/catalogs     | Versioned takeoff, material, norm, productivity, price             |
| estimates/baselines   | Estimate, schedule, activity, dependency, baseline                 |
| resources/planning    | Crew, equipment, availability, daily plan                          |
| execution             | Daily report, progress, attendance, stock ledger, photo            |
| verification/forecast | Verification, variance, forecast, recovery                         |
| review/audit          | Matrix, task, decision, correction, immutable audit                |
| integration           | Idempotency, applied command, outbox, consumed event, notification |
| agents                | Tenant-scoped `AgentToolReadModel`, A0–A5 adapter registry         |

`prisma/schema.prisma` нь legacy model-уудыг эвдэхгүйгээр Phase 9-ийн canonical
model-уудыг нэмсэн. Migration нь Phase 8→9 diff-ийн бүх `73` шинэ хүснэгт,
`16` enum-ийг агуулж, destructive `DROP TABLE/TYPE` огт агуулаагүй.

## 3. Prisma migration waves

| Wave | Хэрэгжсэн aggregate                                                          |
| ---- | ---------------------------------------------------------------------------- |
| A    | DesignDocument, DrawingRevision/Page/Scale, DesignElement/Geometry/SourceRef |
| B    | Quantity version/item/adjustment, material/norm/productivity/price, estimate |
| C    | Schedule version/activity/dependency, resource requirement, crew/equipment   |
| D    | Daily plan, daily report, progress, attendance, stock, photo evidence        |
| E    | Verification, variance, forecast, recovery, review, audit, outbox            |

Нэмэлт identity/integration aggregate:

- `User`, `UserCredential`, `TenantInvitation`, `ProjectMember`;
- `RefreshSession`, `SecurityToken`;
- `FileAsset`, `ArtifactAccessGrant`;
- `IdempotencyRecord`, `AppliedCommand`, `ConsumedEvent`, `Notification`;
- `AgentToolReadModel`.

## 4. Database invariant

| Дүрэм                      | Хэрэгжилт                                                        |
| -------------------------- | ---------------------------------------------------------------- |
| Tenant/project isolation   | composite unique/index + ownership foreign key                   |
| Approved version immutable | PostgreSQL trigger, 12 version aggregate                         |
| Ledger/audit append-only   | PostgreSQL trigger, 6 ledger/decision aggregate                  |
| Reversal                   | `StockMovement.reversalOfId`, сөрөг засварыг шинэ мөрөөр         |
| Duplicate command          | tenant-scoped unique idempotency key                             |
| Concurrent review          | `rowVersion` optimistic compare-and-swap                         |
| Atomic write               | Prisma `SERIALIZABLE` transaction                                |
| Reliable event             | canonical write ба `OutboxEvent` нэг transaction                 |
| Object storage             | relational row-д metadata/object key/hash; raw artifact бичихгүй |
| Retention                  | status/deleted/expiry metadata-аар lifecycle тусгаарласан        |

Migration нийт `18` invariant trigger суулгасан. Бодит PostgreSQL smoke нь
append-only `AuditLog` UPDATE-г database түвшинд хориглож, зориудаар унагасан
transaction-аас Tenant болон Outbox мөр хоёулаа `0` үлдсэнийг баталсан.

## 5. Auth ба seven-role RBAC

Canonical role яг долоо:

| Role              | Гол эрх                                                 |
| ----------------- | ------------------------------------------------------- |
| `SUPER_ADMIN`     | tenant/project/admin/approval/audit бүх эрх             |
| `COMPANY_ADMIN`   | компанийн user, project, approval, audit удирдах        |
| `PROJECT_MANAGER` | оноогдсон project-ийн approval/apply/audit              |
| `ENGINEER`        | design approve, project/report/forecast read, agent run |
| `SITE_SUPERVISOR` | талбайн plan/report/verification/inventory read         |
| `STOREKEEPER`     | inventory read/write, plan/report read                  |
| `OBSERVER`        | зөвхөн оноогдсон project-ийн read-only харагдац         |

Auth урсгал:

1. имэйлийг canonical хэлбэрт normalize хийнэ;
2. password-ийг random salt бүхий `scrypt`-ээр hash хийнэ;
3. login rate/account lock шалгана;
4. богино настай access JWT ба нэг удаагийн refresh JWT олгоно;
5. refresh бүр шинэ session/token үүсгэж хуучныг rotate хийнэ;
6. ашиглагдсан refresh token дахин ирвэл бүх family-г revoke хийнэ;
7. invitation token зөвхөн hash-аар хадгалагдана;
8. invitation acceptance нь user болон project assignment-ийг transaction-аар үүсгэнэ.

JWT нь HS256, fixed issuer/audience/kid/token-use, хугацаа, session болон
`tokenVersion`-ийг шалгана. Production орчинд JWT, cursor, artifact signer-ийн
гурван secret заавал тусдаа байна.

Project authorization амжилтгүй үед existence leakage гаргахгүйгээр ижил
`PROJECT_NOT_FOUND` хариу өгнө. Two-tenant IDOR test нь project, audit болон
artifact endpoint-ээр нөгөө tenant-ийн marker задраагүйг баталсан.

## 6. HTTP API contract

| Method | Endpoint                                                   | Үүрэг                         |
| ------ | ---------------------------------------------------------- | ----------------------------- |
| GET    | `/health/live`                                             | process liveness              |
| GET    | `/health/ready`                                            | PostgreSQL readiness          |
| GET    | `/openapi.json`                                            | OpenAPI 3.1 contract          |
| POST   | `/v1/auth/login`                                           | access/refresh token          |
| POST   | `/v1/auth/refresh`                                         | refresh rotation              |
| POST   | `/v1/auth/logout`                                          | session revoke                |
| POST   | `/v1/invitations/accept`                                   | invitation acceptance         |
| POST   | `/v1/invitations`                                          | tenant admin invitation       |
| GET    | `/v1/projects`                                             | signed cursor pagination      |
| GET    | `/v1/projects/:projectId`                                  | authorized project detail     |
| POST   | `/v1/projects/:projectId/reviews/:reviewTaskId/decisions`  | approve/reject                |
| POST   | `/v1/projects/:projectId/approved-commands`                | approved version apply        |
| GET    | `/v1/projects/:projectId/versions/compare`                 | immutable version diff        |
| GET    | `/v1/projects/:projectId/forecast/latest`                  | latest deterministic forecast |
| GET    | `/v1/projects/:projectId/audit`                            | project audit rows            |
| POST   | `/v1/projects/:projectId/artifacts/:artifactId/signed-url` | short-lived URL               |
| GET    | `/v1/artifacts/:artifactId/content`                        | signed object read            |

API нь:

- strict Zod request/response contract;
- stable error envelope + correlation ID;
- 2 MB JSON body limit;
- security headers;
- opaque HMAC cursor;
- `Idempotency-Key` header;
- generated-style typed client;
- object path traversal, size, SHA-256 шалгалттай.

## 7. Review ба approved command transaction

Review decision дараах хамгаалалттай:

- required role/assigned user;
- self-approval хориг;
- explicit emergency override;
- expected `rowVersion`;
- decision + audit + outbox + idempotency нэг transaction.

Approved command дараах дарааллаар ажиллана:

1. tenant/project membership болон target permission шалгах;
2. idempotency replay/conflict шалгах;
3. review task `APPROVED` эсэхийг шалгах;
4. creator/approver separation шалгах;
5. approved canonical version-ийг server талаас дахин унших;
6. type/version/status/source hash-ийг command-тай тулгах;
7. client payload-ийг authoritative гэж ашиглахгүй;
8. review state-г `APPLIED` болгох;
9. AppliedCommand, AuditLog, OutboxEvent, IdempotencyRecord үүсгэх;
10. бүгдийг `SERIALIZABLE` transaction-аар commit хийх.

Ижил key + ижил request нь `REPLAYED`; ижил key + өөр request нь
`IDEMPOTENCY_CONFLICT` болно.

## 8. Artifact security

Signed URL нь tenant, project, user, expiry, nonce, artifact SHA-256-д HMAC-аар
холбогдоно. URL resolve хийх мөчид user status, project membership, RBAC,
expiry, signature-ийг дахин шалгана. Object store reader нь configured root-оос
гаднах path, хэмжээ зөрүү болон hash зөрүүг хориглоно.

## 9. Outbox, pg-boss ба RabbitMQ

Outbox relay нь мөрийг lock хийж, publish амжилттай бол `PUBLISHED`, алдаа гарвал
exponential retry, stale lock бол restart/replay хийдэг. RabbitMQ publisher нь
durable topic exchange, confirm channel, persistent message, event ID message-id
ашиглана.

pg-boss job `8/8`:

1. A0 design parse/extract;
2. quantity recalculation;
3. A5 daily plan;
4. A1 evening reminder;
5. progress verification;
6. rolling forecast;
7. A2 observation;
8. A3 report.

Phase 9 queue нэрс бүгд `buildwatch-v22-phase9-*` namespace-тэй. Legacy
A1–A5 queue нэртэй overlap `0`, тиймээс өөр payload schema бүхий хуучин worker
санамсаргүй job авахгүй. `registerPhase9JobWorkers` нь найман consumer-ийг,
`phase9JobRunnersFromAdapters` нь purpose→A0–A5 mapping-ийг үүсгэнэ.

`ConsumedEvent` unique key болон canonical transaction нь broker-ийн at-least-once
delivery-д side effect-ийг нэг удаа л ажиллуулна. A4 нь queue consumer биш,
request-scoped read-only adapter хэвээр байна.

## 10. A0–A5 production adapters

- A0, A1, A2, A3, A5: `JOB`, transactional consumer deduplication;
- A4: `REQUEST`, read-only;
- embedded tenant/project нь envelope scope-тэй заавал таарна;
- adapter бүр version-тэй;
- registry A0–A5 зургаан adapter бүгд байхгүй бол startup-г хориглоно;
- `PrismaPhase8ReadRepository` нь explicit tenant + assigned project scope-оор
  `AgentToolReadModel` уншина;
- read-model record бүр source hash integrity шалгалттай.

A0–A5 production adapters: `6/6`. Phase 8-ийн deterministic orchestration болон
Phase 9-ийн canonical persistence boundary хооронд injection contract бүрэн байна.

## 11. Ажиллуулах тохиргоо

`.env`-д дор хаяж:

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5434/diplom_agents?schema=public
PHASE9_API_HOST=127.0.0.1
PHASE9_API_PORT=4180
PHASE9_PUBLIC_BASE_URL=http://127.0.0.1:4180
PHASE9_DEVELOPMENT_SECRET=at-least-32-random-bytes-for-local-only
PHASE9_ARTIFACT_ROOT=data/artifacts
```

Production-д `PHASE9_JWT_SECRET`, `PHASE9_CURSOR_SECRET`,
`PHASE9_ARTIFACT_SIGNING_SECRET` гурвыг тусдаа random secret-ээр өгнө.
`RABBITMQ_URL` хоосон бол pg-boss ажиллана; тохируулбал RabbitMQ fan-out нэмэгдэнэ.

Local дараалал:

```powershell
pnpm.cmd docker:up
pnpm.cmd run db:migrate:deploy
pnpm.cmd run bootstrap:phase9 -- --tenant tenant-demo
pnpm.cmd run api:v22
pnpm.cmd run worker:phase9
```

Анхны production tenant хараахан байхгүй бол explicit opt-in ашиглана. Tenant,
company admin credential болон audit log нэг transaction-д үүснэ:

```powershell
$env:PHASE9_BOOTSTRAP_EMAIL = "admin@example.com"
$env:PHASE9_BOOTSTRAP_PASSWORD = "<12+ character secret>"
pnpm.cmd run bootstrap:phase9 -- --tenant company-slug --create-tenant --tenant-name "Company Name"
```

`--create-tenant` байхгүй үед үл мэдэгдэх tenant slug fail-closed алдаа өгнө.

API: `http://127.0.0.1:4180`  
OpenAPI: `http://127.0.0.1:4180/openapi.json`

## 12. Баталгаажуулалтын үр дүн

- Prisma validate/generate: `PASS`;
- Phase 8→9 migration diff: `73` table, `16` enum, missing `0`, destructive drop `0`;
- Backend tests: `25/25`;
- Golden cases: `10/10 PASS`;
- Seven-role coverage: `100.00%`;
- A0–A5 adapter coverage: `100.00%`;
- tenant-isolation violation: `0`;
- duplicate command/consumer side effect: `0/0`;
- PostgreSQL smoke: `7/7 PASS`;
- invariant triggers: `18/18`;
- production API database readiness: `PASS`;
- production OpenAPI contract: `PASS`.

Evidence:

- `data/evaluations/buildwatch-v22-phase9-backend.json`;
- `data/evaluations/buildwatch-v22-phase9-backend.md`;
- `data/evaluations/buildwatch-v22-phase9-postgres.json`.

## 13. Exit gate checklist

- [x] Canonical identity model нэмсэн.
- [x] Canonical tenant/project model өргөтгөсөн.
- [x] Project ownership composite foreign key нэмсэн.
- [x] Tenant/project composite indexes нэмсэн.
- [x] Design intake Wave A model бүрэн.
- [x] Quantity/catalog/estimate Wave B model бүрэн.
- [x] Schedule/resource Wave C model бүрэн.
- [x] Planning/execution Wave D model бүрэн.
- [x] Verification/forecast/review Wave E model бүрэн.
- [x] File artifact object reference model бүрэн.
- [x] Raw artifact binary-г шинэ canonical row-д хадгалахгүй.
- [x] Approved version immutable trigger бүрэн.
- [x] Ledger/audit append-only trigger бүрэн.
- [x] Stock reversal reference бүрэн.
- [x] Optimistic row version бүрэн.
- [x] Tenant-scoped idempotency unique key бүрэн.
- [x] Actor/time/reason/correlation audit бүрэн.
- [x] SERIALIZABLE Prisma transaction бүрэн.
- [x] Transactional outbox бүрэн.
- [x] Email/password login бүрэн.
- [x] Salted scrypt password бүрэн.
- [x] Invitation create/accept бүрэн.
- [x] Seven-role RBAC бүрэн.
- [x] JWT access token validation бүрэн.
- [x] Refresh rotation/reuse revoke бүрэн.
- [x] Project assignment authorization бүрэн.
- [x] Design/estimate/plan/report/verification permission тусгаарласан.
- [x] Self-approval guard бүрэн.
- [x] Two-tenant API IDOR guard бүрэн.
- [x] OpenAPI 3.1 contract бүрэн.
- [x] Typed generated-style client бүрэн.
- [x] Stable API error envelope бүрэн.
- [x] Correlation ID бүрэн.
- [x] Signed cursor pagination бүрэн.
- [x] Idempotency-Key boundary бүрэн.
- [x] Review decision endpoint бүрэн.
- [x] Approved command endpoint бүрэн.
- [x] Version comparison endpoint бүрэн.
- [x] Forecast endpoint бүрэн.
- [x] Audit endpoint бүрэн.
- [x] Signed artifact URL бүрэн.
- [x] Object path/size/hash guard бүрэн.
- [x] pg-boss найман job definition бүрэн.
- [x] Phase 9 queue namespace legacy-гаас тусгаарлагдсан.
- [x] Найман consumer registration test бүрэн.
- [x] RabbitMQ confirm publisher бүрэн.
- [x] Outbox retry/dead-letter/replay бүрэн.
- [x] Stale lock recovery бүрэн.
- [x] Consumer duplicate side effect guard бүрэн.
- [x] A0 production adapter бүрэн.
- [x] A1 production adapter бүрэн.
- [x] A2 production adapter бүрэн.
- [x] A3 production adapter бүрэн.
- [x] A4 request-scoped read-only adapter бүрэн.
- [x] A5 production adapter бүрэн.
- [x] Canonical AgentToolReadModel бүрэн.
- [x] Read-model tenant/project query scope бүрэн.
- [x] Read-model integrity hash бүрэн.
- [x] Prisma migration local PostgreSQL-д deploy болсон.
- [x] PostgreSQL table/trigger smoke бүрэн.
- [x] PostgreSQL atomic rollback smoke бүрэн.
- [x] Production Express readiness smoke бүрэн.
- [x] Backend golden evaluation 10/10.
- [x] Backend regression 25/25.

**PHASE 9 EXIT GATE: PASS**

## 14. Phase 9-ийн хил

Production React/PWA дэлгэц, offline IndexedDB outbox, Gantt/dashboard болон
role-based route UI нь Phase 10-ын ажил. Performance, OWASP penetration,
deployment/backup/observability release gate нь Phase 11-д хамаарна. Эдгээрийг
Phase 9 backend-ийн PASS үр дүнд оруулж тооцоогүй.
