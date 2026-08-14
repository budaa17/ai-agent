# BuildWatch v2.2 — Phase 11 production hardening ба release

**Төлөв:** `TECHNICAL_COMPLETE / RELEASE_EVIDENCE_PENDING`

**Technical gate:** `pnpm.cmd run phase11:fast:v22:gate`

**Full regression gate:** `pnpm.cmd run phase11:technical:v22:gate`

**External release gate:** `pnpm.cmd run phase11:release:v22:gate -- --evidence <manifest>`

> `PHASE 11 TECHNICAL GATE: PASS` нь repository дотор хэрэгжүүлж, автомат
> шалгаж болох хэсгийг илэрхийлнэ. `PHASE 11 FULL RELEASE:
PENDING_EXTERNAL_EVIDENCE` нь бодит deployment, бодит reviewer, consent болон
> production telemetry-ийн нотолгоо хараахан repository-оос автоматаар үүсэхгүйг
> зориуд илэрхийлнэ.

## 1. Security

- API бүх response дээр CSP, frame deny, no-sniff, referrer болон permissions
  policy тавина.
- Production HTTPS дээр HSTS идэвхжинэ.
- Proxy hop default `0`; production reverse proxy дээр зөвхөн `1` гэж explicit
  тохируулна.
- Ерөнхий API болон authentication endpoint тусдаа fixed-window rate limit-тэй.
- Malformed JSON, payload limit, content-type алдааг тогтвортой 4xx envelope-р
  буцаана.
- PDF/XLSX/PNG/JPEG/WEBP upload нь filename extension, declared MIME болон magic
  signature гурвыг тулгана.
- XLSX container нь path traversal, encrypted entry, ZIP64, идэвхтэй content,
  external link, entry count, expanded size болон compression ratio-г шалгана.
- PDF parser нь JavaScript eval-г хааж, page limit болон parse error дээр
  fail-closed байна.
- Image parser нь хэмжээ, pixel count, animation/frame болон malformed metadata-г
  шалгана.
- Production upload storage/DB write-ээс өмнө ClamAV INSTREAM scan заавал CLEAN
  болох ёстой.
- Malware, scanner error, spoofed content болон invalid container бүр storage-д
  орохгүй, audit-д category хэлбэрээр үлдэнэ.
- Signed artifact URL 1–3600 секунд, tenant/project/user scope, nonce болон HMAC
  signature-тай.
- Source content, prompt, token, password, authorization болон API key log/Sentry
  рүү орохгүй.
- Secret scanner `.env`-ийг зориуд уншихгүй, харин source/config/docs дахь өндөр
  итгэлтэй credential leakage-г fingerprint metadata-р илрүүлнэ.
- Tenant/project IDOR, A4 read-only scope, Phase 8 prompt-injection болон
  adversarial regression өмнөх gate-д хэвээр орно.

## 2. Performance

`src/performance/phase11.ts` нь correctness шалгалттай machine-local p95 gate.
2026-08-04-ний development machine дээр авсан анхны нотолгоо:

| Зам                         |        p95 |   Target | Үр дүн |
| --------------------------- | ---------: | -------: | ------ |
| API middleware HTTP         |  16.579 ms |   250 ms | PASS   |
| A5 50 work item             |  28.210 ms |   500 ms | PASS   |
| 20-page vector PDF          |  41.316 ms |  5000 ms | PASS   |
| Quantity → baseline         |  40.166 ms |  1000 ms | PASS   |
| Dashboard payload           |   4.482 ms |   500 ms | PASS   |
| Nightly deterministic batch | 864.298 ms | 30000 ms | PASS   |
| 25 MB artifact scan         |  68.548 ms |  3000 ms | PASS   |

Эдгээр нь regression босго бөгөөд production network/database concurrency load
test-ийг орлохгүй. Deployed topology дээрх p95 тайлан external release evidence-д
заавал орно.

**2026-08-05 шинэчлэлт:** Дараалсан (sequential) хэмжилтээс гадна одоо бодит
**concurrent** ачааллын тест бэлэн (`pnpm run loadtest:local`,
`docs/local-load-test-results.md`) — жинхэнэ production Express/Prisma
runtime + local Postgres-ийн эсрэг 50 зэрэгцээ холболтоор. Гэвч энэ нь
localhost/single-machine хэвээр тул deployed topology-ийн шаардлагыг
орлохгүй (доор дурдсан "орлохгүй" зохих хэвээр байна).

## 3. Observability

- API болон outbox worker JSON structured log ашиглана.
- Request бүр valid эсвэл generated `x-request-id` correlation ID-тай.
- Tenant/project ID plaintext log хийхгүй; SHA-256 telemetry tag ашиглана.
- Sentry default PII-г хааж, request/user/content/token-г before-send үед дахин
  redaction хийнэ.
