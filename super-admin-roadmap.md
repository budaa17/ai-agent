# BuildWatch Super Admin Control Tower — Implementation Roadmap

**Суурь specification:** [`super-admin.md`](./super-admin.md)  
**Roadmap хувилбар:** 1.0  
**Огноо:** 2026-08-11  
**Зорилго:** Super Admin Control Tower-ийг одоогийн BuildWatch backend/frontend дээр эрсдэл багатай, dependency-ийн зөв дарааллаар хэрэгжүүлэх

---

## 1. Эхлэх цэг

Frontend dashboard-аас эхлэхгүй.

Одоогийн хамгийн том blocker нь backend дээр `SUPER_ADMIN`, `COMPANY_ADMIN` хоёр ижил operational permission-тэй, frontend root route бүх хэрэглэгчийг `/projects` руу оруулдаг явдал.

Зөв дараалал:

```text
Platform identity
→ Platform authentication/authorization
→ /platform shell
→ Read-only aggregate API
→ Control Tower dashboard
→ Drill-down pages
→ Incident actions/audit
→ Security/performance hardening
→ Advanced features
```

---

## 2. Roadmap-ийн ерөнхий зураглал

| Үе | Гол үр дүн | Backend | Frontend | Төлөв |
|---|---|---|---|---|
| 0 | Architecture contract | Identity, permission, KPI contract | Route/navigation contract | ✅ Complete |
| 1 | Security boundary | Platform auth, permission, migration | Platform login/session guard | ✅ Complete |
| 2 | Platform shell | Session API | `/platform`, `PlatformShell` | ✅ Complete |
| 3 | Read-only API | Overview aggregate endpoint | API schemas/client | ✅ Complete |
| 4 | Useful dashboard | KPI, tenant, agent, health data | Control Tower UI | ✅ Complete |
| 5 | Drill-down | Tenant/agent/review/usage endpoints | Detail/list pages | ✅ Complete |
| 6 | Operational control | Incident lifecycle, audit | Incident actions | ✅ Complete |
| 7 | Release hardening | Security/performance tests | Accessibility/responsive tests | ✅ Complete |
| 8 | Advanced | AI quality, support access | Quality/support UI | ✅ Complete (хамрах хүрээ §11-д) |

**Phase 0–8 бүрэн дууссан (2026-08-11).** Дэлгэц бүр яг юу харуулж байгааг [`SUPER-ADMIN-DASHBOARD.md`](./SUPER-ADMIN-DASHBOARD.md)-д тайлбарласан.

Нэг developer одоогийн codebase-ийг мэддэг гэж үзвэл:

- Read-only useful MVP хүртэл: ойролцоогоор 4–5 долоо хоног
- Incident lifecycle болон release hardening-тай: ойролцоогоор 6–8 долоо хоног

Энэ нь чиг баримжааны estimate бөгөөд data volume, migration болон MFA implementation-ээс хамаарч өөрчлөгдөнө.

---

## 3. Phase 0 — Architecture contract

**Хугацаа:** 1–2 өдөр  
**Зорилго:** Код эхлэхээс өмнө identity, security, metric болон route contract-ийг тогтоох

### 3.1 Platform account architecture

```text
Tenant User
├── tenantId
├── tenantRole
└── project memberships

Platform Principal
├── platformRole
├── platform permissions
└── tenantId байхгүй
```

Одоогийн tenant-scoped `User` model-ийг шууд global болгох нь authentication-ийг бүхэлд нь өөрчлөх эрсдэлтэй. MVP-д тусдаа:

- `PlatformPrincipal`
- `PlatformCredential`
- `PlatformRefreshSession`

ашиглана.

### 3.2 Platform authentication route

```text
/platform/login
/platform/v1/auth/login
/platform/v1/session
```

Platform token tenant token-оос ялгаатай байна:

```json
{
  "principalKind": "PLATFORM",
  "platformRole": "PLATFORM_SUPER_ADMIN",
  "audience": "buildwatch-platform"
}
```

### 3.3 KPI contract freeze

Эхний таван KPI:

1. Critical Issues
2. Tenant Health
3. Agent Completion
4. Review SLA
5. AI Spend

Formula болон state semantics-ийг `super-admin.md`-д тодорхойлсноор ашиглана.

### Phase 0 exit criteria

