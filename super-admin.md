# BuildWatch Super Admin Control Tower

## Эцсийн функционал, UX ба архитектурын тодорхойлолт

**Баримтын төлөв:** Final implementation specification  
**Хувилбар:** 2.2  
**Огноо:** 2026-08-11  
**Систем:** ATLAS / BuildWatch  
**Үндсэн зорилго:** Платформын tenant, AI ажиллагаа, review backlog, хэрэглээ, найдвартай байдал, security болон audit-ийг нэг төвөөс хянах

---

## 1. Шийдвэрийн хураангуй

BuildWatch-ийн Super Admin хэсэг нь барилгын төслийн dashboard биш, **AI Operations Control Tower** байна.

Super Admin дараах асуултуудад хурдан, нотолгоотой хариулт авна:

1. Платформ яг одоо хэвийн ажиллаж байна уу?
2. Ямар tenant, agent эсвэл service дээр асуудал үүсэв?
3. Ямар асуудал хамгийн түрүүнд хүний оролцоо шаардаж байна?
4. AI output-ийн найдвартай байдал, latency, failure болон зардал хэр өөрчлөгдөв?
5. Human review урсгал хаана саатав?
6. Ямар critical action-ийг хэн, хэзээ, ямар шалтгаанаар хийв?

Энэ баримтын үндсэн архитектурын шийдвэр:

> **Platform Super Admin нь tenant-level “хамгийн том эрхтэй хэрэглэгч” биш. Тэр platform-level, default read-only, бүрэн audit-тай тусдаа principal байна.**

---

## 2. Одоогийн BuildWatch-тай нийцэл ба заавал засах gap

Одоогийн repository-г шалгахад дараах зүйлс баталгаажсан:

- `User` нь `tenantId`, `tenantRole`-той tenant-scoped model.
- `SUPER_ADMIN` болон `COMPANY_ADMIN` одоогоор ижил operational permission-тэй.
- Хоёр role project membership-ээс үл хамааран tenant-ийн project-уудад effective role болдог.
- Одоогийн frontend бүх role-ийг `/projects` flow руу оруулж project switcher харуулдаг.
- `AgentRun`, `AgentToolCall`, `AgentFeedback`, `ReviewTask`, `AuditLog`, `OutboxEvent`, `Notification` зэрэг Control Tower-д ашиглаж болох model бий.
- `AgentUsageBudget` нь ашигласан сарын зардал хадгалдаг боловч budget limit field одоогоор байхгүй.
- `ReviewTask` дээр priority field одоогоор байхгүй.

Иймээс Control Tower UI хийхээс өмнө:

1. Platform principal-ийг tenant role-оос салгана.
2. Platform permission-ийг tenant/project permission-ээс салгана.
3. Super Admin-аас operational mutation permission-ийг API түвшинд хасна.
4. Cross-tenant aggregate API-г тусдаа namespace/read-model-оор хэрэгжүүлнэ.
5. Platform audit болон tenant isolation regression test нэмнэ.

Энэ бол UI enhancement биш, security prerequisite.

---

## 3. Үүргийн тодорхой зааг

### 3.1 Platform Super Admin

Platform Super Admin:

- Бүх tenant-ийн техникийн health болон aggregate usage харна.
- AI agent, run, failure, latency, version болон quality-г хянана.
- Review backlog болон SLA зөрчлийг платформын түвшинд хянана.
- API, database, queue, storage, notification, AI provider-ийн health харна.
- Platform audit, security event, integration болон operational setting удирдана.
- Critical action хийхдээ reason, step-up authentication болон audit шаардлагыг мөрдөнө.
- Tenant-ийн business content-д default-аар нэвтрэхгүй.

### 3.2 Company Admin

Company Admin:

- Зөвхөн өөрийн tenant/company-г удирдана.
- Компанийн хэрэглэгч, invitation, role болон project assignment удирдана.
- Компанийн бүх төслийн portfolio KPI, budget, schedule, risk болон approval харна.
- Компанийн түвшний usage болон audit харна.
- Operational workflow-д өөрийн tenant permission-ийн хүрээнд оролцоно.
- Platform role grant/revoke хийхгүй.

### 3.3 Project roles

`PROJECT_MANAGER`, `ENGINEER`, `SITE_SUPERVISOR`, `STOREKEEPER`, `OBSERVER` нь зөвхөн оноосон project болон permission-ийн хүрээнд ажиллана.

### 3.4 Role boundary matrix

