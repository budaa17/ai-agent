# BuildWatch — $0 Deploy Roadmap

> Зорилго: BuildWatch-ийг эхлээд дипломын demo/staging хэлбэрээр сарын hosting төлбөргүй нийтэд нээж, дараа нь боломжтой бол Oracle Cloud Always Free дээр 24/7 ажиллуулах.
>
> Энэ roadmap нь **production launch биш**. Stripe Test Mode ашиглана. Бодит хэрэглэгчээс мөнгө авах, SLA амлах, нууц/бодит барилгын материал хадгалахыг бүх acceptance test дуусахаас өмнө хориглоно.

## 2026-08-14 — Одоогийн хэрэгжилтийн төлөв

Ажиллаж буй түр demo URL:

```text
https://broader-comparative-point-promoting.trycloudflare.com
```

Дууссан автомат шалгалт:

- Production-like Docker stack build/start амжилттай; PostgreSQL, RabbitMQ, ClamAV, API, frontend болон бүх worker healthy.
- 24 Prisma migration болон billing catalog/Stripe sandbox price bootstrap амжилттай.
- Local болон Cloudflare HTTPS URL дээр frontend, API live/ready, public plans бүгд 200.
- Public route/browser marketing audit 52/52 PASS; mobile, accessibility, pricing API, SEO, console/network алдаагүй.
- Stripe CLI test listener зөвхөн Docker webhook route рүү дамжуулж, harmless test event 202 авсан.
- Platform Super Admin secure prompt-оор bootstrap хийгдэж, public login/session/Control Tower request болон immutable login audit амжилттай.
- Public signup → бодит email code → Stripe Test Checkout → paid webhook → account setup → Company Admin login end-to-end амжилттай.
- Paid signup нь ACTIVE tenant, ACTIVE Starter/YEAR subscription, PAID MNT invoice болон нэг удаагийн consumed setup token үүсгэсэн.
- Stripe invoice event checkout-оос түрүүлж ирэх race засагдсан: paid Checkout Session invoice-г authoritative Stripe API-аас хамт project хийнэ.
- `billing:reconcile:stripe-invoices` operational command нэмэгдэж, давтан ажиллуулахад invoice count нэг хэвээр байсан.
- PostgreSQL restart хийсний дараа catalog data хадгалагдаж, API болон worker-ууд healthy болсон.
- `.env.production`, runtime log, `.tools/` binary Git ignore-д орсон.
- Public HTTPS response CSP болон HSTS header-тэй.

Stage A complete болоход үлдсэн acceptance:

- Private Git remote болон deploy commit SHA хараахан байхгүй.
- PDF upload/ClamAV/signed preview, A0→worker flow, tenant isolation болон platform default-deny-г шинэ deployment дээр шалгах.

Quick Tunnel restart бүрт URL өөрчлөгдөнө. Дээрх URL тухайн `cloudflared` process ажиллаж байх хугацаанд хүчинтэй.

## 1. Эцсийн сонголт

### Stage A — эхний сонголт: Windows PC + Cloudflare Quick Tunnel

```text
Internet
   │ HTTPS — random-name.trycloudflare.com
   ▼
Cloudflare Quick Tunnel
   │
   ▼ localhost:8080
Nginx frontend
   ├── React SPA
   └── /api/* → Node API:4180
                    ├── PostgreSQL
                    ├── RabbitMQ
                    ├── ClamAV
                    ├── Outbox + bridge worker
                    └── A1/A2/A3/analysis workers
```

- Hosting болон HTTPS: $0.
- Domain болон Cloudflare account: шаардахгүй.
- Одоогийн Docker Compose архитектурыг өөрчлөхгүй.
- Компьютер, Docker Desktop, tunnel ажиллаж байх хугацаанд л сайт нээлттэй байна.
- Tunnel restart бүрт public URL өөрчлөгдөнө.
- Cloudflare Quick Tunnel нь зөвхөн test/demo зориулалттай; SLA байхгүй, 200 зэрэг хүсэлтийн хязгаартай, SSE дэмжихгүй.

### Stage B — дараагийн сонголт: Oracle Cloud Always Free