- [x] Platform болон tenant principal-ийн ялгаа батлагдсан
- [x] Login/session contract тогтсон
- [x] Platform permission list тогтсон
- [x] KPI formula тогтсон
- [x] API болон frontend route naming тогтсон
- [x] Legacy tenant `SUPER_ADMIN` migration strategy тогтсон

---

## 4. Phase 1 — Backend security boundary

**Хугацаа:** 4–6 өдөр  
**Зорилго:** Platform Admin-ийг tenant operational role-оос бодитоор салгах

### 4.1 Prisma model

Өөрчлөх:

```text
agents/prisma/schema.prisma
agents/prisma/migrations/<timestamp>_add_platform_identity/
```

Нэмэх үндсэн model:

```text
PlatformPrincipal
PlatformCredential
PlatformRefreshSession
PlatformAuditLog
```

Жишээ:

```prisma
enum PlatformRole {
  PLATFORM_SUPER_ADMIN
  PLATFORM_OPERATOR
  PLATFORM_AUDITOR
}

model PlatformPrincipal {
  id              String       @id @default(cuid())
  emailNormalized String       @unique
  displayName     String
  role            PlatformRole
  status          IdentityUserStatus
  tokenVersion    Int          @default(1)
  lastLoginAt     DateTime?
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt
}
```

Password hash болон refresh session-ийг тусдаа model-д хадгална.

### 4.2 Additive migration strategy

Эхний migration дээр tenant `SUPER_ADMIN`-ийг шууд устгахгүй.

Дараалал:

1. Platform model-ууд нэмэх
2. Backend хуучин болон шинэ identity-г түр зэрэг дэмжих
3. Platform Admin account bootstrap хийх
4. Frontend `/platform` ажиллуулж эхлэх
5. Хуучин tenant `SUPER_ADMIN` account-уудыг `COMPANY_ADMIN` руу шилжүүлэх
6. Seed/demo/review role reference-үүдийг шинэчлэх
7. Дараагийн migration-аар tenant role enum-оос `SUPER_ADMIN`-ийг хасах

### 4.3 Backend module

Шинээр:

```text
agents/src/backend/platform-contracts.ts
agents/src/backend/platform-authorization.ts
agents/src/backend/platform-auth-service.ts
agents/src/backend/platform-api.ts
```

Өөрчлөх магадлалтай:

```text
agents/src/backend/security.ts
agents/src/backend/runtime.ts
agents/src/backend/api.ts
agents/src/backend/openapi.ts
agents/src/backend/index.ts
```

### 4.4 Platform permission

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

Platform principal-д дараах tenant operational permission өгөхгүй:

- `PROJECT_MANAGE`
- `REPORT_APPROVE`
- `INVENTORY_WRITE`
- `COMMAND_APPLY`
- `DESIGN_APPROVE`
- `REPORT_SUBMIT`

### 4.5 Token ба middleware

- Platform token тусдаа audience ашиглана.
- Platform route зөвхөн `principalKind = PLATFORM` token хүлээн авна.
- Tenant route platform token хүлээн авахгүй.
- Authorization default-deny байна.
- Client-ийн `tenantId`-г permission-ийн нотолгоо гэж үзэхгүй.
- Cross-tenant query ерөнхий store-ийн tenant filter-ийг wildcard-аар алгасахгүй.

### 4.6 Bootstrap script

Шинээр:

```text
agents/src/scripts/bootstrap-platform-admin.ts
```

Script дараах input авна:

- Email
- Display name
- Password
- Platform role

### 4.7 Backend security test

Шинээр:

```text
agents/tests/backend/platform-auth.test.ts
agents/tests/backend/platform-authorization.test.ts
agents/tests/backend/platform-idor.test.ts
```

Заавал шалгах:

- [x] Company Admin `/platform/v1/*` → `403`
- [x] Platform Admin project mutation → `403`
- [x] Tenant A хэрэглэгч Tenant B data → `404/403`
- [x] Company Admin platform role олгох → `403`
- [x] Platform token tenant endpoint-д ажиллахгүй
- [x] Tenant token platform endpoint-д ажиллахгүй

### Phase 1 exit criteria

> Platform Admin нэвтэрч чаддаг боловч нэг ч project operational data өөрчилж чаддаггүй.

---

## 5. Phase 2 — Frontend Platform authentication ба shell

**Хугацаа:** 3–4 өдөр  
**Dependency:** Phase 1-ийн auth/session contract