| Чадвар | Platform Super Admin | Company Admin | Project role |
|---|---|---|---|
| Бүх tenant-ийн health харах | Тийм | Үгүй | Үгүй |
| Өөрийн tenant-ийн portfolio харах | Diagnostic summary | Тийм | Assignment-аар |
| BOQ, schedule, daily report засах | **Үгүй** | Permission-аар | Permission-аар |
| Engineering review батлах | **Үгүй** | Permission-аар | Permission-аар |
| AI production health харах | Бүх tenant | Өөрийн tenant | Өөрийн project |
| Agent pause/maintenance | Тусгай эрх + audit | Үгүй | Үгүй |
| Platform system health | Тийм | Үгүй | Үгүй |
| Company user/role удирдах | Support scope-оор | Тийм | Үгүй |
| Platform audit | Тийм | Үгүй | Үгүй |
| Tenant audit | Diagnostic metadata | Өөрийн tenant | Permission-аар |

### 3.5 Super Admin-ийн non-goals

Super Admin UI болон API-аас:

- BOQ, quantity, estimate line засахгүй.
- Schedule, baseline, daily plan өөрчлөхгүй.
- Daily report үүсгэх, засах, батлахгүй.
- Material stock хөдөлгөөн хийхгүй.
- Progress/photo verification батлахгүй.
- Engineering decision override хийхгүй.
- Tenant document/file content-ийг үндэслэлгүйгээр нээхгүй.
- Company Admin-ийн өдөр тутмын ажлыг орлохгүй.

Frontend дээр action нуух нь хангалтгүй. Шууд operational API дуудсан ч `403` буцаана.

---

## 4. Мэдээллийн архитектур

### 4.1 Sidebar

```text
CONTROL TOWER
└── Control Tower

TENANT MANAGEMENT
├── Companies
└── Users & Access

AI OPERATIONS
├── Agents & Runs
└── Review & Quality

PLATFORM
├── Usage & Limits
├── System Health
└── Audit & Security

SETTINGS
└── Platform Settings
```

Давхардлыг дараах байдлаар хасна:

- `Attention Required` нь Control Tower-ийн үндсэн блок; бүх issue нь `/platform/incidents` руу drill-down хийнэ.
- `AI Runs` нь Agents & Runs дотор tab/filter байна.
- `AI Quality` нь Review & Quality дотор tab байна.
- `Integrations` нь Platform Settings дотор configuration tab; health нь System Health дээр байна.
- Tenant, agent, run, incident detail нь sidebar menu биш drill-down page байна.
- `Projects`, `BOQ`, `Schedule`, `Daily Reports`, `Materials` Super Admin sidebar-д байхгүй.

### 4.2 Default landing ба shell

- Platform Super Admin нэвтрэхэд `/platform` нээгдэнэ.
- Project switcher харагдахгүй.
- Tenant user-ийн `AppShell`-ээс тусдаа `PlatformShell` ашиглана.
- Company Admin болон project role `/projects` flow-оо хэвээр ашиглана.

### 4.3 Global controls

- Time window: `24 цаг`, `7 хоног`, `30 хоног`, custom range
- Tenant filter: default `All tenants`
- Agent filter
- Environment: production/staging, бодитоор олон environment байгаа үед
- Last refreshed timestamp
- Manual refresh
- Auto-refresh state
- Timezone: `Asia/Ulaanbaatar`

Metric бүр time window, data freshness болон sample size-тэй байна.

---

## 5. Control Tower screen specification

### 5.1 Үндсэн layout

```text
CONTROL TOWER PAGE
│
├── Header
│   ├── Time range
│   ├── Tenant filter
│   ├── Agent filter
│   ├── Environment
│   ├── Last refreshed
│   └── Manual / auto refresh
│
├── Platform Status + top causes
│
├── KPI Row
│   ├── Critical Issues
│   ├── Tenant Health
│   ├── Agent Completion
│   ├── Review SLA
│   └── AI Spend
│
├── Primary Action Row
│   ├── Attention Required
│   └── System Health
│
├── Tenant Health
│
├── AI Operations Row
│   ├── Agents & Runs
│   └── Human Review Monitor
│
├── Quality & Usage Row
│   ├── AI Quality
│   └── Usage & Cost
│
└── Recent Audited Changes
```

### 5.2 Desktop hierarchy

- `Attention Required` хамгийн өргөн үндсэн panel байна.
- `System Health` түүнтэй зэрэгцсэн compact status panel байна.
- `Tenant Health` table бүтэн мөр эзэлнэ.
- `Agents & Runs`, `Human Review Monitor` зэрэгцэнэ.
- `AI Quality`, `Usage & Cost` хангалттай data/history байгаа үед зэрэгцэнэ.
- Critical/High issue, stale/unknown state page-ийн доод хэсэгт нуугдахгүй.
- Dashboard card бүр data source, time window, freshness болон drill-down action-той байна.

### 5.3 Mobile/tablet hierarchy

1. Platform Status
2. Attention Required
3. Critical System Health
4. KPI summary
5. Tenant/Agent monitoring
6. Quality/usage detail

