# BuildWatch Production Frontend/PWA

`agent-console` нь BuildWatch v2.2-ийн React 19 + TypeScript strict production
frontend/PWA. Энэ нь `agents` backend-ийн бодит PostgreSQL/OpenAPI API-тай ажиллана;
browser дотор mock project үүсгэж production мэт харагдуулахгүй.

## Нэг командаар ажиллуулах

PostgreSQL, migration, tenant/admin нэг удаа бэлэн болсон үед:

```powershell
cd C:\Users\user\Desktop\diplom\agent-console
pnpm.cmd dev
```

- UI: `http://127.0.0.1:4173`
- API: `http://127.0.0.1:4180`
- OpenAPI: `http://127.0.0.1:4180/openapi.json`

`dev` нь OpenAPI client-ийг шинэчилж, API ажиллаагүй бол асааж readiness хүлээгээд,
дараа нь Vite PWA-г асаана. Зогсоохдоо `Ctrl+C` дарна. Windows дээр
`start-agent-console.cmd`-ийг давхар товшиж болно.

## Анхны setup

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd docker:up
pnpm.cmd run db:migrate:deploy
pnpm.cmd seed

$env:PHASE9_BOOTSTRAP_EMAIL="admin@example.com"
$env:PHASE9_BOOTSTRAP_PASSWORD="change-this-strong-password"
pnpm.cmd run bootstrap:phase9 -- --tenant nomad-build --email admin@example.com
```

`--tenant` нь tenant-ийн **slug**-ийг авна. Seed хийсэн demo tenant-ийн slug нь
`nomad-build` (`tenant-demo` бол түүний id — CLI хэрэгслүүд түүнийг ашигладаг).

Дараа нь UI-д зөвхөн **имэйл, нууц үгээрээ** нэвтэрнэ — байгууллагыг систем өөрөө олно.
Нэг имэйл олон байгууллагад бүртгэлтэй бол нууц үг шалгагдсаны **дараа** байгууллага
сонгох алхам гарч ирнэ (сонголтод зөвхөн тухайн нууц үг нээсэн байгууллагууд орно, тул
нэвтрэх хуудсаар хэн хаана ажилладгийг тандах боломжгүй). Нууц үг 12-оос доошгүй тэмдэгт
байна. `.env` дахь secret/key browser response-д дамжихгүй.

## UI чадвар

- **Dashboard:** planned/actual progress, projected finish, төсөв/зардал, alert;
- **A0:** artifact upload, drawing/revision/scale/source, quantity, estimate,
  WBS/dependency, Gantt, baseline review;
- **A1:** structured draft, confidence/evidence/validation, human review;
- **A2:** risk/root-cause/recommendation review;
- **A3:** document/PDF draft review;
- **A4:** project-scoped read-only, source-backed chat;
- **A5:** plan conflict, four-step mobile report, 1–5 зураг, offline sync,
  verification, forecast/recovery;
- **Admin:** invitation ба role-based tenant administration.

## Offline ажиллагаа

PWA нь app shell-ээ service worker-оор, authorized workspace/draft/photo/outbox-оо
IndexedDB-д хадгална. Protected API response service-worker cache-д орохгүй.
Photo эхэлж upload хийгдээд returned asset ID-тай daily report дараа нь илгээгдэнэ.
Stable idempotency key, exponential retry, explicit `409` conflict төлөвтэй.

## Validation

Frontend:

```powershell
pnpm.cmd verify
```

Бүх Phase 0–10 gate, backend E2E, frontend test/build, бодит PostgreSQL smoke:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd run phase10:v22:gate
```

Phase 10 targeted command:

```powershell
pnpm.cmd run test:phase10:v22
pnpm.cmd run verify:frontend:v22
pnpm.cmd run smoke:phase10:postgres:v22
```

## Security boundary

- Frontend route guard нь UX хамгаалалт; backend permission дахин шалгана.
- Cross-tenant project ID нь ижил `PROJECT_NOT_FOUND` хариутай.
- AI/draft нь canonical data-д шууд write хийхгүй.
- Approve/reject/apply нь canonical `ReviewTask` болон row version шаарддаг.
- Artifact нь size/media type/path/SHA-256 guard болон signed read ашиглана.

Хуучин vanilla local workbench шаардлагатай бол `pnpm.cmd legacy:start` командаар
тусад нь ажиллана; Vite production build түүнийг ашиглахгүй.