- Hosting: Always Free хязгаарт багтвал $0.
- 24/7 ажиллуулах боломжтой боловч capacity олдох баталгаа байхгүй.
- `Always Free Eligible` гэж Console дээр тэмдэглэгдсэн ARM instance л сонгоно.
- ARM64 дээр бүх Docker image болон Chromium/ClamAV ажиллагааг заавал шалгана.
- Oracle бага ашиглалттай Always Free instance-ийг reclaim хийж болох тул production SLA гэж үзэхгүй.

## 2. $0 гэдэгт орохгүй зардал

Deploy өөрөө $0 байж болох ч дараах үйлчилгээ тусдаа нөхцөлтэй:

| Үйлчилгээ | Demo үед | Бодит хэрэглээ |
|---|---|---|
| Stripe | Test Mode $0 | Гүйлгээний шимтгэлтэй |
| OpenAI API | Mock/унтраавал $0 | Token хэрэглээ төлбөртэй |
| SMTP | Gmail зэрэг provider-ийн үнэгүй quota | Quota давбал төлбөртэй байж болно |
| Domain | Quick Tunnel-д хэрэггүй | Тогтвортой branded domain ихэнхдээ төлбөртэй |
| Backup | Local volume | Off-site storage нэмбэл нөхцөлөөс хамаарна |

Иймээс яг $0 demo хийхдээ Stripe Test Mode ашиглаж, AI ажиллагааг mock хийх эсвэл OpenAI-ийн өөрийн байгаа credit/key-г хэрэглэнэ.

---

# Stage A — Local PC + Cloudflare Tunnel

## Phase 0 — Public болгохоос өмнөх аюулгүй байдлын хаалга

### 0.1 Repository-г тогтворжуулах

- [ ] Одоогийн өөрчлөлтүүдийг шалгаж, зориудын өөрчлөлтүүдийг нэг цэгт commit хийх.
- [ ] Private GitHub repository үүсгэж remote холбоно.
- [ ] `.env`, `.env.production`, log, upload, database dump, Stripe/SMTP secret Git-д ороогүйг шалгана.
- [ ] Working tree дээрх устгал болон танихгүй өөрчлөлтийг хүчээр reset хийхгүй.
- [ ] Deploy хийх commit SHA-г тэмдэглэнэ.

Одоогийн аудитын төлөв:

- Git remote тохируулаагүй.
- Working tree олон өөрчлөлттэй байгаа тул шууд auto-deploy хийхгүй.
- Эхлээд нэг reproducible build/commit гаргах шаардлагатай.

### 0.2 Нууц түлхүүрүүд

- [ ] `PHASE9_JWT_SECRET`, `PHASE9_CURSOR_SECRET`, artifact signing secret тус бүр өөр, random, 32+ byte байна.
- [ ] Tenant болон Platform JWT secret/claim boundary холилдоогүй байна.
- [ ] Stripe Test secret key ба webhook secret ашиглана; live key ашиглахгүй.
- [ ] SMTP password болон app password source control-д байхгүй байна.
- [ ] Өмнө нь screenshot/chat/log-д ил гарсан secret байвал rotate хийнэ.
- [ ] Demo Super Admin password-ийг public URL нээхээс өмнө солино.
- [ ] Metrics endpoint token-оор хамгаалагдсан байна.

Secret үүсгэх PowerShell жишээ:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Үүссэн утгыг зөвхөн `agents/.env.production` дотор хадгална. Chat, commit, screenshot-д оруулахгүй.

### 0.3 Deploy blocker засвар

- [ ] Email code ирдэг, зөв кодоор verify хийхэд 2xx буцаадаг.
- [ ] Verify хийсний дараа Stripe Checkout URL үүсэж browser redirect хийдэг.
- [ ] `Internal server error` бүрэн арилсан байна.
- [ ] Stripe success redirect нь signup/checkout ID-гаа алдахгүй байна.
- [ ] Webhook ирсний дараа л tenant/subscription ACTIVE болдог.
- [ ] Төлбөрийн success page redirect-ийг төлбөрийн нотолгоо гэж ашигладаггүй.
- [ ] Paid Company Admin нэг удаагийн setup flow-оор password үүсгэж чаддаг.
- [ ] PDF upload, malware scan, signed preview end-to-end ажиллана.
- [ ] Platform Super Admin tenant operational mutation хийж чаддаггүй.

Эдгээрээс аль нэг нь унавал public tunnel нээхгүй.

### 0.4 Эхний Platform Super Admin үүсгэх