Том table responsive column priority эсвэл detail drawer ашиглана.

---

## 6. Platform Status ба KPI contract

### 6.1 Platform Status

MVP-д тайлбарлахад хүндрэлтэй `0–100` нийлмэл score ашиглахгүй.

- `HEALTHY` — critical/high active issue байхгүй, гол service хэвийн
- `DEGRADED` — high issue, SLA breach эсвэл гол бус service доголдолтой
- `CRITICAL` — API/database unavailable, tenant outage, data-loss/security эрсдэлтэй
- `UNKNOWN` — metric хуучирсан эсвэл collector ажиллаагүй

Status нь хамгийн ноцтой active condition-оор тогтоно. Нэг critical dependency offline байхад бусад metric-тэй дундажлан `Healthy` болгохгүй.

Status-ийн доор хамгийн ихдээ гурван top cause харуулна.

### 6.2 Action-oriented Top KPI

| KPI | Үндсэн утга | Нэмэлт context | Одоогийн/санал болгосон source |
|---|---|---|---|
| Critical Issues | `2 open` | Oldest unacknowledged | Derived signal; Phase 2-оос `PlatformIncident` |
| Tenant Health | `16 / 18 healthy` | 1 critical, 1 warning | Tenant + incident aggregate |
| Agent Completion | `95.8%` | Failed/degraded/rejected + sample | `AgentRun` |
| Review SLA | `3 breached` | 14 waiting, oldest 2h 34m | `ReviewTask` |
| AI Spend | `$184 MTD` | Actual/estimated coverage | `AgentRun` |

Secondary metric:

- Companies total
- Last 24h-д нэвтэрсэн хэрэглэгч
- Last 24h run count
- Pending reviews
- Storage used bytes

`User` model зөвхөн `lastLoginAt` хадгалдаг тул “Active Users” гэж нэрлэхгүй.

### 6.3 Agent Completion formula

```text
COMPLETED / (COMPLETED + FAILED + DEGRADED + REJECTED)
```

- `RUNNING` denominator-т орохгүй.
- Хүлээгдэж буй хугацаанаас хэтэрсэн `RUNNING` нь `stuck run` issue болно.
- `FAILED`, `DEGRADED`, `REJECTED` detail дээр тусдаа харагдана.
- Percentage metric minimum sample-тай байна.

### 6.4 Review SLA formula

Waiting:

```text
status = REVIEW_REQUIRED
```

SLA breached:

```text
status = REVIEW_REQUIRED
AND dueAt IS NOT NULL
AND dueAt < now
```

`DRAFT` task-ийг human review backlog-д тооцохгүй.

### 6.5 AI Spend formula

Run бүр дээр:

```text
actualCostMicroUsd байвал actual
үгүй бол estimatedCostMicroUsd
```

- Estimated data-ийн эзлэх хувийг харуулна.
- Currency, provider pricing version, time window тодорхой байна.
- Одоогийн `AgentUsageBudget` model-д limit field байхгүй тул `$184 / $300` мэт progress үзүүлэхгүй.
- Limit model нэмэгдсэний дараа 80%, 90%, 100% alert хэрэглэнэ.

---

## 7. Dashboard module-ууд

### 7.1 Attention Required

Issue бүр:

- Incident ID
- Severity: `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`
- State
- Title болон impact
- Tenant/platform scope
- Нөлөөлсөн agent/service
- First seen / last seen / duration
- Owner
- Trigger/evidence
- Recommended next action
- Diagnostics deep link
- Data freshness

Lifecycle:

```text
OPEN → ACKNOWLEDGED → RESOLVED
  └───────────────→ REOPENED
```

Default sort:

1. Severity
2. Unacknowledged state
3. SLA breach
4. Duration

MVP trigger:

- API/database readiness failure
- Outbox `DEAD_LETTER`
- Oldest pending event threshold давсан
- Stuck agent run
- Agent failed/degraded rate threshold давсан
- Review SLA breach
- Notification failure
- Security anomaly
- Storage/quota warning, quota model нэмэгдсэн үед

Action:

- Open diagnostics
- Acknowledge
- Assign owner
- Resolve with note
- View timeline

Resolved issue Active filter-ээс гарна, history/audit-аас устахгүй.

### 7.2 Tenant Health

| Field | Тайлбар |
|---|---|
| Company | Tenant нэр |
| Health | Healthy / Warning / Critical / Unknown / Inactive |
| Users | Last 24h-д нэвтэрсэн / нийт active account |
| Runs | Run count + failed/degraded breakdown |
| Review SLA | Waiting + breached |
| Issues | Open incident severity-аар |
| AI spend | MTD actual/estimated |
| Storage | Used bytes; quota model нэмэгдсэн үед used/quota |
| Last activity | Сүүлийн platform activity |

