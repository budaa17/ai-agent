# BuildWatch v2.2 — Phase 10 production frontend ба PWA

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase10:v22:gate`  
**Frontend:** React 19 + TypeScript strict + Tailwind 4 + Vite 8  
**Contract:** OpenAPI 3.1 generated client + strict Zod runtime validation

## 1. Зорилго

Phase 10 нь Phase 9-ийн canonical PostgreSQL backend-ийг desktop болон талбайн
mobile хэрэглээнд зориулсан production frontend/PWA-тай холбов. UI дахь төсөв,
явц, schedule, report, review, artifact болон A4 хариулт нь hardcode/mock биш,
JWT-аар хамгаалагдсан tenant/project-scoped API-аас ирнэ.

Үндсэн урсгал:

```text
Login → JWT access/refresh rotation → session + project membership
      → generated OpenAPI client → strict Zod response parse
      → TanStack Query cache → role-based React route
      → human review / offline report queue
      → canonical PostgreSQL + audit + outbox + idempotency
```

Browser руу OpenAI key, database URL эсвэл signing secret дамжуулахгүй. A0–A5-ийн
тооцоолол, authorization, source integrity болон canonical write дүрэм backend-д
хэвээр үлдэнэ; frontend зөвхөн хэрэглэгчийн interaction boundary байна.

## 2. Frontend architecture

| Давхарга      | Хэрэгжилт                         | Шалтгаан                                       |
| ------------- | --------------------------------- | ---------------------------------------------- |
| UI runtime    | React 19                          | route, state, reusable production component    |
| Type safety   | TypeScript strict                 | API/UI field зөрүүг build үед хориглох         |
| Styling       | Tailwind 4 + semantic CSS         | responsive field-use layout ба төлөвүүд        |
| Router        | React Router 7                    | auth/project permission route guard            |
| Server state  | TanStack Query                    | workspace cache, invalidation, loading/error   |
| API           | `openapi-fetch` + generated types | OpenAPI contract-оос typed request үүсгэх      |
| Runtime guard | Zod strict schemas                | буруу/илүү/дутуу API shape-ийг UI-д оруулахгүй |
| Offline       | IndexedDB (`idb`)                 | draft, photo bytes, workspace cache, outbox    |
| PWA           | manifest + service worker         | app shell/assets offline нээх                  |
| Icons         | Lucide React                      | consistent accessible icon component           |

`agent-console/public` болон `server.mjs` дахь хуучин vanilla console нь active
Vite build-д орохгүй; шаардлагатай үед зөвхөн `legacy:start` командаар тусад нь
ажиллана.

## 3. Auth, route ба RBAC

| Route                         | Permission            | Үүрэг                               |
| ----------------------------- | --------------------- | ----------------------------------- |
| `/login`                      | public                | tenant/email/password login         |
| `/projects`                   | authenticated         | бодит project list/create           |
| `/projects/:projectId`        | `PROJECT_READ`        | dashboard, progress, cost, alerts   |
| `/projects/:projectId/a0`     | `DESIGN_READ`         | design→baseline workspace           |
| `/projects/:projectId/a1`     | `REPORT_READ`         | A1 structured draft review          |
| `/projects/:projectId/a2`     | `FORECAST_READ`       | observation/recommendation review   |
| `/projects/:projectId/a3`     | `REPORT_READ`         | document/PDF review                 |
| `/projects/:projectId/a4`     | `CHAT_READ`           | read-only source-backed chat        |
| `/projects/:projectId/a5`     | `PLAN_READ`           | plan/report/verification/forecast   |
| `/projects/:projectId/alerts` | authenticated project | alert/detail workspace              |
| `/admin`                      | `TENANT_ADMIN`        | invitation ба tenant administration |

Access token browser session storage-д хадгалагдана. `401` үед refresh token-ийг
нэг удаа rotate хийж request-ийг дахин явуулна; refresh амжилтгүй бол session-г
цэвэрлэж login руу буцаана. Project permission байхгүй route нь тухайн project-ийн
overview руу буцна. Backend нь route guard-д итгэхгүй, permission болон tenant IDOR-г
дахин шалгана.

## 4. Production API урсгал

Phase 10 нэмсэн API:

| Method | Endpoint                                      | Canonical үр дүн                                    |
| ------ | --------------------------------------------- | --------------------------------------------------- |
| GET    | `/v1/session`                                 | user, tenant role, project membership/permission    |
| POST   | `/v1/projects`                                | project + membership + audit + outbox + idempotency |
| GET    | `/v1/projects/:projectId/workspace`           | A0–A5 нэг tenant-scoped read model                  |
| POST   | `/v1/projects/:projectId/artifacts`           | binary object + SHA-256 + registry + event          |
| POST   | `/v1/projects/:projectId/daily-report-drafts` | report + progress/attendance/photo + review task    |
| POST   | `/v1/projects/:projectId/chat`                | A4 source-backed read-only answer                   |

Workspace response нь project role-оор design, estimate, plan, report,
verification, forecast, artifact field-үүдийг server талд шүүнэ. Permission байхгүй
өгөгдлийг UI-д нуух төдий биш, response-д оруулахгүй.

## 5. A0 дэлгэц

A0 workspace дараах долоон tab-тай:

1. PDF/XLSX/JPEG/PNG/WebP upload, client SHA-256, signed artifact preview;
2. document/revision/page/scale ба element source харагдац;
3. quantity version/item/source review;
4. estimate line, norm/price mapping review;
5. WBS ба dependency;
6. planned schedule/Gantt, critical activity ялгалт;
7. baseline review/approve/reject component.

Upload нь extraction-ийг browser дотор хийдэггүй. Binary canonical artifact
registry-д орж, Phase 9 worker/A0 orchestration дараагийн versioned боловсруулалтыг
хийх boundary-г хадгална.

## 6. A1–A4 дэлгэц

- **A1:** source, structured field, confidence, evidence, validation,
  clarification, duplicate marker болон review recommendation харуулна. Бага
  confidence field тусгай өнгөтэй. Canonical `ReviewTask`-тай draft л approve/reject
  mutation хийж чадна; link байхгүй legacy draft-ийг applied гэж худал тэмдэглэхгүй.
- **A2:** deterministic signal/evidence/root cause/recovery impact болон
  recommendation draft-ийг review component-той харуулна.
- **A3:** report/conclusion/letter draft, artifact, signed PDF preview болон
  review component харуулна.
- **A4:** project-ийн зөвшөөрөгдсөн canonical workspace-ийг read-only уншиж,
  claim бүрийг source chip-тэй хариулна. Нотолгоо олдохгүй үед
  `INSUFFICIENT_EVIDENCE`; tool ашиглаагүй зохиомол хариулт өгөхгүй.

## 7. A5 field PWA

A5 дөрвөн үндсэн хэсэгтэй:

- **Өдрийн plan:** plan item, crew/equipment/material/precondition, conflict;
- **Оройн тайлан:** дөрвөн шаттай mobile wizard;
- **Verification:** photo/source, issue, approval state, before/after;
- **Forecast/recovery:** projected finish, delay, driver, scenario/review.

Daily-report core flow:

```text
1. Ажил сонгох
2. Quantity/progress оруулах
3. Attendance болон 1–5 зураг хавсаргах
4. Review summary → offline queue/submit
```

Зурагтай үндсэн замын тооцоолсон primary interaction `6`, зорилт `≤ 10`.
Server submit нь report, progress, attendance, photo link, `ReviewTask`, `AuditLog`,
`OutboxEvent`, `IdempotencyRecord`-ийг нэг `SERIALIZABLE` transaction-аар үүсгэнэ.

## 8. Offline ба sync

IndexedDB дөрвөн store ашиглана:

1. хамгийн сүүлийн authorized workspace cache;
2. edit хийж буй daily-report draft;
3. browser-д хадгалсан photo `ArrayBuffer`;
4. upload/report outbox entry.

Sync дараалал:

```text
offline draft + photo
→ IndexedDB transaction
→ online event/manual retry
→ photo upload (stable idempotency key + SHA-256)
→ returned FileAsset ID-г draft-д холбоно
→ daily report submit (өөр stable idempotency key)
→ success бол local photo/draft/outbox цэвэрлэнэ
```

Exponential retry ашиглана. `409` conflict-ийг автоматаар нуухгүй: entry
`CONFLICT` төлөвтэй үлдэж, хэрэглэгч шалгасны дараа шинэ idempotency key-ээр retry
хийдэг. API cache-ийг service worker-д хадгалдаггүй тул өөр хэрэглэгчийн protected
response app-shell cache-д холилдохгүй. Offline no-data-loss test нь photo bytes,
draft болон upload→report order-г баталсан.

## 9. UI төлөв ба accessibility

- desktop sidebar ба mobile responsive layout;
- loading, error, empty, offline, retry, conflict төлөв;
- keyboard focus ring, label, alert/status semantics;
- route/tab/button-ын accessible name;
- compact data table болон mobile card layout;
- service worker production build дээр бүртгэгдэнэ;
- manifest/icon/theme metadata бэлэн;
- browser auto-translate-д найдахгүй Монгол product copy ашиглана.

## 10. Ажиллуулах

PostgreSQL migration болон анхны tenant/admin нэг удаа бэлэн болсон байна. Дараа нь:

```powershell
cd C:\Users\user\Desktop\diplom\agent-console
pnpm.cmd dev
```

Нэг command дараахыг хийнэ:

1. backend OpenAPI-г export хийж generated TypeScript client шинэчилнэ;
2. `http://127.0.0.1:4180/health/ready` байхгүй бол production API асаана;
3. API ready болтол хүлээнэ;
4. React PWA-г `http://127.0.0.1:4173` дээр асаана;
5. `Ctrl+C` үед өөрийн асаасан child process-уудыг хаана.