Public chat-д өмнө бичсэн demo password-ийг дахин ашиглахгүй. Password terminal history-д
харагдуулахгүй secure prompt ашиглана:

```powershell
cd C:\Users\user\Desktop\diplom
.\agents\scripts\bootstrap-free-platform-admin.ps1
```

Script email болон шинэ 12–200 тэмдэгт password асуугаад зөвхөн ажиллаж буй Docker database-д
`PLATFORM_SUPER_ADMIN` үүсгэнэ. Password-ийг файлд бичихгүй, terminal-д хэвлэхгүй. Энэ staging
helper `--mfa-enrolled` ашиглаж байгаа; бодит production launch-д MFA enrollment flow-оор солино.

## Phase 1 — Шаардлагатай програм

- [ ] Docker Desktop суусан, Linux containers ажилладаг.
- [ ] Docker Compose v2 ажилладаг.
- [ ] `cloudflared` суулгана.
- [ ] Git болон Node/pnpm зөвхөн build/debug-д бэлэн байна.

Шалгах:

```powershell
docker version
docker compose version
cloudflared --version
```

Cloudflared суулгах боломжит команд:

```powershell
winget install --id Cloudflare.cloudflared
```

Суулгасны дараа шинэ terminal нээнэ.

## Phase 2 — Production-like env бэлтгэх

`agents/.env.production.example`-ийг secret утгагүй template болгон ашиглаж, `agents/.env.production` үүсгэнэ. Энэ файл Git-д орох ёсгүй.

Cloudflare Quick Tunnel URL гарсны дараа одоо байгаа ignored `agents/.env`-ийн
SMTP/Stripe/OpenAI тохиргоог хуулж, deploy secret-үүдийг шинээр үүсгэх санал болгосон команд:

```powershell
cd agents
pnpm run deploy:free:prepare -- --public-url https://random-words.trycloudflare.com
cd ..
```

Энэ script нь Stripe live key-г зөвшөөрөхгүй, secret утгуудыг terminal-д хэвлэхгүй,
мөн байгаа `.env.production`-ийг `--force`-гүйгээр дарж бичихгүй.

Эхний local утга:

```dotenv
NODE_ENV=production
APP_RELEASE=demo-YYYYMMDD-01

POSTGRES_USER=buildwatch
POSTGRES_PASSWORD=<random-secret>
POSTGRES_DB=buildwatch
BUILDWATCH_DATABASE_URL=postgresql://buildwatch:<url-encoded-password>@postgres:5432/buildwatch

RABBITMQ_USER=buildwatch
RABBITMQ_PASSWORD=<random-secret>
RABBITMQ_URL=amqp://buildwatch:<url-encoded-password>@rabbitmq:5672

BUILDWATCH_PUBLIC_BASE_URL=http://127.0.0.1:8080
BUILDWATCH_HTTP_PORT=8080

PHASE9_JWT_SECRET=<independent-random-secret>
PHASE9_CURSOR_SECRET=<independent-random-secret>
PHASE9_ARTIFACT_SIGNING_SECRET=<independent-random-secret>
PHASE11_METRICS_TOKEN=<independent-random-secret>

SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp-user>
SMTP_PASSWORD=<smtp-app-password>
SMTP_FROM=<verified-from-address>
SMTP_REPLY_TO=<reply-address>
PHASE9_EMAIL_VERIFICATION_SECRET=<independent-random-secret>

BILLING_PROVIDER=STRIPE
STRIPE_SECRET_KEY=<stripe-test-secret-key>
STRIPE_WEBHOOK_SECRET=<stripe-test-webhook-secret>

OPENAI_API_KEY=<existing-key-or-demo-key>
AGENT_INPUT_COST_MICRO_USD_PER_MILLION_TOKENS=<current-configured-value>
AGENT_OUTPUT_COST_MICRO_USD_PER_MILLION_TOKENS=<current-configured-value>
```

Анхаарах зүйл:

- Password дотор `@`, `:`, `/`, `#` зэрэг тэмдэг байвал database/RabbitMQ URL-д URL encode хийнэ.
- Browser-д очих `VITE_*` variable-д secret хийхгүй.
- Quick Tunnel URL гарсны дараа `BUILDWATCH_PUBLIC_BASE_URL`-ийг шинэчилнэ.

## Phase 3 — Docker stack build ба start

Repository root-оос:

```powershell
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml config
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml build
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml up -d
```