Tenant health status тайлбарлагдах rule-ээр тооцогдоно:

- Service outage/security incident → `CRITICAL`
- Failure threshold minimum sample-тайгаар давсан → `WARNING`
- Review SLA breach → `WARNING`
- Metric stale → `UNKNOWN`
- Activity байхгүй → `INACTIVE`; эвдэрсэн гэсэн үг биш

Tenant detail tab:

```text
Overview
Agent Runs
Review SLA
Usage
Audit
Support Access
```

BOQ, drawing, schedule, progress, raw file content default view-д байхгүй.

### 7.3 Agents & Runs

| Metric | Тайлбар |
|---|---|
| State | Active / Degraded / Paused / Draining / Maintenance / Offline |
| Runs | Сонгосон хугацааны execution |
| Completion | Completed / terminal runs |
| Failed | Failed / terminal runs |
| Degraded | Degraded / terminal runs |
| Rejected | Rejected / terminal runs |
| Latency | p50 болон p95 |
| Retry rate | Retry хийсэн run-ийн хувь |
| Stuck | Runtime threshold давсан running count |
| Last success | Сүүлийн амжилттай run |
| Cost | Estimated/actual cost |

Agent release/detail:

- `promptVersion`
- `toolBundleVersion`
- `outputSchemaVersion`
- `provider`
- `modelId`
- `dataSnapshotVersion`

Agent detail дээр trend, failure category, slow/failed run, tool failure, validation, trace/correlation ID болон tenant impact харна.

`Review required run` metric нь `AgentRun` ба `ReviewTask` найдвартай холбоостой үед л гарна. Raw request, prompt, output, tool payload default-аар харагдахгүй.

### 7.4 Human Review Monitor

Metric:

- Waiting: зөвхөн `REVIEW_REQUIRED`
- SLA breached
- Oldest waiting
- SLA not configured
- Backlog by tenant
- Backlog by assigned role
- Backlog by target type
- Created vs resolved trend

`ReviewTask` дээр priority field байхгүй тул `High Priority` metric/filter MVP-д байхгүй. Priority шаардлагатай бол model нэмэх эсвэл version-тэй ил тод дүрмээр derive хийнэ.

Super Admin approve/reject/correct хийхгүй.

### 7.5 AI Quality

Нэг нийлмэл AI Quality Score ашиглахгүй:

1. Offline evaluation
2. Production validation pass
3. Human rejection/correction
4. Field accuracy, labeled data байгаа үед
5. Grounding coverage, source contract байгаа үед

Metric бүр dataset/suite version, agent release, sample size, time window, previous delta болон freshness-тэй байна. Sample хангалтгүй бол `Insufficient data` гэж харуулна.

Persisted evaluation history бүрдээгүй тул advanced quality trend Phase 3-д орно.

### 7.6 Usage & Cost

MVP:

- Run count
- Input/output/cached/reasoning token
- Estimated/actual cost
- Cost by tenant
- Cost by agent
- Daily/monthly trend
- Actual-cost coverage

Limit model нэмэгдсэний дараа:

- Tenant cost limit progress
- 80%, 90%, 100% threshold alert
- Cost forecast

Subscription, payment, invoice нь billing integration бодитоор нэмэгдсэний дараах тусдаа module байна.

### 7.7 System Health

| Component | MVP metric |
|---|---|
| API | Readiness, recent error rate, p95 latency |
| PostgreSQL | Connectivity, query/transaction health |
| Worker/Queue | Pending, oldest pending, failed, retry/dead-letter |
| File/Object storage | Read/write probe, upload failure, used bytes |
| AI provider | Recent error, latency, rate-limit |
| Notification/Outbox | Pending, oldest pending, failed delivery |

State:

- `HEALTHY`
- `DEGRADED`
- `DOWN`
- `UNKNOWN`

Metric бүр current state, observed window, last checked, threshold version, failure reason болон diagnostics link-тэй байна.

`/health/live` болон `/health/ready` нь тухайн мөчийн snapshot. Probe history байхгүй үед uptime/SLO percentage гаргахгүй. Redis бодитоор ашиглагдаагүй тул placeholder болгон харуулахгүй.

### 7.8 Recent Audited Changes

Dashboard дээр сүүлийн 5 орчим утгатай event preview харуулна:

- Incident created/resolved
- Agent version/state өөрчлөгдсөн
- Failure threshold давсан
- Review SLA breach
- Integration state өөрчлөгдсөн
- Security action
- Platform setting өөрчлөгдсөн
- Backup/restore verification

Event бүр actor/system, target, timestamp, result, correlation ID болон detail холбоостой байна. Дэлгэрэнгүй нь `Audit & Security` руу орно.