- Langfuse зөвхөн public/secret key хоёулаа байвал асна; content logging default
  false хэвээр.
- `/internal/metrics` нь 32+ byte bearer token-гүй бол ажиллахгүй.
- Prometheus output нь HTTP count/latency, outbox status, artifact status, review
  backlog, сарын cost, 24 цагийн token/cost, agent failure category, image/quantity
  failure болон forecast drift-г агуулна.
- Outbox worker batch duration, claimed/published/failed/dead-letter count-г
  хэмжиж, минут тутам bounded snapshot log гаргана.
- Worker таван дараалсан infrastructure failure дээр process-г fail хийж
  orchestrator restart хийх боломж олгоно.

Metrics жишээ:

```powershell
$headers = @{ Authorization = "Bearer $env:PHASE11_METRICS_TOKEN" }
Invoke-WebRequest -Headers $headers http://127.0.0.1:4180/internal/metrics
```

## 4. Deployment

Production topology: PostgreSQL, RabbitMQ, ClamAV, one-shot migration, API,
outbox, A1–A3/analysis workers болон unprivileged Nginx frontend.

- Image бүр immutable `APP_RELEASE` tag-тай.
- Backend/frontend non-root user ашиглана.
- Application container read-only filesystem, bounded tmpfs, no-new-privileges,
  dropped Linux capabilities ашиглана.
- PostgreSQL/RabbitMQ/ClamAV зөвхөн internal network-д байна.
- Гадна талд зөвхөн frontend `8080` port expose хийнэ.
- Migration амжилттай дууссаны дараа application services асна.
- API readiness нь database query; frontend liveness нь internal endpoint ашиглана.
- Nginx frontend нь Docker-ийн `127.0.0.11` resolver-оор API upstream-ийг
  динамикаар дахин resolve хийнэ. API container шинэ IP-тай солигдсон ч frontend
  restart шаардахгүй; runtime replacement smoke 200 response-оор баталгаажсан.
- Production config нь HTTPS, independent secrets, non-guest RabbitMQ, ClamAV,
  metrics token, OpenAI cost үнэ болон backup key-г fail-closed шалгана.
- Backend dependency/runtime/migration/operations болон frontend image target-ууд
  2026-08-04-нд бодитоор build PASS; API/frontend/worker liveness, Prisma CLI,
  `pg_dump`/`pg_restore` container smoke PASS болсон.
- BuildKit-ийн pnpm/apt cache, bounded retry болон fetch timeout нь registry
  тасалдлыг дахин эхнээс татахгүйгээр үргэлжлүүлнэ; host `node_modules`, `dist`,
  `.env` build context-д орохгүй.
- Chromium болон PostgreSQL client system layer-ууд application source
  layer-оос тусдаа тул кодын өөрчлөлт бүр system package-г дахин суулгахгүй.
  2026-08-04-ний runtime audit-д warm-cache API rebuild 5.3 секунд,
  operations rebuild 3.2 секундэд бүрэн cache hit болсон.

Эхний тохиргоо:

```powershell
Copy-Item .env.production.example .env.production
# .env.production доторх blank/CHANGE_ME утгуудыг secret manager-ийн утгаар солино.
pnpm.cmd run ops:config:v22 -- --env .env.production
```

Deployment:

```powershell
powershell -ExecutionPolicy Bypass -File ops/deploy.ps1
```

Image build, backup эсвэл container өөрчлөлтгүйгээр env болон Compose config-г
урьдчилан шалгах:

```powershell
powershell -ExecutionPolicy Bypass -File ops/deploy.ps1 -ValidateOnly
```

Existing database илэрвэл deploy script эхлээд backup авна. Database container
stopped/removed байсан ч Compose-ийн `postgres-data` volume байвал existing гэж
үзнэ. Анхны хоосон орчинд backup шаардлагагүй; existing database дээр backup-г
алгасах бол зөвхөн explicit `-SkipBackup` ашиглана.

## 5. Backup ба restore

Backup нь:

1. `pg_dump --format=custom --no-owner --no-acl` ажиллуулна.
2. Local artifact tree-г symlink/special file-гүйгээр хуулна.
3. Database болон artifact бүрийн SHA-256-г manifest-д бичнэ.
4. Manifest-г тусдаа 32+ byte key-р HMAC-SHA256 гарын үсэг зурна.
5. Алдаа гарвал incomplete backup directory-г цэвэрлэнэ.