Төлөв шалгах:

```powershell
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml ps
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml logs --tail 100 api
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml logs --tail 100 migrate
```

Хүлээгдэж буй container-ууд:

- `postgres`
- `rabbitmq`
- `clamav`
- `migrate` — амжилттай дууссан байна
- `api`
- `outbox-worker`
- `phase9-bridge-worker`
- `a1-worker`, `a2-worker`, `a3-worker`, `analysis-worker`
- `frontend`

Health check:

```powershell
Invoke-WebRequest http://127.0.0.1:8080/health/live
Invoke-WebRequest http://127.0.0.1:8080/api/health/live
Invoke-WebRequest http://127.0.0.1:8080/api/health/ready
```

`ready` унавал tunnel нээхгүй; эхлээд тухайн dependency-г засна.

## Phase 4 — Cloudflare Quick Tunnel нээх

Тусдаа PowerShell цонхонд:

```powershell
cloudflared tunnel --url http://127.0.0.1:8080
```

Cloudflare дараах хэлбэрийн URL өгнө:

```text
https://random-words.trycloudflare.com
```

- [ ] URL-ийг browser-оор нээж landing page ачаалж байгааг шалгана.
- [ ] `/api/health/live` болон `/api/health/ready` external URL дээр 200 буцааж байгааг шалгана.
- [ ] Tunnel terminal-ийг хаахгүй.

Дараа нь `agents/.env.production`:

```dotenv
BUILDWATCH_PUBLIC_BASE_URL=https://random-words.trycloudflare.com
```

болгож, public URL ашигладаг service-үүдийг recreate хийнэ:

```powershell
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml up -d --force-recreate api outbox-worker phase9-bridge-worker a1-worker a2-worker a3-worker analysis-worker frontend
```

## Phase 5 — Stripe Test webhook

Stripe Dashboard/Workbench дээр test endpoint үүсгэнэ:

```text
https://random-words.trycloudflare.com/api/webhooks/billing/STRIPE
```

- [ ] Зөвхөн backend-ийн дэмждэг event төрлүүдийг сонгоно.
- [ ] Dashboard endpoint-оос гарсан шинэ `whsec_...`-ийг `STRIPE_WEBHOOK_SECRET` болгоно.
- [ ] Stripe CLI listener-ийн local `whsec_...`-ийг Dashboard endpoint-д дахин ашиглахгүй.
- [ ] API-г recreate хийнэ.
- [ ] Stripe Test card-аар checkout хийнэ.
- [ ] Webhook signature verification амжилттай байна.
- [ ] Нэг event 20 удаа ирсэн ч нэг tenant/subscription л үүснэ.

Quick Tunnel restart хийж URL өөрчлөгдвөл:

1. `BUILDWATCH_PUBLIC_BASE_URL` шинэчилнэ.
2. Stripe webhook endpoint URL шинэчилнэ.
3. `STRIPE_WEBHOOK_SECRET` шинэ endpoint secret болсон бол шинэчилнэ.
4. API/worker container-уудыг recreate хийнэ.

## Phase 6 — Public demo acceptance test

### Public ба signup

- [ ] Landing, features, pricing, security, contact route refresh хийхэд 404 болохгүй.
- [ ] Plan үнэ backend public catalog-оос ирнэ.
- [ ] Company signup email code бодит inbox-д ирнэ.
- [ ] Expired/wrong code зөв алдаа өгнө; зөв code checkout руу шилжинэ.
- [ ] Stripe Test payment webhook-оор баталгаажна.
- [ ] Company Admin password setup хийж нэвтэрнэ.

### Tenant isolation

- [ ] Company A token-оор Company B объект ID-г read/write хийж болохгүй.
- [ ] Company Admin platform endpoint рүү 403 авна.
- [ ] Platform token tenant operational endpoint рүү 403 авна.
- [ ] Signed artifact URL өөр tenant-ийн файлд үйлчлэхгүй.

### File/AI flow

- [ ] 25 MB хүртэл зөвшөөрсөн PDF upload амжилттай.
- [ ] 25 MB-аас их файл client ба server дээр ойлгомжтой алдаатай.
- [ ] ClamAV unavailable үед upload fail-closed байна.
- [ ] A0 intake → outbox → bridge → agent worker дараалал ажиллана.
- [ ] Raw prompt/output/error Platform dashboard болон audit response-д гарахгүй.