PostgreSQL эсвэл migration бэлэн биш бол backend ready болохгүй бөгөөд UI-г
ганцааранг нь “бэлэн” гэж зарлахгүй.

## 11. Баталгаажуулалт

- TypeScript strict: `PASS`;
- generated OpenAPI client: `PASS`;
- production Vite build: `PASS`;
- Component tests: `7/7 PASS`;
- Backend Phase 10 E2E: `6/6 PASS`;
- PostgreSQL smoke: `7/7 PASS`;
- tenant workspace IDOR: `PASS`;
- artifact SHA-256/idempotency: `PASS`;
- daily report/review/audit/outbox idempotency: `PASS`;
- A4 claim/source grounding: `PASS`;
- offline no-data-loss: `PASS`;
- offline conflict/manual retry: `PASS`;
- role-based route guard: `PASS`;
- A5 core tap target: `PASS` (`6 ≤ 10`).

PostgreSQL report:

- `data/evaluations/buildwatch-v22-phase10-postgres.json`.

## 12. Exit gate checklist

- [x] React 19 application root бүрэн.
- [x] TypeScript strict config бүрэн.
- [x] Tailwind 4/Vite integration бүрэн.
- [x] React Router route tree бүрэн.
- [x] TanStack Query provider бүрэн.
- [x] Toast/error feedback бүрэн.
- [x] OpenAPI 3.1 export бүрэн.
- [x] Generated API TypeScript client бүрэн.
- [x] Strict Zod response parsing бүрэн.
- [x] Stable API error display бүрэн.
- [x] JWT login form бүрэн.
- [x] Access token attach бүрэн.
- [x] Refresh rotation retry бүрэн.
- [x] Logout/session clear бүрэн.
- [x] Session/membership bootstrap бүрэн.
- [x] Authenticated route guard бүрэн.
- [x] Project permission route guard бүрэн.
- [x] Tenant admin route guard бүрэн.
- [x] Project list бодит API-тай.
- [x] Project create бодит API-тай.
- [x] Project create idempotency бүрэн.
- [x] Project dashboard бодит workspace-тай.
- [x] Planned/actual progress харагдац бүрэн.
- [x] Projected finish/delay харагдац бүрэн.
- [x] Budget/actual cost/variance харагдац бүрэн.
- [x] Critical activity/alert metric бүрэн.
- [x] A0 artifact upload бүрэн.
- [x] A0 client SHA-256 бүрэн.
- [x] A0 signed artifact preview бүрэн.
- [x] A0 drawing/revision/scale/source бүрэн.
- [x] A0 quantity review бүрэн.
- [x] A0 estimate review бүрэн.
- [x] A0 WBS/dependency бүрэн.
- [x] A0 Gantt/critical styling бүрэн.
- [x] A0 baseline review component бүрэн.
- [x] A1 structured draft review бүрэн.
- [x] A1 low-confidence highlight бүрэн.
- [x] A1 evidence/validation/clarification бүрэн.
- [x] A1 unsafe auto-apply байхгүй.
- [x] A2 observation/root-cause view бүрэн.
- [x] A2 recommendation review бүрэн.
- [x] A3 document/PDF preview бүрэн.
- [x] A3 review component бүрэн.
- [x] A4 read-only chat бүрэн.
- [x] A4 claim/source chip бүрэн.
- [x] A4 insufficient-evidence state бүрэн.
- [x] A5 daily plan board бүрэн.
- [x] A5 resource/material/precondition conflict бүрэн.
- [x] A5 four-step daily-report wizard бүрэн.
- [x] A5 1–5 photo local persistence бүрэн.
- [x] A5 progress/attendance input бүрэн.
- [x] A5 verification/before-after view бүрэн.
- [x] A5 forecast/recovery view бүрэн.
- [x] A5 plan/recovery review component бүрэн.
- [x] Core flow ≤10 tap contract бүрэн.
- [x] PWA manifest/icon бүрэн.
- [x] Production service worker бүрэн.
- [x] Authorized workspace local cache бүрэн.
- [x] IndexedDB draft store бүрэн.
- [x] IndexedDB photo bytes store бүрэн.
- [x] IndexedDB outbox бүрэн.
- [x] Photo→report ordered sync бүрэн.
- [x] Stable idempotency key бүрэн.
- [x] Exponential retry бүрэн.
- [x] Conflict UX/manual retry бүрэн.
- [x] Offline no-data-loss test бүрэн.
- [x] Desktop responsive layout бүрэн.
- [x] Mobile field layout бүрэн.
- [x] Loading/error/empty states бүрэн.
- [x] Backend workspace IDOR test бүрэн.
- [x] Backend binary upload E2E бүрэн.
- [x] Backend daily report E2E бүрэн.
- [x] Backend A4 grounding E2E бүрэн.
- [x] PostgreSQL project idempotency smoke бүрэн.
- [x] PostgreSQL artifact idempotency smoke бүрэн.
- [x] PostgreSQL report/review/outbox smoke бүрэн.
- [x] One-command API + PWA orchestrator бүрэн.
- [x] Production build болон component suite бүрэн.

**PHASE 10 EXIT GATE: PASS**

## 13. Phase 10-ийн хил

Phase 10 нь deployed cloud release гэж зарлаагүй. Production malware scanner,
cloud object store, load/SLO benchmark, full OWASP test, Sentry/queue alert,
Docker image, backup/restore, deployment/rollback болон real-data acceptance нь
Phase 11-ийн gate хэвээр. Хуучин A1/A2/A3 draft-д canonical `ReviewTask` байхгүй бол
UI түүнийг шууд apply хийхгүй; backend migration/orchestration task үүсгэсний дараа
generic review component mutation хийнэ.