---

## 8. Click ба drill-down behavior

Card дарахад утгагүй modal биш, шалтгааныг тайлбарлах filtered/detail page нээгдэнэ.

| Source | Route/behavior |
|---|---|
| Platform Status | `/platform/system-health` active cause/filter-тэй |
| Critical Issues | `/platform/incidents?state=open&severity=critical,high` |
| Tenant Health KPI | `/platform/tenants?health=warning,critical,unknown` |
| Agent Completion KPI | `/platform/agent-runs` selected window + status breakdown |
| Review SLA KPI | `/platform/review-quality?view=backlog&sla=breached` |
| AI Spend KPI | `/platform/usage?view=cost` |
| Attention issue | `/platform/incidents/:incidentId` |
| Tenant row | `/platform/tenants/:tenantId/health` |
| Agent row | `/platform/agents/:agentType` |
| Agent run row | `/platform/agent-runs/:runId/diagnostics` |
| Review backlog row | `/platform/review-quality?tenantId=:tenantId` |
| System component | `/platform/system-health/:component` |
| Recent audited change | Incident, audit эсвэл diagnostics detail |

Navigation semantic:

```text
summary → filtered list → detail → diagnostics/audit
```

Drill-down хийхэд tenant, agent, time-window filter context хадгалагдана. Tenant business content рүү default drill-down хийхгүй.

---

## 9. Permission architecture

### 9.1 Platform identity

- Platform identity/principal-ийг tenant membership-ээс тусдаа model болгоно.
- Platform permission-ийг project/tenant permission enum-ээс салгана.
- Platform API-г `/platform/v1/*` namespace-д тусгаарлана.
- Company Admin/tenant user энэ API-д хандахад `403` буцаана.
- Company Admin platform role grant/revoke хийхгүй.
- Authorization default-deny байна.
- Client-ийн `tenantId`-г scope-ийн нотолгоо гэж үзэхгүй.
- `if superAdmin then skip tenant filter` wildcard bypass ашиглахгүй.
- Cross-tenant aggregate нь тусдаа platform read-model/service ашиглана.

Platform permission:

```text
PLATFORM_OVERVIEW_READ
PLATFORM_TENANT_HEALTH_READ
PLATFORM_AGENT_HEALTH_READ
PLATFORM_AGENT_RUN_DIAGNOSTICS_READ
PLATFORM_REVIEW_MONITOR_READ
PLATFORM_USAGE_READ
PLATFORM_SYSTEM_HEALTH_READ
PLATFORM_AUDIT_READ
PLATFORM_INCIDENT_MANAGE
PLATFORM_INTEGRATION_MANAGE
PLATFORM_SETTINGS_MANAGE
PLATFORM_AGENT_STATE_MANAGE
PLATFORM_SUPPORT_ACCESS_GRANT
```

`PROJECT_MANAGE`, `REPORT_APPROVE`, `INVENTORY_WRITE`, `COMMAND_APPLY` зэрэг operational permission Platform Super Admin-д олгохгүй.

### 9.2 Read-only by default

MVP-ийн ихэнх platform endpoint `GET` байна. Зөвшөөрөгдөх mutation:

- Incident acknowledge/assign/resolve
- Platform integration/setting update
- Advanced шатанд safe agent state change
- Time-limited diagnostic access grant

Critical mutation бүр:

- Explicit permission
- Re-authentication/step-up authentication
- Reason
- Impact preview
- Confirmation
- Idempotency key
- Before/after summary
- Correlation ID
- Audit event

шаардана.

### 9.3 Support diagnostic access

Silent impersonation ашиглахгүй. Access grant:

- Ticket/reason
- Tenant/resource scope
- Allowed operation
- Read-only + masked default
- Start/expiry
- Requested/approved by
- Company Admin notification/approval policy
- Access history
- Revoke action

Expiry болсон grant шууд хүчингүй болно.

### 9.4 Security ба audit

- Platform Admin MFA шаардана.
- Tenant-scoped repository/resource нь `(tenantId, id)` scope ашиглана.
- Боломжтой бол PostgreSQL Row-Level Security нэмнэ.
- Object storage key tenant prefix-тэй байна.
- Signed download URL authorized `FileAsset`-аас богино хугацаатай үүснэ.
- Worker, outbox consumer, agent tool call verified tenant context ашиглана.
- Secret, token, PII, prompt/output/file content default-аар masked/redacted байна.
- Platform audit tenant audit-аас тусдаа байна.
- Audit record UI/API-аас edit/delete хийх боломжгүй.
- Retention, archive, authorized export policy тодорхой байна.
- Өндөр нөлөөтэй action advanced шатанд two-person approval хэрэглэнэ.

Minimum platform audit:

| Field | Тайлбар |
|---|---|
| `id` | Event ID |
| `actorId` | Жинхэнэ user/service principal |
| `effectiveActorId` | Delegated/support context байвал |
| `actorRole` | Platform role |
| `action` | Canonical action |
| `tenantId` | Нөлөөлсөн tenant, байвал |
| `resourceType/resourceId` | Target |
| `reason` | Critical action reason |
| `before/after` | Redacted summary/hash |
| `requestId/correlationId` | Trace |
| `ipAddress/userAgent` | Security metadata |
| `occurredAt` | UTC timestamp |
| `result` | Success / denied / failed |

---

## 10. Alert ба health calculation

Alert rule бүр:

- Metric name
- Time window
- Threshold
- Minimum sample
- Consecutive evaluation count
- Severity
- Cooldown
- Auto-resolve condition
- Owner/team
- Runbook link
- Rule version

Жишээ:

```text
Rule: Agent failure rate high
Window: 15 minutes
Minimum sample: 20 terminal runs
Trigger: failure rate > 5% for 3 consecutive evaluations
Severity: HIGH
Resolve: failure rate < 2% for 3 consecutive evaluations
```

Collector ажиллаагүй эсвэл data stale бол `0`/`Healthy` гэж үзэхгүй; `UNKNOWN` болно.

Review SLA MVP-д нэг default policy ашиглаж, дараа нь tenant/target-specific versioned policy нэмнэ.

---

## 11. Backend API санал

Browser олон tenant endpoint руу fan-out хийхгүй. Server-side aggregate endpoint ашиглана.

```text
GET  /platform/v1/overview
GET  /platform/v1/incidents
POST /platform/v1/incidents/:id/acknowledge
POST /platform/v1/incidents/:id/assign
POST /platform/v1/incidents/:id/resolve

GET  /platform/v1/tenants
GET  /platform/v1/tenants/:tenantId/health
GET  /platform/v1/users

GET  /platform/v1/agents
GET  /platform/v1/agents/:agentType
GET  /platform/v1/agent-runs
GET  /platform/v1/agent-runs/:runId/diagnostics

GET  /platform/v1/reviews/summary
GET  /platform/v1/reviews/backlog
GET  /platform/v1/quality
GET  /platform/v1/usage
GET  /platform/v1/system-health
GET  /platform/v1/events
GET  /platform/v1/audit-logs
```

API requirement:

- Cursor pagination
- Server-side filter/sort
- Fixed time-window semantics
- UTC storage, UI timezone conversion
- Zod/OpenAPI contract
- Correlation ID
- Stable error envelope
- Sensitive-field redaction
- No raw content in overview
- Aggregate query performance test

---

## 12. Data model

### 12.1 Existing — current schema дээр баталгаажсан

| Model/field | Status | Control Tower ашиглалт |
|---|---|---|
| `Tenant` | Verified existing | Tenant registry/aggregate |
| `User.lastLoginAt`, `status` | Verified existing | Login activity/account state |
| `AgentRun` | Verified existing | Status, release, token, cost, latency, failure |
| `AgentToolCall` | Verified existing | Tool health/failure diagnostics |
| `AgentFeedback` | Verified existing | Human correction/rejection signal |
| `AgentUsageBudget` | Verified existing | Сарын ашигласан AI зардал; **limit биш** |
| `ReviewTask` | Verified existing | Backlog, role, due date, SLA; **priority байхгүй** |
| `AuditLog` | Verified existing | Tenant-scoped audit source |
| `OutboxEvent` | Verified existing | Queue/outbox health |
| `Notification` | Verified existing | Delivery backlog |
| `FileAsset.sizeBytes`, `status` | Verified existing | Storage usage/file state |

### 12.2 Proposed — шинээр шаардагдана

| Model/aggregate | Status | Зорилго |
|---|---|---|
| `PlatformPrincipal`/role binding | Proposed | Tenant-ээс тусдаа platform identity |
| `PlatformIncident` | Proposed | Platform/tenant/agent/service incident |
| `PlatformIncidentEvent` | Proposed | Incident lifecycle history |
| `PlatformAuditLog` | Proposed | Cross-tenant privileged audit |
| `ServiceHealthSnapshot` | Proposed | Health history |
| `AgentDeployment` | Proposed | Release/deployment traceability |
| `DiagnosticAccessGrant` | Proposed | Scoped, time-limited support access |
| `AlertRule` | Proposed, advanced | Versioned threshold policy |
| Tenant lifecycle/limit policy | Proposed, later | Suspend/quota/cost limit |
| Storage usage snapshot | Proposed, later | Historical storage usage |

Model бүр owner/domain, scope, retention, index, audit, sensitive field болон archive/delete policy-тэй байна.