### Platform

- [ ] `/platform/login` тусдаа platform identity ашиглана.
- [ ] Control Tower health data бодит endpoint-оос ирнэ.
- [ ] Agent run, review, system health, audit drill-down ажиллана.
- [ ] Super Admin tenant-ийн operational approve/edit action хийхгүй.

### Reliability

- [ ] Docker container restart хийсний дараа PostgreSQL data хадгалагдана.
- [ ] Artifact volume restart хийсний дараа файл хадгалагдана.
- [ ] Worker retry duplicate business result үүсгэхгүй.
- [ ] Browser/console дээр uncaught error байхгүй.

## Phase 7 — Demo ажиллуулах дүрэм

- PC sleep/hibernate-ийг demo үед унтраана.
- Docker Desktop-ийг login үед auto-start болгоно.
- Tunnel цонх хаагдвал public site унтарна.
- Public URL-ийг зөвхөн demo/test хэрэглэгчид өгнө.
- Бодит барилгын нууц файл upload хийхгүй.
- Stripe Test Mode badge/тайлбарыг demo багт тодорхой хэлнэ.
- Demo дуусмагц tunnel-ийг `Ctrl+C`-ээр хаана.

Rollback:

```powershell
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml down
```

`down -v` ажиллуулахгүй. `-v` нь database болон artifact volume устгах эрсдэлтэй.

---

# Stage B — Oracle Cloud Always Free 24/7

## Phase 8 — Oracle account ба VM

Хэрэглэгчийн хийх зүйл:

- [ ] Oracle Cloud Free Tier account нээнэ.
- [ ] Card verification шаардвал хийнэ; paid upgrade дарж болохгүй.
- [ ] Home region-оо өөрчлөх боломжгүй тул ойр, capacity боломжтой region сонгоно.
- [ ] Console дээр `Always Free Eligible` гэж харагдсан Ampere A1 ARM shape сонгоно.
- [ ] Ubuntu LTS ARM64 image сонгоно.
- [ ] Боломжит Always Free хүрээнд хамгийн их RAM-тай нэг VM сонгоно.
- [ ] Boot volume нь Always Free allowance-аас давахгүй байна.
- [ ] SSH public key нэмээд private key-г аюулгүй хадгална.

Зөвхөн дараах inbound портыг нээнэ:

- `22/tcp` — эхлээд зөвхөн өөрийн IP-аас
- `80/tcp`, `443/tcp` — public HTTP/HTTPS хэрэглэх үед

`5432`, `5672`, `15672`, `3310`, `4180` портыг internet рүү нээхгүй.

## Phase 9 — ARM compatibility gate

Production code push хийхээс өмнө local/CI дээр:

- [ ] Backend Docker target-ууд `linux/arm64` build болно.
- [ ] `postgres:16-bookworm` ARM64 дээр асна.
- [ ] `rabbitmq:4-management-alpine` ARM64 дээр асна.
- [ ] `clamav/clamav:1.4` сонгосон tag ARM64 manifest-тэй байна.
- [ ] Chromium/PDF боловсруулах урсгал ARM64 дээр ажиллана.
- [ ] Frontend image ARM64 дээр build/serve болно.

Image-ийн аль нэг ARM64 дэмжихгүй бол Oracle deploy-ийг зогсоож, тохирох pinned multi-arch image сонгоно. Production malware scan-ийг зүгээр унтрааж тойрохгүй.

## Phase 10 — Server hardening

- [ ] Root SSH login хориглоно.
- [ ] Password SSH login хориглож key-only болгоно.
- [ ] Sudo эрхтэй тусдаа deploy user үүсгэнэ.
- [ ] OS security update хийнэ.
- [ ] UFW/OCI Security List хоёуланд minimum port нээнэ.
- [ ] Docker болон Compose plugin суулгана.
- [ ] Log rotation, disk usage alert тохируулна.
- [ ] Secret-ийг repository дотор хадгалахгүй.

## Phase 11 — Git ба deploy

Private GitHub repo бэлэн болсны дараа:

```bash
git clone <private-repository-url> /opt/buildwatch
cd /opt/buildwatch
git checkout <approved-commit-sha>
```

`/opt/buildwatch/agents/.env.production`-ийг server дээр гараар үүсгэж permission хязгаарлана:

```bash
chmod 600 /opt/buildwatch/agents/.env.production
```

Deploy:

```bash
cd /opt/buildwatch
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml config
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml build
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml up -d
docker compose --env-file agents/.env.production -f agents/docker-compose.production.yml ps
```

## Phase 12 — Үнэгүй HTTPS hostname

Төлбөртэй domain авахгүй үед эхний Oracle staging-д Cloudflare Quick Tunnel ажиллуулж болно:

```bash
cloudflared tunnel --url http://127.0.0.1:8080
```

Гэхдээ URL restart бүрт өөрчлөгдөнө. Тогтвортой production URL, email link, Stripe live webhook-д өөрийн domain эсвэл тогтвортой hostname зайлшгүй хэрэгтэй.

Cloudflared-ийг systemd service болгохоос өмнө:

- [ ] Random URL өөрчлөгдөх эрсдэлийг зөвшөөрсөн байна.
- [ ] Restart дараах public base URL/Stripe webhook шинэчлэх runbook бэлэн байна.
- [ ] Quick Tunnel-ийг production SLA гэж сурталчлахгүй.

## Phase 13 — Backup ба recovery

- [ ] PostgreSQL logical backup өдөр бүр.
- [ ] Artifact болон database backup тусдаа хадгалагдана.
- [ ] Backup encrypted, integrity hash/signature-тай байна.
- [ ] Backup яг тэр VM-ийн ганц disk дээр үлдэхгүй.
- [ ] Restore rehearsal хийж хугацааг хэмжинэ.
- [ ] Secret болон Stripe data backup log-д гарахгүй.

Oracle-ийн Always Free Object Storage allowance ашиглах бол operations backup output-ийг upload хийх тусдаа safe script шаардлагатай. Restore test хийгээгүй backup-ийг найдвартай гэж тооцохгүй.

## Phase 14 — 24/7 staging acceptance

- [ ] 24 цаг тасралтгүй ажилласан.
- [ ] VM reboot хийсний дараа Docker stack болон tunnel автоматаар ассан.
- [ ] Migration дахин ажиллахад idempotent.
- [ ] Worker reconnect хийсэн.
- [ ] PostgreSQL/RabbitMQ/artifact volume data хадгалагдсан.
- [ ] Stripe duplicate/out-of-order webhook test амжилттай.
- [ ] SMTP provider outage үед signup false-success харуулахгүй.
- [ ] Disk, RAM, CPU, queue backlog хэмжигддэг.
- [ ] Backup restore test амжилттай.

---

# Production руу шилжихийн өмнөх заавал хийх зүйл

Дараах бүх зүйл дуусаагүй бол бодит төлбөр авахгүй:

1. Stripe checkout, webhook retry/DLQ, refund/chargeback state machine бүрэн тесттэй.
2. Email verify, resend, expiry, rate-limit, account setup end-to-end тесттэй.
3. Tenant entitlement missing/corrupt үед fail-closed.
4. Subscription цуцлалт, grace, suspend, recovery lifecycle бүрэн.
5. Off-site backup болон restore rehearsal амжилттай.
6. Тогтвортой domain/HTTPS болон production SMTP.
7. Demo account/password/seed data production-оос арилсан.
8. Audit, secret redaction, tenant isolation negative тестүүд green.
9. Privacy policy/terms/VAT invoice амлалтууд бодит ажиллагаатай таарсан.
10. Monitoring, alert, incident response owner тодорхой.

## Амжилтын тодорхойлолт

### Stage A complete

- Public `trycloudflare.com` URL-аар landing → signup → email verify → Stripe Test checkout → webhook → account setup → tenant login ажиллана.
- Upload болон agent worker flow ажиллана.
- Platform Super Admin бодит aggregate/audit/agent health харна.
- Нууц мэдээлэл response/log/public Git-д задраагүй.

### Stage B complete

- Oracle Always Free VM дээр дээрх урсгал 24/7 staging байдлаар ажиллана.
- Reboot, retry, backup/restore test давсан.
- Always Free limit-ээс paid resource үүсгээгүй.

## Албан ёсны эх сурвалж

- [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)
- [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/setup/)
- [Oracle Cloud Free Tier](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier.htm)
- [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- [Render Free limitations](https://render.com/docs/free)
- [Stripe webhook endpoint setup](https://docs.stripe.com/webhooks)