### 5.1 Platform authentication

Шинээр:

```text
agent-console/src/auth/platform-token-store.ts
agent-console/src/auth/platform-auth-provider.tsx
agent-console/src/auth/platform-route-guards.tsx
agent-console/src/pages/platform/platform-login-page.tsx
```

Guard:

```tsx
<RequirePlatformAuth />
<RequirePlatformPermission permission="PLATFORM_OVERVIEW_READ" />
```

Tenant болон platform token storage-ийг хольж болохгүй.

### 5.2 Routing

Өөрчлөх:

```text
agent-console/src/app.tsx
```

Санал болгох structure:

```tsx
<Route path="/platform/login" element={<PlatformLoginPage />} />

<Route element={<RequirePlatformAuth />}>
  <Route path="/platform" element={<PlatformShell />}>
    <Route index element={<ControlTowerPage />} />
  </Route>
</Route>
```

### 5.3 PlatformShell

Шинээр:

```text
agent-console/src/platform/platform-shell.tsx
agent-console/src/platform/platform-navigation.ts
```

PlatformShell дээр:

- Project selector байхгүй
- Project list query байхгүй
- Field offline outbox/sync байхгүй
- Platform navigation л харагдана

Эхний route:

```text
/platform
/platform/tenants
/platform/agents
/platform/review-quality
/platform/usage
/platform/system-health
/platform/audit
```

### 5.4 Frontend auth test

```text
agent-console/src/auth/platform-route-guards.test.tsx
agent-console/src/pages/platform/platform-login-page.test.tsx
agent-console/src/platform/platform-shell.test.tsx
```

Шалгах:

- [x] Platform Admin `/platform` руу орно
- [x] Tenant user `/platform` руу орохгүй
- [x] Platform shell дээр project selector байхгүй
- [x] Logout platform token-ийг цэвэрлэнэ

### Phase 2 exit criteria

> Platform Admin хоосон боловч хамгаалагдсан `/platform` shell рүү нэвтэрч чаддаг болсон байна.

---

## 6. Phase 3 — Read-only aggregate backend

**Хугацаа:** 5–7 өдөр  
**Dependency:** Platform authorization бүрэн ажилласан байх

Эхлээд бүх endpoint хийхгүй. Нэг useful vertical slice хийнэ:

```text
GET /platform/v1/overview
```

### 6.1 Contract эхэлж бичих

```text
agents/src/backend/platform-contracts.ts
```

Overview response:

```text
generatedAt
window
freshness
platformStatus
topCauses
kpis
attention
tenantHealthPreview
agentHealthPreview
systemHealth
recentAudit
```

Metric бүр:

```text
value
window
sampleSize
freshAt
state
comparison
```

### 6.2 Read service

Шинээр:

```text
agents/src/backend/platform-read-service.ts
```

Үүрэг:

- Cross-tenant aggregate query
- Time-window parsing
- KPI calculation
- Health rule
- Sensitive data redaction
- Server-side filter/sort

Зөвхөн энэ platform service cross-tenant aggregate query хийнэ. Ерөнхий repository дээр “Super Admin бол tenant filter алгас” гэсэн нөхцөл хийхгүй.

### 6.3 Tenant Health query

- Tenant count
- User `lastLoginAt`
- Agent status breakdown
- Review SLA
- File storage bytes
- Outbox/notification state
- Open technical signals

### 6.4 Agent Completion

```text
COMPLETED / (COMPLETED + FAILED + DEGRADED + REJECTED)
```

- `RUNNING` denominator-т орохгүй.
- Stuck `RUNNING` тусдаа signal болно.
- `FAILED`, `DEGRADED`, `REJECTED` тусдаа харагдана.
- Minimum sample хэрэглэнэ.

### 6.5 Review SLA

Waiting:

```text
status = REVIEW_REQUIRED
```

Breached:

```text
status = REVIEW_REQUIRED
AND dueAt IS NOT NULL
AND dueAt < now
```

Одоогийн `phase11-observability.ts` дахь `DRAFT + REVIEW_REQUIRED` gauge-г Control Tower backlog-д шууд ашиглахгүй. Шаардлагатай бол:

```text
review_draft_count
review_waiting_count
review_sla_breached_count
```

гэж салгана.

### 6.6 AI Spend

```text
actualCostMicroUsd байвал actual
үгүй бол estimatedCostMicroUsd
```