Metric history-г хүсэлт бүр дээр бүх production хүснэгтээс дахин тооцоолохгүй. MVP-д efficient aggregate query, хэмжээ өсөхөд periodic rollup/snapshot ашиглана.

---

## 13. UX state ба accessibility

Dashboard бүр:

- Loading skeleton
- Empty state
- Partial widget failure
- Full error
- Stale data
- Unknown health
- No permission
- Insufficient sample
- Filter returns no result

төлөвтэй байна.

Нэг widget алдаа гарсан үед бүх Control Tower унахгүй. Color дангаараа severity илэрхийлэхгүй; icon, label, accessible contrast ашиглана. Table, filter, drawer, modal, action keyboard-аар ажиллана.

Бодит backend/model байхгүй KPI, menu, graph эсвэл action placeholder-аар харагдахгүй.

---

## 14. MVP хэрэгжүүлэлтийн дараалал

### Phase 0 — Security boundary

1. Platform principal/role-ийг tenant role-оос салгах
2. Platform permission ба route guard
3. Super Admin operational mutation permission хасах
4. Cross-tenant aggregate read API foundation
5. Platform audit foundation
6. Tenant isolation/privilege regression test

**Exit condition:** Platform Super Admin direct API ашигласан ч BOQ, schedule, report, inventory, review approval болон project command өөрчилж чадахгүй.

### Phase 1 — Useful read-only Control Tower

1. `/platform` route ба `PlatformShell`
2. Deterministic Platform Status
3. Five action-oriented KPI
4. Derived Attention signals/read-only list
5. Tenant Health table/detail
6. Agent Health table/detail
7. System Health snapshot
8. Time window, freshness, sample size
9. Read-only drill-down routes

### Phase 2 — Operational monitoring

1. Persistent incident model
2. Acknowledge/assign/resolve lifecycle
3. Threshold/SLA policy
4. Review Monitor
5. Agent run diagnostics
6. Usage/cost breakdown
7. Audit & Security UI
8. Notification/outbox health

### Phase 3 — Quality ба safe control

1. Persisted evaluation history
2. Offline vs production quality
3. Agent release comparison
4. Alert rule configuration
5. Agent pause/draining/maintenance
6. Step-up authentication
7. Diagnostic access grant
8. High-impact action two-person approval

### Phase 4 — Advanced

1. Explainable Platform Health Score, шаардлагатай бол
2. Cost anomaly/capacity forecast
3. Tenant quota/subscription
4. Billing integration
5. Automated incident correlation

---

## 15. MVP-ээс хассан эсвэл хойшлуулсан зүйлс

| Зүйл | Шийдвэр | Шалтгаан |
|---|---|---|
| 0–100 Platform Health Score | Хойшлуулна | Weight/history/override тодорхойгүй |
| Subscription/payment | Хасна | Billing integration байхгүй |
| Redis health | Хасна | Бодитоор ашиглаагүй |
| Project operational menu | Хасна | Company/Project role-ийн responsibility |
| Super Admin review approval | Хасна | Engineering separation зөрчинө |
| Raw prompt/output default view | Хасна | Privacy/security эрсдэлтэй |
| One-click agent kill | Хойшлуулна | Drain, impact, rollback, audit шаардлагатай |
| Нэг нийлмэл AI Quality Score | Хасна | Өөр утгатай metric-үүдийг буруу нэгтгэнэ |
| High Priority Review | Хасна | Одоогийн model-д priority байхгүй |
| Budget/quota progress | Хойшлуулна | Limit field/model байхгүй |
| Бүх graph эхний release-д | Хойшлуулна | Action/status/drill-down эхэлж ажиллана |

---

## 16. Acceptance criteria

**Төлөв (2026-08-11):** 33-аас **33 бүгд хангагдсан**. Дэлгэрэнгүйг
[`super-admin-roadmap.md`](./super-admin-roadmap.md) болон
[`SUPER-ADMIN-DASHBOARD.md`](./SUPER-ADMIN-DASHBOARD.md)-аас үзнэ үү.

### Authorization ба isolation

- [x] Platform Super Admin login `/platform` руу орно; project selector харагдахгүй.
- [x] Company Admin `/platform/v1/*` endpoint-д `403` авна.
- [x] Platform Super Admin project operational mutation хийж чадахгүй.
- [x] Company Admin platform role grant/revoke хийж чадахгүй.
- [x] Company A хэрэглэгч resource ID/tenantId өөрчлөн Company B data-д хүрэхгүй.
- [x] Worker/outbox/agent job өөр tenant-ийн artifact/context ачаалахгүй.
- [x] Tenant A signed URL Tenant B resource-д ашиглагдахгүй.
- [x] Expired diagnostic access `403` буцаана. — Хугацаа нь дууссан grant `EXPIRED` гэж
      уншигдаж, түүн дээрх ямар ч үйлдэл `409` буцаана; эрхгүй оролдлого `403` + DENIED audit.
      Хугацаа дуусах нь тооцоологддог тул background worker шаардахгүй.