Operations image-ийн `pg_dump`/`pg_restore` major нь production PostgreSQL 16-тай
заавал ижил бөгөөд одоогийн image дээр хоёулаа `16.14`. Image нь PostgreSQL
server entrypoint эсвэл data volume өвлөөгүй, non-root `node` user-р ажиллана.

`artifact-data` volume нь `/app/data` parent дээр mount хийгдэнэ. Иймээс
`/app/data/artifacts`-ийг restore хийх үед staging болон
`artifacts.pre-<backup-id>` preservation directory-г ижил writable filesystem
дотор atomic rename-аар солих боломжтой; volume-г шууд
`/app/data/artifacts` leaf path дээр mount хийж болохгүй.

Chromium/Puppeteer нь read-only root filesystem дээр ажиллахдаа non-root
`node` user-ийн UID/GID-тай, хэмжээ хязгаартай `/home/node/.cache` болон
`/home/node/.config` tmpfs ашиглана. Эдгээр mount root-owned байвал PDF runtime
`chrome_crashpad_handler` алдаагаар fail хийнэ.

Container-ийн `no-new-privileges` болон `cap_drop: ALL` нь Chromium-ийн internal
setuid/namespace sandbox-тай нийцэхгүй тул Puppeteer `--no-sandbox` ашиглана.
Compensating control нь non-root user, read-only root filesystem, bounded tmpfs,
capability бүрэн хасалт болон dedicated container isolation байна.

```powershell
pnpm.cmd run ops:backup:v22
```

Restore нь default-оор ажиллахгүй. Manifest checksum/signature бүрэн зөв,
`RESTORE:<backup-id>` exact confirmation, production-д нэмэлт explicit opt-in
шаардана. Artifact-ийг staging directory-д бэлтгээд хуучин tree-г
`*.pre-<backup-id>` нэрээр хадгална. Database restore нь pg-boss partition
constraint болон backup-д байхгүй stale object-ийг зөв цэвэрлэхийн тулд
`public`, `pgboss` application schema-г reset хийх prelude-тэй SQL stream-ийг
`psql --single-transaction --set=ON_ERROR_STOP=1`-ээр ажиллуулдаг тул SQL
алдаанд бүх өөрчлөлт rollback хийнэ.

```powershell
$env:PHASE11_ALLOW_PRODUCTION_RESTORE = "true"
pnpm.cmd run ops:restore:v22 -- --backup <directory> --confirm RESTORE:<backup-id>
```

Restore-г maintenance window-д, хэрэглэгчийн write traffic хаасны дараа ажиллуулна.
Database болон object store нь нэг distributed transaction биш тул restore
дууссаны дараа API smoke, artifact checksum, latest audit/outbox count-г заавал
тулгана. Backup volume/object storage нь infrastructure түвшинд encrypted,
off-site replication болон access audit-тай байна.

## 6. Artifact lifecycle ба DLQ replay

Lifecycle үргэлж dry-run-аас эхэлнэ:

```powershell
pnpm.cmd run ops:artifacts:v22
pnpm.cmd run ops:artifacts:v22 -- --apply
```

Apply үед expired AVAILABLE asset эхлээд SERIALIZABLE transaction-аар
QUARANTINED болно. Object delete амжилттай бол DELETED; алдаа гарвал
QUARANTINED хэвээр үлдэж audit үүснэ.

DLQ replay нь event, tenant, project болон 10+ тэмдэгт operator reason-ийг exact
шаардана:

```powershell
pnpm.cmd run ops:outbox-replay:v22 -- --event <id> --tenant <tenant-id> --project <project-id> --reason "Publisher outage verified and resolved"
pnpm.cmd run ops:outbox-replay:v22 -- --event <id> --tenant <tenant-id> --project <project-id> --reason "Publisher outage verified and resolved" --apply
```

Retry count reset болон audit нэг SERIALIZABLE transaction-д хийгдэнэ. Consumer
талын idempotency record нь duplicate side effect-ийг үргэлжлүүлэн хамгаална.

## 7. Rollback ба incident

Application rollback:

```powershell
powershell -ExecutionPolicy Bypass -File ops/rollback.ps1 -Release <old-release>
```

Rollback script зөвхөн өмнө бүртгэсэн, local-д байгаа immutable image tag руу
application services-ийг буцаана. Frontend liveness болон API readiness хоёулаа
PASS болсны дараа л rollback амжилттай гэж гарна. Database migration-г
автоматаар reverse хийхгүй.
Backward-compatible migration биш бол maintenance window, баталгаажсан backup,
restore drill ашиглана.

Incident дараалал:

1. Write traffic болон автомат worker trigger-г зогсооно.
2. Correlation ID, release, container status, Sentry event, queue/dead-letter,
   database readiness, disk/backup status-г timestamp-тай хадгална.