- Actual/estimated coverage харуулна.
- Limit model байхгүй үед `used / budget` progress үзүүлэхгүй.

### 6.7 System Health snapshot

- API readiness
- PostgreSQL readiness
- Outbox pending/failed/dead-letter
- Artifact status/upload failure
- Notification pending/failed
- Recent AI provider failure

Probe history байхгүй үед uptime/SLO percentage гаргахгүй.

### 6.8 OpenAPI дараалал

1. Zod contract
2. Backend service
3. API route
4. OpenAPI export
5. Frontend generated type
6. Frontend runtime Zod validation

### 6.9 Backend aggregate test

Шинээр:

```text
agents/tests/backend/platform-overview.test.ts
agents/tests/backend/platform-metrics.test.ts
agents/tests/phase11/platform-performance.test.ts
```

### Phase 3 exit criteria

- [x] Overview бодит DB data буцаана
- [x] Formula test-тэй
- [x] `DRAFT` backlog-д орохгүй
- [x] Stale data `UNKNOWN`
- [x] Бага sample misleading percentage үүсгэхгүй
- [x] Raw prompt/file content response-д байхгүй
- [x] Company Admin overview endpoint-д хандахгүй

---

## 7. Phase 4 — Control Tower frontend

**Хугацаа:** 5–7 өдөр  
**Dependency:** `/platform/v1/overview` contract тогтвортой болсон байх

### 7.1 API layer

Шинэ/өөрчлөх:

```text
agent-console/src/api/platform-client.ts
agent-console/src/api/platform-schemas.ts
agent-console/src/api/generated.ts
```

Query key:

```ts
["platform", "overview", { tenantId, agentType, from, to }]
```

Filter state URL-д хадгалагдана:

```text
/platform?window=24h&tenantId=...&agentType=...
```

### 7.2 Control Tower page

```text
agent-console/src/pages/platform/control-tower-page.tsx
```

Component:

```text
agent-console/src/components/platform/platform-status.tsx
agent-console/src/components/platform/platform-kpi-grid.tsx
agent-console/src/components/platform/attention-panel.tsx
agent-console/src/components/platform/system-health-panel.tsx
agent-console/src/components/platform/tenant-health-preview.tsx
agent-console/src/components/platform/agent-health-preview.tsx
agent-console/src/components/platform/recent-audit-preview.tsx
agent-console/src/components/platform/platform-filter-bar.tsx
```

### 7.3 UI хийх дараалал

1. Platform Status
2. Five KPI
3. Attention Required
4. System Health
5. Tenant Health preview
6. Agent Health preview
7. Recent Audited Changes

Эхний release дээр chart хийхгүй.

### 7.4 State handling

Widget бүр:

- Loading skeleton
- Error + retry
- Empty
- Stale
- Unknown
- Insufficient data
- No permission

Нэг panel алдаа гарсан үед бүх page унахгүй.

### 7.5 Frontend component test

```text
agent-console/src/pages/platform/control-tower-page.test.tsx
agent-console/src/components/platform/platform-status.test.tsx
agent-console/src/components/platform/platform-kpi-grid.test.tsx
```

### Phase 4 exit criteria — анхны useful MVP

> Platform Admin нэвтрээд platform status, 5 KPI, attention, tenant/agent/system health-ийг нэг нүүрнээс бодит data-тай харна.

**Status:** ✅ Complete — backend/frontend contract, component tests, production build болон local PostgreSQL smoke query PASS (2026-08-11).

Verification record:

- Prisma validate/generate болон 14/14 migration status: PASS
- Backend full suite: 16 file, 101 test PASS
- Platform overview/auth focused suite: 4 file, 31 test PASS
- Frontend full suite: 28 file, 83 test PASS
- Frontend typecheck/OpenAPI generation/production build: PASS
- Local PostgreSQL overview smoke: `partial=false`, sanitized problem `0`, бодит tenant/system aggregate уншсан

Энэ үе дуусахад анхны demo/release хийж болно.

---

## 8. Phase 5 — Drill-down endpoint ба page

**Хугацаа:** 7–10 өдөр  
**Зорилго:** Summary → filtered list → detail flow бүрдүүлэх

Backend болон frontend-ийг endpoint/page хосоор хэрэгжүүлнэ.

### 8.1 Tenant

Backend:

```text
GET /platform/v1/tenants
GET /platform/v1/tenants/:tenantId/health
```