### Dashboard ба navigation

- [x] Platform Status cause болон freshness-тэй байна.
- [x] Five KPI formula, window, freshness, sample size, drill-down-тай байна.
- [x] Drill-down tenant/agent/time filter context хадгална.
- [x] Critical/High issue эхэнд эрэмбэлэгдэнэ.
- [x] Partial widget failure бүх dashboard-ийг унагахгүй.
- [x] Stale/missing metric `UNKNOWN`, бага sample `Insufficient data` болно.
- [x] Model/API байхгүй placeholder харагдахгүй.
- [x] Normal seeded data дээр overview 2 секундээс бага ачаалах performance target-тай байна.

### Tenant, agent, review

- [x] Tenant aggregate backend дээр server-side тооцогдоно.
- [x] Agent failed/degraded/rejected тусдаа харагдана.
- [x] Agent latency p50/p95 байна.
- [x] Failure percentage minimum sample-гүй alert үүсгэхгүй.
- [x] Waiting review зөвхөн `REVIEW_REQUIRED` байна.
- [x] SLA breached зөвхөн due date өнгөрсөн `REVIEW_REQUIRED` байна.
- [x] Super Admin review approve/reject action/API эрхгүй.

### Incident, audit, security

- [x] Incident lifecycle/history хадгалагдана.
- [x] Critical mutation reason + confirmation + audit шаарддаг.
- [x] Privileged action actor, target, time, reason, result, correlation ID-тай audit үүсгэнэ.
- [x] Audit UI/API-аас edit/delete хийх боломжгүй.
- [x] Platform Admin MFA policy хэрэгжинэ. — Production gate ажиллаж байна: хоёр дахь хүчин
      зүйл бүртгэгдээгүй бол platform sign-in `403`. TOTP/WebAuthn enrolment өөрөө Phase 8.
- [x] Secret/sensitive content masked/redacted байна.
- [x] Support access scope, reason, expiry, revoke, audit-тай байна. — Ticket, шалтгаан, tenant
      scope, зөвшөөрөгдсөн үйлдлийн жагсаалт, зөвхөн унших + маскласан, эхлэх/дуусах хугацаа,
      revoke, append-only түүх. Зөвшөөрөл нь хоёр хүнтэй: хүсэгч өөрөө зөвшөөрөх боломжгүйг
      application дүрэм болон PostgreSQL `CHECK` constraint хоёул хамгаална.

### Quality

- [x] Offline evaluation, production validation, human feedback тусдаа metric байна. — Гурван
      metric гурван өөр эх үүсвэрээс: `PlatformEvaluationRun`, `AgentRun.validation`-ийн зөвхөн
      хэлбэр, `AgentFeedback`. Нэг нийлмэл оноо болгож нийлүүлэхгүй.
- [x] Quality metric release, sample size, window, freshness-тэй байна. — Release нь
      `promptVersion + toolBundleVersion`; metric бүр window, sampleSize, minimumSample, freshAt,
      previous delta болон source-тай.
- [x] Sample хангалтгүй үед percentage харуулахгүй. — Agent completion, tenant completion, review
      хувь болон гурван quality metric бүгд доод sample шалгадаг.

---

## 17. Definition of Done

Control Tower-ийг бэлэн гэж үзэхийн тулд:

1. UI бодит aggregate API ашиглана.
2. Platform/tenant/project permission тусгаарлагдана.
3. Card бүр drill-down эсвэл тодорхой next action-тай байна.
4. Metric бүр definition, window, freshness, threshold/sample-тай байна.
5. Critical action бүр audit-тай байна.
6. Partial failure, stale, unknown, insufficient state зөв харагдана.
7. Cross-tenant security test давна.
8. Operational deny UI болон API тестээр батлагдана.
9. OpenAPI, runtime validation, typecheck, automated test давна.
10. Demo data Healthy, Degraded, Critical, Stale, Empty, Insufficient төлөв үзүүлнэ.

---

## 18. Эцсийн дизайн зарчим

> **Platform Admin платформын доголдлыг оношилж, урсгалыг сэргээнэ. Company Admin компаниа удирдана. Project roles барилгын шийдвэрийг гаргана.**

Control Tower-ийн зорилго олон graph харуулах биш. Асуудлыг эрт илрүүлэх, нөлөөллийг ойлгуулах, зөв action санал болгох, critical үйлдэл бүрийг мөрдөх боломжтой болгоно.

```text
Permission separation
→ trustworthy metrics
→ attention and diagnostics
→ audited action
→ advanced score and automation
```