3. Credential leak бол key rotation, session/token revocation, audit review хийнэ.
4. Malware бол artifact QUARANTINED хэвээр байлгаж, signature update хийсний дараа
   давтан scan хийнэ; source bytes-г analyst approval-гүй задлахгүй.
5. Queue failure бол publisher/root cause-г зассаны дараа dry-run, нэг event replay,
   дараа нь bounded batch replay хийнэ.
6. Data corruption бол signed manifest-тай хамгийн сүүлийн restore drill PASS
   backup-г сонгоно.
7. Recovery дараа health, tenant isolation, auth, upload, A1–A4, planning,
   forecast, dashboard болон audit smoke ажиллуулна.
8. Root-cause, impact window, tenant scope, corrective action, owner болон due
   date бүхий incident record гаргана.

## 8. Technical exit checklist

- [x] General API rate limit
- [x] Authentication rate limit
- [x] Security response headers
- [x] Production HSTS
- [x] Proxy trust explicit configuration
- [x] Stable malformed/oversize request errors
- [x] Artifact MIME/signature/extension verification
- [x] XLSX zip-bomb policy
- [x] PDF safe parser policy
- [x] Image resource limits
- [x] Built-in local malware regression scanner
- [x] Production ClamAV INSTREAM scanner
- [x] Malware fail-closed before persistence
- [x] Rejected artifact audit category
- [x] Signed URL scope/expiry regression
- [x] Secret scanner
- [x] Structured log privacy/redaction
- [x] Sentry privacy integration
- [x] Langfuse optional paired configuration
- [x] Correlation/trace ID propagation
- [x] Hashed tenant/project telemetry tags
- [x] Authenticated Prometheus endpoint
- [x] Queue/outbox metrics
- [x] Token/cost budget metrics
- [x] Forecast drift metric
- [x] Image/quantity failure category metrics
- [x] API p95 benchmark
- [x] 50-work-item planning benchmark
- [x] 20-page PDF benchmark
- [x] Quantity/baseline benchmark
- [x] Dashboard payload benchmark
- [x] Nightly deterministic batch benchmark
- [x] 25 MB artifact scan benchmark
- [x] Multi-stage backend images
- [x] Unprivileged frontend image
- [x] Production Compose topology
- [x] One-shot migration service
- [x] Health/readiness checks
- [x] Signed database/artifact backup manifest
- [x] Fail-closed restore confirmation
- [x] Artifact restore staging/preservation
- [x] Artifact retention lifecycle
- [x] Audited DLQ replay
- [x] Pre-deployment backup
- [x] Immutable release tags
- [x] Application rollback script
- [x] Incident runbook
- [x] Technical tests and performance report
- [x] Checksum-bound full release evidence schema/gate

## 9. Full release acceptance — external evidence

External evidence-г `data/release-evidence/<release>/phase11-evidence.json`
manifest-д бүртгэнэ. Manifest нь 10+ бодит drawing/BOQ case, 60+ зөвшөөрөлтэй
зураг, deployment шалгалтууд болон domain/security/operations гэсэн гурван өөр
sign-off-г агуулна. Claim бүр тусдаа regular file, `PASS`, бодит хариуцагчийн
нэр, timezone-тай timestamp, lowercase SHA-256-тай байна. `demo`, `test`,
`synthetic`, `placeholder` issuer болон duplicate/path traversal/checksum mismatch
fail-closed хориглогдоно.

```powershell
(Get-FileHash -Algorithm SHA256 <evidence-file>).Hash.ToLowerInvariant()
pnpm.cmd run phase11:release:v22:gate -- --evidence data/release-evidence/<release>/phase11-evidence.json
```

- [ ] Real engineer-reviewed drawing/BOQ dataset manifest and sign-off
- [ ] Real human-reviewed 60+ photo dataset, owner consent and sign-off
- [ ] Deployed two-tenant API/UI/A4 isolation report
- [ ] Deployed auth/RBAC/refresh rotation smoke report
- [ ] Real mobile offline/no-data-loss field test report
- [ ] Production topology load-test report
- [ ] Independent OWASP/pentest report
- [ ] Production backup/restore drill evidence
- [ ] Live Sentry alert evidence
- [ ] Live Langfuse trace/cost evidence with content logging disabled
- [ ] Operations and security owner release sign-off

Эдгээр external artifact байхгүй үед technical code PASS байсан ч full production
release-г PASS гэж зарлахгүй.

**PHASE 11 TECHNICAL GATE: PASS**

**PHASE 11 FULL RELEASE: PENDING_EXTERNAL_EVIDENCE**