Frontend:

```text
/platform/tenants
/platform/tenants/:tenantId/health
```

### 8.2 Agent

Backend:

```text
GET /platform/v1/agents
GET /platform/v1/agents/:agentType
GET /platform/v1/agent-runs
GET /platform/v1/agent-runs/:runId/diagnostics
```

Frontend:

```text
/platform/agents
/platform/agents/:agentType
/platform/agent-runs/:runId/diagnostics
```

Diagnostics дээр raw prompt/output default-аар байхгүй.

### 8.3 Review

Backend:

```text
GET /platform/v1/reviews/summary
GET /platform/v1/reviews/backlog
```

Frontend:

```text
/platform/review-quality?view=backlog
```

Approve/reject/correct action байхгүй.

### 8.4 Usage, system health, audit

```text
GET /platform/v1/usage
GET /platform/v1/system-health
GET /platform/v1/audit-logs
```

Frontend:

```text
/platform/usage
/platform/system-health
/platform/audit
```

### 8.5 List contract

Бүх list:

- Cursor pagination
- Server-side filtering
- Stable sort
- Time-window semantics
- URL filter persistence
- Loading/error/empty state
- Sensitive-field redaction

### Phase 5 exit criteria

- [x] Summary → filtered list → detail navigation ажиллана
- [x] Tenant/agent/time filter context хадгалагдана
- [x] Cross-tenant raw content харагдахгүй
- [x] Page бүр loading/error/empty state-тай
- [x] Agent run diagnostics redacted байна
- [x] Super Admin review action хийхгүй

**Status:** ✅ Complete — 11 read-only endpoint, 9 drill-down page, keyset pagination болон бодит PostgreSQL smoke PASS (2026-08-11).

Хийгдсэн үндсэн зүйл:

- Backend: `platform-drilldown-contracts.ts`, `platform-drilldown-read-model.ts`, `platform-drilldown-service.ts` болон overview-той нийтлэг `platform-read-support.ts` (freshness, redaction, cursor helper)
- Endpoint: `/tenants`, `/tenants/:tenantId/health`, `/agents`, `/agents/:agentType`, `/agent-runs`, `/agent-runs/:runId/diagnostics`, `/reviews/summary`, `/reviews/backlog`, `/usage`, `/system-health`, `/audit-logs`
- Permission: route бүр өөрийн platform permission-ээ шалгана; diagnostics зөвхөн `PLATFORM_AGENT_RUN_DIAGNOSTICS_READ`
- Pagination: `(sortColumn, id)` tuple keyset cursor, opaque base64url; хуурамч cursor `CURSOR_INVALID` 400 буцаана
- Redaction: prompt, research, output, tool payload болон provider error хэзээ ч буцахгүй; redaction policy response дотор ил
- Frontend route: `/platform/tenants`, `/platform/tenants/:tenantId/health`, `/platform/agents`, `/platform/agents/:agentType`, `/platform/agent-runs`, `/platform/agent-runs/:runId/diagnostics`, `/platform/review-quality?view=summary|backlog`, `/platform/usage`, `/platform/system-health`, `/platform/audit`
- URL-д хадгалагдах filter, forward keyset pager, loading/error/partial/unknown/empty/insufficient-sample төлөв

Verification record:

- Backend full suite: 17 file, 126 test PASS
- Frontend full suite: 29 file, 99 test PASS
- Backend/frontend typecheck, OpenAPI export ба generated client, production build: PASS
- Local PostgreSQL drill-down smoke (`pnpm --dir agents run smoke:platform:drilldown`): 11 endpoint бүгд `partial=false`, diagnostics redaction leak алга

---

## 9. Phase 6 — Persistent incident ба audited actions

**Хугацаа:** 5–7 өдөр  
**Dependency:** Read-only monitoring MVP тогтвортой байх

### 9.1 Prisma model

```text
PlatformIncident
PlatformIncidentEvent
```

### 9.2 Backend service

```text
agents/src/backend/platform-incident-service.ts
agents/src/backend/platform-alert-evaluator.ts
```

Endpoint:

```text
GET  /platform/v1/incidents
POST /platform/v1/incidents/:id/acknowledge
POST /platform/v1/incidents/:id/assign
POST /platform/v1/incidents/:id/resolve
```

Mutation бүр:

- Platform permission
- Step-up auth, critical action бол
- Reason
- Idempotency key
- Before/after summary
- Correlation ID
- Platform audit

### 9.3 Frontend

```text
/platform/incidents
/platform/incidents/:incidentId
```

Action:

- Acknowledge
- Assign owner
- Resolve with note
- View timeline

### Phase 6 exit criteria

- [x] Incident lifecycle бүрэн хадгалагдана
- [x] Resolved issue history-ээс устахгүй
- [x] Critical action бүр audit үүсгэнэ
- [x] Duplicate signal нэг active incident болж deduplicate хийгдэнэ
- [x] Auto-resolve/reopen history хадгалагдана

**Status:** ✅ Complete — persistent incident lifecycle, audited action, step-up auth болон idempotent retry (2026-08-11).

Хийгдсэн үндсэн зүйл:

- Prisma: `PlatformIncident`, `PlatformIncidentEvent` + `PlatformIncidentEvent_append_only` trigger; migration `20260811120000_add_platform_incidents`, `20260811130000_add_platform_incident_idempotency`
- `platform-alert-evaluator.ts`: signal → incident. `signalId`-аар deduplicate; severity өөрчлөгдвөл timeline entry; signal зогсвол auto-resolve; дахин асвал ижил мөр reopen (`reopenCount++`)
- Эх үүсвэр уншигдаагүй үед auto-resolve хийхгүй — өгөгдөл байхгүй нь алдаа байхгүй гэсэн үг биш
- `platform-incident-service.ts`: `PLATFORM_INCIDENT_MANAGE` шалгах, reason заавал, `rowVersion` optimistic lock, `Idempotency-Key` replay, before/after hash, correlation ID, SUCCESS болон DENIED audit
- Step-up: CRITICAL/HIGH инцидент шийдвэрлэхэд нууц үг дахин шаардана
- Endpoint: `GET /incidents`, `GET /incidents/:id`, `POST /incidents/:id/acknowledge|assign|resolve`
- Overview-ийн `attention.items` одоо жинхэнэ `incidentId`-той холбогдоно
- Frontend: `/platform/incidents`, `/platform/incidents/:incidentId` — timeline, evidence, reason-тэй үйлдлийн форм
- Repeatable evaluator: `pnpm --dir agents run platform:incidents:evaluate`

---

## 10. Phase 7 — Release hardening

**Хугацаа:** 3–5 өдөр

### 10.1 Security

- Cross-tenant IDOR
- Platform token tenant endpoint deny
- Tenant token platform endpoint deny
- Company Admin platform role grant deny
- Signed URL isolation
- Worker/outbox/agent tenant context
- Expired support/session access
- Secret/redaction scan
- Platform Admin MFA production gate
- Audit immutability

### 10.2 Performance

- Overview target: normal seeded data дээр 2 секундээс бага
- N+1 query арилгах
- Query index шалгах
- Agent p50/p95 query optimize хийх
- Tenant aggregate pagination
- Шаардлагатай үед periodic rollup/snapshot нэмэх

### 10.3 Demo fixture

Дараах төлөв бүр test/demo data-тай байна:

- Healthy
- Degraded
- Critical
- Unknown/stale
- Empty
- Insufficient sample

### 10.4 Verification commands

Backend:

```powershell
pnpm.cmd --dir agents run db:generate
pnpm.cmd --dir agents run check
pnpm.cmd --dir agents run test:backend:v22
pnpm.cmd --dir agents run test:phase11:v22
```

Frontend:

```powershell
pnpm.cmd --dir agent-console run api:generate
pnpm.cmd --dir agent-console run typecheck
pnpm.cmd --dir agent-console run test
pnpm.cmd --dir agent-console run build
```

### Phase 7 exit criteria

- [x] Security negative test бүр PASS
- [x] Cross-tenant data leak байхгүй
- [x] OpenAPI болон generated client зөрөөгүй
- [x] Backend/frontend typecheck PASS
- [x] Component/backend test PASS
- [x] Production build PASS
- [x] Normal overview performance target хангана

**Status:** ✅ Complete — MFA production gate, security negative suite, performance gate болон 6 demo төлөв (2026-08-11).

Хийгдсэн үндсэн зүйл:

- **MFA production gate:** `PlatformPrincipal.mfaEnrolledAt` + `PLATFORM_REQUIRE_MFA` config (production дээр default `true`). Хоёр дахь хүчин зүйл бүртгэгдээгүй бол platform login `403`, DENIED audit үүснэ. Нууц үг буруу бол gate-ээс өмнө `401` — данс байгаа эсэхийг мэдэх боломжгүй
- **Security negative suite** ([platform-hardening.test.ts](agents/tests/backend/platform-hardening.test.ts), 17 тест): permission boundary, platform role grant хийх API байхгүй, audit/incident history immutability (код болон DB trigger), expired ба revoked session, tenant↔platform token deny, secret/redaction scan, sanitized 500 envelope
- **Performance gate** ([platform-performance.test.ts](agents/tests/phase11/platform-performance.test.ts)): 400 tenant дээрх aggregation budget, эх үүсвэрийн concurrent fan-out, бүх raw query bounded
- **Demo fixture** ([platform-demo-fixtures.ts](agents/tests/backend/platform-demo-fixtures.ts)): Healthy, Degraded, Critical, Unknown/stale, Empty, Insufficient sample — 6 төлөв бүр бодит input-оос гардгийг тестээр батална

Verification record:

- Backend suite: 20 file, 169 test PASS
- Phase 11 suite: 9 file, 32 test PASS
- Frontend suite: 30 file, 106 test PASS
- Backend/frontend typecheck, OpenAPI export ба generated client, production build: PASS
- Local PostgreSQL: drill-down smoke `partial=false`, incident evaluator дахин ажиллуулахад `opened=0, refreshed=4` (deduplicate батлагдсан)

---

## 11. Phase 8 — Advanced capability

**Status:** ✅ Complete — хийж болох бүх зүйл хийгдсэн, үлдсэнийг нь яагаад хийгээгүйг доор тодорхой бичсэн (2026-08-11).

### 11.1 Хийсэн

| Зүйл | Хэрхэн |
|---|---|
| **Persisted AI evaluation history** | `PlatformEvaluationRun` model. `EvalCase` нь case каталог; энэ нь suite ажиллуулсан бодит үр дүнг хадгална, ингэснээр trend гаргах боломжтой болно |
| **Offline/production quality comparison** | Гурван **тусдаа** metric: offline evaluation (`PlatformEvaluationRun`), production validation (`AgentRun.validation`-ийн зөвхөн хэлбэр), human feedback (`AgentFeedback`). Нэг нийлмэл оноо болгож **нийлүүлээгүй** |
| **Agent release comparison** | `promptVersion + toolBundleVersion` хослолоор release таних; release тус бүрд гурван metric, provider/model, run тоо |
| **Diagnostic access grant** | `PlatformSupportAccessGrant` + append-only `PlatformSupportAccessEvent`. Ticket, шалтгаан, tenant scope, зөвшөөрөгдсөн үйлдэл, зөвхөн унших + маскласан, эхлэх/дуусах, revoke, бүрэн түүх |
| **Two-person approval** | Хүсэгч өөрөө зөвшөөрөх боломжгүй — application дүрэм **болон** PostgreSQL `CHECK` constraint хоёул. Аль нэг нь дангаараа тулгуур болохгүй |
| **Cost anomaly detection** | `TENANT_COST_ANOMALY` дүрэм: tenant-ийн **өөрийнх нь** өмнөх ижил урттай цонхтой харьцуулна. Хамгийн бага baseline зардал болон run тоотой тул том tenant зүгээр том гэдгээрээ дохио үүсгэхгүй |

Metric бүр өөрийн window, sample size, source, delta-тай. Доод sample (20) хүрэхгүй бол хувь **огт харуулахгүй** — `Sample хүрэлцэхгүй` гэж бичнэ.

Хугацаа дууссан grant нь **тооцоолж** хүчингүй болно, background worker шаардахгүй: `state = APPROVED` боловч `expiresAt` өнгөрсөн бол `EXPIRED` гэж уншигдана.

### 11.2 Зориудаар хийгээгүй

Эдгээрийг «удахгүй» гэж хуурамчаар харуулахгүй, огт байхгүй:

| Зүйл | Шалтгаан |
|---|---|
| **Safe agent pause/draining** | Agent run үүсэх **гурван бие даасан цэг** байна ([a0-intake-service.ts](../agents/src/backend/a0-intake-service.ts), [recommendations/agent.ts](../agents/src/recommendations/agent.ts), [reporting/persistence.ts](../agents/src/reporting/persistence.ts)). Зөвхөн заримыг нь дагадаг pause бол хуурамч аюулгүй байдлын хяналт. Урьдчилсан нөхцөл нь admission chokepoint refactor — Control Tower-ийн хамрах хүрээнээс гадуур |
| **Tenant quota / subscription / billing** | Limit загвар байхгүй, гадаад billing integration ч байхгүй. `super-admin.md` §15 өөрөө «Хасна» гэж заасан |
| **Explainable 0–100 health score** | `super-admin.md` §11 «үнэхээр шаардлагатай бол» гэсэн; weight, history, override тодорхойгүй. Одоогийн explicit төлөв (Хэвийн/Доголдолтой/Ноцтой/Тодорхойгүй) илүү үнэн |
| **Capacity forecast** | Probe/capacity түүх цуглуулдаггүй. Түүхгүй таамаг бол зохиомол тоо |

### 11.3 Verification record

- Backend suite: 21 file, 189 test PASS
- Phase 11 suite: 9 file, 32 test PASS
- Frontend suite: 31 file, 117 test PASS
- Backend/frontend typecheck, OpenAPI export ба generated client, production build: PASS
- Local PostgreSQL drill-down smoke: `partialSections: []`
- Migration: `20260811150000_add_platform_quality_and_support_access` (append-only trigger + two-person `CHECK`)

---

## 12. Parallel ажиллаж болох хэсэг

### Phase 1-ийн дараа

Backend болон frontend дараах байдлаар зэрэг ажиллаж болно:

| Backend track | Frontend track |
|---|---|
| Platform session contract | Platform login/guard |
| Overview Zod/OpenAPI contract | PlatformShell/layout |
| Aggregate service | Component fixture/state |
| Tenant endpoint | Tenant list/detail page |
| Agent endpoint | Agent list/detail page |
| Incident service | Incident list/detail page |

Frontend fixture ашиглан component хийж болох ч generated OpenAPI client бэлэн болсны дараа л integration complete гэж үзнэ.

---

## 13. Хийж болохгүй буруу дараалал

Дараах ажлаас эхлэхгүй:

- Dashboard card болон chart
- 0–100 health score
- Billing/subscription
- Agent kill switch
- Raw log/prompt viewer
- Existing `AdminPage` дээр бүх feature чихэх
- `SUPER_ADMIN` бол tenant filter алгас гэсэн wildcard
- Model байхгүй budget/quota/priority placeholder

Эдгээр нь security boundary болон trustworthy metric-ээс хойш хийгдэнэ.

---

## 14. Эхний 10 ticket

Маргааш шууд эхлэх дараалал:

1. Platform identity/auth ADR бичих
2. `PlatformPrincipal` Prisma schema нэмэх
3. Additive migration үүсгэх
4. Platform Admin bootstrap script хийх
5. Platform token/session contract хийх
6. `requirePlatformPermission` middleware хийх
7. Platform/tenant negative authorization test хийх
8. `/platform/v1/session` endpoint хийх
9. Frontend `/platform/login` болон guard хийх
10. `PlatformShell` болон хоосон `/platform` route гаргах

Эдгээр ticket дуусаагүй байхад dashboard card, chart, tenant table хийхгүй.

---

## 15. Анхны MVP-ийн Definition of Done

Read-only Control Tower MVP бэлэн гэж үзэхийн тулд:

- [x] Platform Admin tenant role-оос тусдаа identity-тэй
- [x] Platform login/session ажилладаг
- [x] `/platform` тусдаа shell-тэй
- [x] Project selector харагддаггүй
- [x] Company Admin platform API ашиглаж чаддаггүй
- [x] Platform Admin project mutation хийж чаддаггүй
- [x] Overview API бодит aggregate data буцаадаг
- [x] Five KPI exact formula-тай
- [x] Stale/unknown/insufficient state зөв харагддаг
- [x] Tenant, agent, system preview ажилладаг
- [x] Sensitive content response/UI-д байхгүй
- [x] Backend/frontend/OpenAPI test болон build PASS

---

## 16. Эцсийн хэрэгжүүлэх зарчим

> **Эхлээд эрхийг зөв салгана. Дараа нь итгэж болох metric гаргана. Тэгээд dashboard харуулна. Эцэст нь audited action нэмнэ.**

```text
Security boundary
→ Read-only vertical slice
→ Useful dashboard
→ Drill-down
→ Audited operations
→ Advanced automation
```
