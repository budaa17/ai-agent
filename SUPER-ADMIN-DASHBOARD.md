# BuildWatch Super Admin Control Tower — Юу харуулж байгаа вэ

**Огноо:** 2026-08-11
**Хамрах хүрээ:** `/platform` доорх бүх дэлгэц (Phase 0–8 бүрэн)
**Холбоотой баримт:** [`super-admin.md`](./super-admin.md) (тодорхойлолт), [`super-admin-roadmap.md`](./super-admin-roadmap.md) (хэрэгжүүлэлтийн явц)

Энэ баримт нь Super Admin буюу Platform Admin-ийн харах **12 дэлгэц бүр яг ямар өгөгдлийг, хаанаас, ямар дүрмээр** харуулж байгааг тайлбарлана. Дэлгэц бүрийн доор тухайн тоо хэрхэн тооцоологдож байгаа томьёо, ямар үед `Тодорхойгүй` эсвэл `Sample хүрэлцэхгүй` гэж харагдах нөхцөлийг бичсэн.

---

## 1. Хамгийн эхэнд ойлгох 4 зарчим

Бүх дэлгэц дараах 4 зарчмыг дагана. Эдгээрийг мэдэхгүйгээр дэлгэц дээрх тоог буруу уншиж болзошгүй.

### 1.1 Platform Admin ≠ Company Admin

| | Platform Admin (Super Admin) | Company Admin |
|---|---|---|
| Хаана нэвтэрдэг | `/platform/login` | `/login` |
| Хаана ажилладаг | Бүх компанийн техникийн төлөв | Өөрийн нэг компани |
| Төсөл сонгогч | **Байхгүй** | Байгаа |
| Төслийн өгөгдөл засах | **Чадахгүй** | Чадна |
| Token audience | `buildwatch-platform` | `buildwatch-web` |

Platform Admin-д `PROJECT_MANAGE`, `REPORT_APPROVE`, `COMMAND_APPLY` зэрэг **аль ч tenant-ийн үйл ажиллагааны эрх байхгүй**. Тэр зөвхөн `PLATFORM_*` эрхтэй. Энэ нь хатуу тестээр батлагдсан: platform token tenant endpoint дээр `403`, tenant token platform endpoint дээр `403`.

### 1.2 Тоо бүр өөрийн хугацаа, шинэлэг байдал, sample-тэй

Dashboard дээрх ямар ч тоо дараах контексттэй хамт л харагдана:

```text
value       — тоо өөрөө
window      — ямар хугацааны (24h / 7d / 30d / MTD / snapshot)
freshness   — хэзээ уншсан, хэр хуучирсан (FRESH / STALE / UNKNOWN)
sampleSize  — хэдэн бичлэг дээр тооцсон
minimumSample — итгэлтэй байхад хэрэгтэй доод хэмжээ
comparison  — өмнөх ижил хугацаатай харьцуулбал
```

Хэрэв sample доод хэмжээнээс бага бол **хувь харуулахгүй** — `Sample хүрэлцэхгүй` гэж бичнэ. 3 run дээр «67% амжилттай» гэж бичих нь худал мэдээлэл тул зориудаар хийхгүй.

### 1.3 Мэдэхгүй бол «0» гэж хэлэхгүй

Эх үүсвэр уншигдаагүй эсвэл хуучирсан бол тухайн хэсэг `Тодорхойгүй` төлөвт орно, `0` гэж харагдахгүй. Нэг эх үүсвэр унасан ч бусад хэсэг ажиллана — бүх хуудас унахгүй. Гарсан асуудлыг дээд талд `problems` banner-аар мэдэгдэж, «Дахин оролдох» товч гарна.

### 1.4 Загварчлагдаагүй зүйлийг харуулахгүй

Одоогийн өгөгдлийн загварт **quota/budget байхгүй** тул `used / budget` progress bar харуулахгүй — `Budget: Тохируулаагүй` гэж шулуухан бичнэ. Мөн probe-ийн түүх байхгүй тул **uptime хувь эсвэл SLO гаргахгүй**.

---

## 2. Дэлгэцүүдийн зураглал

```text
/platform                                   → Control Tower (нүүр)
/platform/incidents                         → Инцидентийн жагсаалт
/platform/incidents/:incidentId             → Инцидентийн дэлгэрэнгүй + үйлдэл
/platform/tenants                           → Компаниудын жагсаалт
/platform/tenants/:tenantId/health          → Нэг компанийн дэлгэрэнгүй
/platform/agents                            → Agent type-ийн жагсаалт
/platform/agents/:agentType                 → Нэг агентын дэлгэрэнгүй
/platform/agent-runs                        → Run-уудын жагсаалт
/platform/agent-runs/:runId/diagnostics     → Нэг run-ийн оношилгоо
/platform/review-quality?view=summary       → Review хураангуй
/platform/review-quality?view=backlog       → Review backlog жагсаалт
/platform/quality                           → AI чанар (гурван тусдаа metric)
/platform/usage                             → Ашиглалт ба зардал
/platform/system-health                     → Системийн техникийн төлөв
/platform/support-access                    → Дэмжлэгийн хандалтын жагсаалт
/platform/support-access/:grantId           → Хандалтын дэлгэрэнгүй + шийдвэр
/platform/audit                             → Audit log
```

Хажуугийн цэс эрхээр хаагдана — жишээ нь `PLATFORM_AUDIT_READ` эрхгүй хүнд Audit цэс огт харагдахгүй.

---

## 3. Control Tower — `/platform`

Нүүр дэлгэц. «Одоо платформ дээр юу болж байна, юуг нь эхэлж хараад юу хийх вэ» гэсэн ганц асуултад хариулна.

### 3.1 Platform Status

Хамгийн дээд талын том төлөв. Backend-ийн `platform-overview-rules.v1` дүрмээр тооцоологдоно:

| Төлөв | Хэзээ гарах вэ |
|---|---|
| `Ноцтой` (CRITICAL) | Ямар нэг CRITICAL signal идэвхтэй (жишээ: PostgreSQL probe амжилтгүй) |
| `Доголдолтой` (DEGRADED) | HIGH signal байгаа, эсвэл component батлагдсан доголдолтой |
| `Тодорхойгүй` (UNKNOWN) | Заавал шаардлагатай эх үүсвэрийн аль нэг уншигдаагүй |
| `Хэвийн` (HEALTHY) | Дээрх аль нь ч биш |

Доор нь **Гол шалтгаан (top 3)** гарна — тэдгээр нь дараагийн дэлгэц рүү шууд холбогдоно.

### 3.2 Таван KPI

| KPI | Юу харуулдаг | Томьёо | Хугацаа |
|---|---|---|---|
| **Critical Issues** | Одоо анхаарал шаардаж буй асуудлын тоо | CRITICAL + HIGH signal-ийн тоо | Snapshot |
| **Tenant Health** | Хэдэн компани хэвийн байна | `healthy / total`, задаргаа: critical, warning, unknown, inactive | Snapshot |
| **Agent Completion** | AI агент хэдэн хувь амжилттай дуусч байна | `COMPLETED / (COMPLETED + FAILED + DEGRADED + REJECTED)` | Сонгосон хугацаа |
| **Review SLA** | Хугацаа хэтэрсэн хүний review хэд байна | `status = REVIEW_REQUIRED AND dueAt < одоо` | Snapshot |
| **AI Spend** | Энэ сард AI-д хэдэн доллар зарцуулсан | `actualCostMicroUsd` байвал бодит, үгүй бол `estimatedCostMicroUsd` | Сарын эхнээс (MTD) |

**Agent Completion-ийн чухал нарийвчлал:**
- `RUNNING` төлөв **хуваарьт ороогүй** — дуусаагүй ажлыг амжилтгүй гэж тооцохгүй
- 30 минутаас удаан `RUNNING` байгаа run нь **тусдаа "stuck" signal** болно
- `FAILED`, `DEGRADED`, `REJECTED` гурвыг тусад нь харуулна — «алдаа» гэж нийлүүлэхгүй
- **Доод sample 20**. Түүнээс бага бол хувь харуулахгүй

**Review SLA-ийн чухал нарийвчлал:**
- `DRAFT` төлөвтэй review **backlog-д ороогүй** — хараахан илгээгээгүй ноорог хүлээлт биш
- `dueAt` тавигдаагүй review-г тусад нь «Хугацаагүй» гэж тоолно

**AI Spend-ийн чухал нарийвчлал:**
- `Actual coverage` хувь харагдана — жишээ нь 60% гэвэл зардлын 60% нь бодит тоо, үлдсэн нь тооцоолол
- Budget/quota загвар байхгүй тул `used / budget` **харуулахгүй**

### 3.3 Attention Required (Анхаарах асуудал)

Идэвхтэй signal-уудыг **ноцтой байдлаар нь эрэмбэлж** харуулна (CRITICAL → HIGH → MEDIUM → LOW, дараа нь хамгийн эрт эхэлсэн нь). Signal бүр:

- **Юу болсон** — гарчиг
- **Нөлөө** — юунд нөлөөлж байгаа
- **Хамрах хүрээ** — аль компани / агент / component
- **Нотолгоо** — яг ямар metric, ямар утга, хэзээ хэмжсэн
- **Санал болгох үйлдэл** — юу хийх вэ
- **Оношилгооны холбоос** — шууд тухайн дэлгэц рүү

Signal бүр `signalId`-тай. Энэ ID нь **инцидент болж хадгалагдах түлхүүр** (§4-г үзнэ үү).

Одоо ажиллаж буй дүрмүүд:

| Rule key | Ноцтой | Хэзээ асах вэ |
|---|---|---|
| `POSTGRES_UNAVAILABLE` | CRITICAL | Database probe амжилтгүй |
| `AGENT_HIGH_FAILURE_RATE` | HIGH | Сүүлийн 15 мин: terminal ≥ 20 бөгөөд амжилтгүй хувь > 5% |
| `AGENT_RUN_STUCK_30M` | HIGH | 30 минутаас удаан `RUNNING` байгаа run |
| `REVIEW_SLA_BREACH` | HIGH | Компанид хугацаа хэтэрсэн review байна |
| `OUTBOX_DEAD_LETTER` | HIGH | Outbox event dead letter-т орсон |
| `OUTBOX_STALLED_10M` | HIGH | Илгээх боломжтой event 10 минут гацсан |
| `TENANT_COST_ANOMALY` | MEDIUM | Компанийн зардал **өөрийнх нь** өмнөх ижил цонхоос 2 дахин их (доод baseline болон run тоотой) |
| `NOTIFICATION_STALLED_10M` | MEDIUM | Мэдэгдэл 10 минут гацсан |
| `NOTIFICATION_FAILED` | MEDIUM | Мэдэгдэл илгээхэд амжилтгүй |
| `ARTIFACT_PENDING_15M` | MEDIUM | Файлын metadata 15 минут pending |
| `ARTIFACT_QUARANTINED` | MEDIUM | Файл карантинд орсон |
| `TENANT_INACTIVE_30D` | LOW | 30 хоног ямар ч идэвх бүртгэгдээгүй |

### 3.4 System Health preview

`API`, `POSTGRES`, `OUTBOX`, `ARTIFACT_METADATA`, `NOTIFICATION`, `AI_PROVIDER` — 6 component-ийн төлөв. Дэлгэрэнгүйг §9-д.

### 3.5 Tenant / Agent preview ба Recent Audited Changes

Эхний 10 компани, эхний 10 agent type, сүүлийн 5 audit бичлэг. Бүгд харгалзах бүтэн жагсаалт руу холбогдоно.

---

## 4. Инцидент — `/platform/incidents`

Attention Required нь **тухай бүр дахин тооцоологддог** signal. Инцидент нь тэдгээрийн **байнга хадгалагддаг** хувилбар: хэн хүлээж авсан, хэн хариуцсан, хэзээ шийдэгдсэн гэдэг түүх.

### 4.1 Signal хэрхэн инцидент болдог вэ

```text
Signal асав
  └─ Ижил signalId-тай инцидент байхгүй   → шинэ инцидент OPEN
  └─ Ижил signalId-тай идэвхтэй инцидент  → нотолгоог шинэчилнэ (давхар үүсэхгүй)
       └─ Ноцтой байдал өөрчлөгдсөн       → SEVERITY_CHANGED түүхэнд бичигдэнэ
  └─ Ижил signalId-тай RESOLVED инцидент  → мөн мөрийг REOPENED болгоно (reopenCount++)

Signal зогсов
  └─ Бүх эх үүсвэр уншигдсан байвал       → AUTO_RESOLVED
  └─ Эх үүсвэр уншигдаагүй байвал         → хөндөхгүй
```

Сүүлийн мөр чухал: **өгөгдөл байхгүй нь асуудал байхгүй гэсэн үг биш**. Database унасан үед бүх инцидентийг чимээгүй хааж болохгүй.

Энэ үнэлгээ нь `GET` хүсэлтийн дотор биш, тусдаа ажилладаг:

```powershell
pnpm --dir agents run platform:incidents:evaluate
```

Ингэснээр read-only endpoint жинхэнэ read-only хэвээр байна.

### 4.2 Жагсаалт юу харуулдаг

Default-аар зөвхөн **идэвхтэй** (OPEN / ACKNOWLEDGED / REOPENED) инцидент. Resolved-ийг «Шийдэгдсэнийг оруулах» шүүлтээр гаргана — **түүхээс устдаггүй**.

Дээд талд: Нээлттэй, Хүлээн авсан, Дахин нээгдсэн, Шийдэгдсэн, идэвхтэй critical, идэвхтэй high.

### 4.3 Дэлгэрэнгүй ба үйлдэл — `/platform/incidents/:incidentId`

Гурван үйлдэл: **Хүлээн авах** (acknowledge), **Хариуцагч оноох** (assign), **Шийдвэрлэх** (resolve).

Үйлдэл бүр дараах бүх шаардлагыг хангана:

| Шаардлага | Хэрхэн |
|---|---|
| Эрх | `PLATFORM_INCIDENT_MANAGE`. Байхгүй бол `403` + **DENIED audit бичлэг** |
| Шалтгаан | Дор хаяж 8 тэмдэгт, audit-д хадгалагдана |
| Мөргөлдөөнөөс хамгаалах | `rowVersion` optimistic lock. Хуучирсан бол `409` |
| Давхардлаас хамгаалах | `Idempotency-Key` header. Дахин илгээвэл шинэ шилжилт үүсгэхгүй, өмнөхийг буцаана |
| Өөрчлөлтийн нотолгоо | Before/after SHA-256 hash |
| Мөрдөх боломж | Correlation ID |
| Step-up auth | **CRITICAL / HIGH** инцидент шийдвэрлэхэд нууц үгээ дахин оруулна |

Түүх (timeline) нь **append-only** — өгөгдлийн сангийн trigger-ээр хамгаалагдсан, API-аас засах, устгах арга байхгүй.

---

## 5. Компаниуд — `/platform/tenants`

Бүх компанийн техникийн эрүүл мэнд. Мөр бүр = нэг компани.

### 5.1 Health хэрхэн тооцоологддог

```text
CRITICAL signal байна           → Ноцтой
HIGH эсвэл MEDIUM signal байна  → Анхаарах
Эх үүсвэр дутуу                 → Тодорхойгүй
30 хоног идэвхгүй               → Идэвхгүй
Бусад                           → Хэвийн
```

Энэ дүрэм Control Tower-тэй **яг ижил** — нэг дэлгэц дээр «Анхаарах» гэсэн компани нөгөө дээр «Хэвийн» гэж харагдахгүй.

### 5.2 Багана бүр

| Багана | Утга |
|---|---|
| Компани | Нэр, tenant ID, тухайн компанийн идэвхтэй шалтгаанууд |
| Health | Дээрх дүрмээр |
| Хэрэглэгч | `24 цагт нэвтэрсэн / идэвхтэй бүртгэл` |
| Agent run | Нийт run, completion %, stuck тоо |
| Review | Хүлээгдэж буй / хугацаа хэтэрсэн |
| AI зардал | Сарын эхнээс |
| Хадгалалт | Устгаагүй файлын нийт хэмжээ |
| Сүүлийн идэвх | User login, agent run, review, outbox, notification, file, audit — эдгээрийн хамгийн сүүлийнх |

Шүүлт: нэр/slug хайлт, health, эрэмбэ (health, нэр, сүүлийн идэвх, run, review breach, AI зардал). Шүүлт **URL-д хадгалагдана** тул холбоосыг хуваалцаж болно.

### 5.3 Нэг компанийн дэлгэрэнгүй — `/platform/tenants/:tenantId/health`

6 блок:

1. **Tenant status** — health, үүссэн огноо, сүүлийн идэвх, идэвхгүй байсан хоног
2. **Идэвхтэй signal** — тухайн компанийн бүх шалтгаан
3. **Хэрэглэгчийн идэвх** — идэвхтэй, 24ц/7х нэвтэрсэн, хэзээ ч нэвтрээгүй, түдгэлзүүлсэн
4. **Агентын гүйцэтгэл** — agent type тус бүрээр run, completion, алдаа, stuck, сүүлийн амжилт, зардал
5. **Review SLA** — хүлээгдэж буй, хэтэрсэн, хугацаагүй, хамгийн эртний
6. **Delivery** — outbox, notification, artifact metadata component-ийн төлөв
7. **Хадгалалт** — нийт хэмжээ, файлын тоо, карантинд орсон

---

## 6. Агент ба run — `/platform/agents`

### 6.1 Agent жагсаалт

Agent type тус бүрээр:

| Багана | Тайлбар |
|---|---|
| Төлөв | `DEGRADED` (stuck run байна эсвэл 15 мин доторх амжилтгүй хувь > 5%), `ACTIVE`, `UNKNOWN` |
| Run / terminal | Нийт болон дууссан |
| Completion | Terminal ≥ 20 үед л хувь, үгүй бол `Sample хүрэлцэхгүй` |
| Latency p50 / p95 | `percentile_disc` — дундаж биш, бодит хуваарилалт |
| Retry rate | Дахин оролдсон run-ийн хувь |
| Stuck | 30 мин+ `RUNNING` |
| Зардал | Сонгосон хугацааны |

### 6.2 Нэг агентын дэлгэрэнгүй — `/platform/agents/:agentType`

- **Алдааны ангилал** — `PROVIDER`, `TIMEOUT`, `RATE_LIMIT` гэх мэт задаргаа, эзлэх хувь, сүүлд ажиглагдсан хугацаа. Ангилал бүр шүүсэн run жагсаалт руу холбогдоно
- **Компаниар** — аль компанид хэр ажиллаж байна
- **Provider ба модель** — ямар модель, хэдэн run, хэдэн token, хэдэн доллар

### 6.3 Run жагсаалт — `/platform/agent-runs`

Шүүлт: компани, agent type, төлөв, үр дүн (terminal / амжилтгүй), алдааны ангилал, зөвхөн stuck.

Багана: run ID, компани, агент, төлөв + алдааны ангилал, эхэлсэн, latency, retry, зардал + **үндэслэл** (`Бодит` эсвэл `Тооцоолсон`), модель.

**Энд prompt, output, tool payload огт байхгүй.**

### 6.4 Run оношилгоо — `/platform/agent-runs/:runId/diagnostics`

Тусдаа эрх шаардана: `PLATFORM_AGENT_RUN_DIAGNOSTICS_READ`.

Харагдах зүйл:

- **Төлөв** — статус, stuck эсэх
- **Гүйцэтгэлийн хамрах хүрээ** — project ID, request/event/trace ID, prompt version, tool bundle, output schema version, data snapshot version, output SHA-256, content logging асаалттай эсэх
- **Token ба зардал** — input, output, cached input, reasoning token; тооцоолсон ба бодит зардал
- **Validation** — `PASSED` / `FAILED` / `UNKNOWN` + асуудлын **тоо** (агуулга нь биш)
- **Tool дуудлага** — дараалал, tool нэр, төлөв, хугацаа (**оролт/гаралт байхгүй**)

**Redaction блок** нь ил тодоор дараах талбаруудыг харуулаагүй гэдгийг мэдэгдэнэ:

```text
request · researchText · output · validationDetail · errorMessage
toolCallInput · toolCallOutput
```

Яагаад: Platform Admin платформын доголдлыг оношлох ёстой, харин **компаниудын барилгын өгөгдлийг унших ёсгүй**. Хоосон панель харагдвал өгөгдөл байхгүй гэж эндүүрэхгүйн тулд redaction-г нуухгүй, шулуухан бичдэг.

---

## 7. Review ба чанар — `/platform/review-quality`

Хоёр харагдац: **Хураангуй** ба **Backlog**.

### 7.1 Хураангуй

- **Backlog** — хүлээгдэж буй, хугацаа хэтэрсэн, хугацаагүй, `DRAFT` (backlog-д ороогүйг тод бичнэ)
- **Хүлээлтийн хуваарилалт** — 24ц-аас бага, 24–72ц, 3–7 хоног, 7 хоногоос дээш
- **Компаниар** ба **төрлөөр** задаргаа
- **Шийдвэрийн урсгал** — шийдсэн, зөвшөөрсөн, татгалзсан, засварласан, **засварын хувь**, emergency override

### 7.2 Backlog жагсаалт

Review task бүр: ID, компани, target төрөл + хувилбар, хариуцах үүрэг, хүн оноогдсон эсэх, үүссэн, дуусах, **хүлээсэн хугацаа**, SLA төлөв (`Хугацаа хэтэрсэн` / `Удахгүй дуусах` / `Хэвийн` / `Хугацаагүй`).

> **Чухал:** Энэ дэлгэц дээр **Зөвшөөрөх / Татгалзах / Засах товч байхгүй**. Super Admin барилгын шийдвэрийг гаргах эрхгүй — тэр зөвхөн хүлээлт хуримтлагдаж байгаа эсэхийг хардаг. Энэ нь тестээр батлагдсан.

---

## 7.3 AI чанар — `/platform/quality`

Энэ дэлгэц **гурван тусдаа хэмжигдэхүүн** харуулна. Тэдгээрийг нэг «AI оноо» болгож нийлүүлэхгүй — өөр өөр зүйл хэмждэг тул дундажлах нь утгагүй.

| Metric | Эх үүсвэр | Томьёо |
|---|---|---|
| **Offline evaluation** | `PlatformEvaluationRun` (хадгалагдсан suite түүх) | Тэнцсэн case / оноосон case |
| **Production validation** | `AgentRun.validation`-ийн **зөвхөн хэлбэр** | `ok = true` run / validation дүгнэлт гаргасан run |
| **Human feedback** | `AgentFeedback` | Засваргүй хүлээн авсан / бүх шалгасан |

Metric бүр: утга, `passed / total`, sample size + доод хэмжээ, хугацааны цонх, эх сурвалж, сүүлд хэмжсэн огноо, өмнөх ижил урттай цонхтой харьцуулсан **дельта (пунктээр)**.

**Sample хүрэлцэхгүй бол хувь огт харагдахгүй.** 3 case-ийн 2 нь тэнцсэн бол «67% чанар» гэж бичихгүй.

Нэмэлт хэсгүүд:

- **Агентаар** — agent type тус бүрд гурван metric
- **Хувилбарын харьцуулалт** — release (`promptVersion + toolBundleVersion`) тус бүрд гурван metric, provider/модель, run тоо. Хэмжигдээгүй metric нь `Хэмжээгүй` гэж харагдана, `0%` биш
- **Evaluation түүх** — suite ажиллуулалт бүр: case тоо, тэнцсэн/унасан, оноо (хангалттай том suite дээр л), дууссан огноо, CI эх сурвалж

---

## 7.4 Дэмжлэгийн хандалт — `/platform/support-access`

Platform Admin компанийн өгөгдлийг **чимээгүй харах боломжгүй**. Оношилгоо шаардвал ил тод, хугацаатай хандалт хүсэх ёстой.

### Хандалтын мөчлөг

```text
Хүсэлт (ticket, шалтгаан, tenant, үйлдлүүд, хугацаа)
  → Хоёр дахь хүн зөвшөөрөх ЭСВЭЛ татгалзах
      → Зөвшөөрсөн бол цонх нээгдэнэ (зөвхөн унших, маскласан)
          → Хугацаа дуусна (өөрөө) ЭСВЭЛ цуцлагдана (гараар)
```

### Хатуу дүрмүүд

| Дүрэм | Хэрхэн хамгаалагдсан |
|---|---|
| Хүсэгч өөрөө зөвшөөрөхгүй | Application дүрэм **ба** PostgreSQL `CHECK` constraint хоёул. Аль нэг нь дангаараа тулгуур биш |
| Хугацаа дуусмагц хүчингүй | Тооцоолж гаргана — `APPROVED` боловч `expiresAt` өнгөрсөн бол `EXPIRED`. Worker шаардахгүй |
| Хамгийн урт 8 цаг | Contract түвшинд хязгаарласан — байнгын хандалт хүсэх боломжгүй |
| Зөвхөн унших, маскласан | `maskedOnly` үргэлж `true`. Зөвшөөрөгдөх үйлдлүүд нь read-only 5 үйлдлээс сонгогдоно |
| Шалтгаан заавал | Дор хаяж 8 тэмдэгт, audit-д хадгалагдана |
| Түүх устахгүй | `PlatformSupportAccessEvent` append-only trigger-тэй |

Хүсэгч рүү харуулах: «Та энэ хүсэлтийг гаргасан тул өөрөө зөвшөөрөх боломжгүй» — товч ч харагдахгүй, сервер ч `SELF_APPROVAL_FORBIDDEN` буцаана.

---

## 8. Ашиглалт ба зардал — `/platform/usage`

Гурван бүлэглэлт: **Компаниар**, **Agent type-аар**, **Provider ба моделиор**.

| Үзүүлэлт | Тайлбар |
|---|---|
| Run | Тухайн хугацааны run тоо |
| Зардал | `actual` байвал actual, үгүй бол `estimated` |
| Задаргаа | Хэд нь бодит, хэд нь тооцоолсон |
| **Actual coverage** | Зардлын хэдэн хувь нь бодит тоо вэ |
| Эзлэх хувь | Нийт зардалд эзлэх хувь |
| Token | Input, output, cached input, reasoning |

`Budget: Тохируулаагүй` — quota/limit загвар байхгүй тул хуурамч progress bar харуулахгүй.

---

## 9. Системийн төлөв — `/platform/system-health`

### 9.1 Component-ууд

| Component | Заавал | Юу шалгадаг |
|---|---|---|
| `API` | ✓ | Хүсэлт нь өөрөө хариулж байгаа нь нотолгоо |
| `POSTGRES` | ✓ | Амьд probe + хариу өгсөн хугацаа (мс) |
| `OUTBOX` | ✓ | Pending, 10 мин гацсан, failed, dead letter |
| `ARTIFACT_METADATA` | ✓ | Pending, 15 мин гацсан, карантин |
| `NOTIFICATION` | — | Pending, гацсан, failed |
| `AI_PROVIDER` | — | Сүүлийн 15 мин дэх provider-ийн алдаа |

Ерөнхий төлөв: `DOWN` байвал Ноцтой → `DEGRADED` байвал Доголдолтой → заавал шаардлагатай component `UNKNOWN` бол Тодорхойгүй → эс бөгөөс Хэвийн.

### 9.2 Нэмэлт задаргаа

- **Event төрлөөр** — аль event төрөл гацаж байгаа, dead letter хэд байгаа, хамгийн эртний нь хэзээнээс
- **Нөлөөлсөн компаниуд** — аль компанид outbox гацсан, notification амжилтгүй, файл карантинд орсон

> **Uptime хувь харагдахгүй.** Probe-ийн түүх хадгалдаггүй тул «99.9% uptime» гэж бичих нь зохиомол тоо болно.

---

## 10. Audit log — `/platform/audit`

Platform түвшний бүх үйлдлийн мөр.

| Багана | Тайлбар |
|---|---|
| Хугацаа | Хэзээ + correlation ID |
| Гүйцэтгэгч | Хэн (нэр, үүрэг). Систем бол «Систем» |
| Үйлдэл | Жишээ: `PLATFORM_INCIDENT_RESOLVE`, `PLATFORM_LOGIN` + шалтгаан |
| Обьект | Ямар төрлийн юун дээр |
| Компани | Аль компанид хамаарах (эсвэл Platform) |
| Үр дүн | **Амжилттай / Татгалзсан / Амжилтгүй** |
| Hash | Before/after SHA-256 (эхний 12 тэмдэгт) |

**Татгалзсан оролдлого ч бичигддэг.** Эрхгүй хүн инцидент шийдвэрлэхийг оролдвол `403` авахаас гадна DENIED audit бичлэг үүснэ.

Audit **засах, устгах боломжгүй**: PostgreSQL trigger `UPDATE`/`DELETE`-г шууд татгалзана, код дотор ч ийм зам байхгүй (тестээр хамгаалагдсан).

---

## 11. Аюулгүй байдлын хилүүд

Дараах бүх зүйл автомат тестээр батлагдсан:

| Хил | Хэрхэн батлагдсан |
|---|---|
| Company Admin `/platform/v1/*` рүү орохгүй | 11 drill-down + 3 incident + session/overview route дээр `403` |
| Platform token tenant endpoint дээр ажиллахгүй | `/v1/session`, `/v1/projects` дээр deny |
| Tenant token platform endpoint дээр ажиллахгүй | Бүх platform route дээр `403` |
| Platform role олгох API байхгүй | Эх кодын шалгалт |
| Хугацаа дууссан session ажиллахгүй | Хүчинтэй token ч `401` |
| Цуцлагдсан session ажиллахгүй | Гэр бүлээр нь цуцлахад `401` |
| Нууц утга response-д ороогүй | Read service болон contract-ын шалгалт |
| Алдааны мэдээлэл ил болохгүй | DB connection string бүхий алдаа `INTERNAL_ERROR` болж ариутгагдана |
| Audit өөрчлөгдөхгүй | Код + DB trigger шалгалт |
| Production дээр MFA заавал | §12-г үзнэ үү |

---

## 12. MFA production gate

`PlatformPrincipal.mfaEnrolledAt` талбар нэмэгдсэн. `PLATFORM_REQUIRE_MFA` тохиргоо **production дээр default-аар `true`**.

```text
Нууц үг буруу       → 401 (gate хүртэл хүрэхгүй — данс байгаа эсэхийг мэдэх аргагүй)
Нууц үг зөв, MFA үгүй → 403 + DENIED audit
Нууц үг зөв, MFA тийм → нэвтэрнэ
```

Өөрөөр хэлбэл **MFA хэрэгжихээс өмнө platform console production руу гарах боломжгүй**. Хөгжүүлэлтийн орчинд default `false`, эсвэл seed script дээр `--mfa-enrolled` тугаар тойрч болно.

Үүнээс гадна CRITICAL/HIGH инцидент шийдвэрлэхэд **нууц үг дахин шаардах step-up auth** аль хэдийн ажиллаж байна.

---

## 13. Хэрхэн өөрөө нээж үзэх вэ

### 13.1 Platform admin данс үүсгэх

Нууц үгийг **environment variable-аар** дамжуулна — командын түүхэнд үлдэхгүйн тулд:

```powershell
$env:PLATFORM_BOOTSTRAP_PASSWORD = "<хүчтэй нууц үг>"
pnpm --dir agents exec tsx src/scripts/bootstrap-platform-admin.ts `
  --email platform.admin@buildwatch.demo `
  --name "Platform Admin" `
  --role PLATFORM_SUPER_ADMIN `
  --mfa-enrolled
```

`--mfa-enrolled` нь зөвхөн хөгжүүлэлт/демод. Production дээр MFA бодитоор бүртгэгдэх ёстой.

### 13.2 Инцидентийн үнэлгээ ажиллуулах

```powershell
pnpm --dir agents run platform:incidents:evaluate
```

Signal байгаа бол инцидент үүснэ. Дахин ажиллуулбал `opened: 0` гарах ёстой — энэ нь deduplicate ажиллаж байгаагийн нотолгоо.

### 13.3 Бүх drill-down эндпойнтыг бодит DB дээр шалгах

```powershell
pnpm --dir agents run smoke:platform:drilldown
```

`partialSections: []` гарвал 11 эндпойнт бүгд бодит өгөгдөл уншсан гэсэн үг.

### 13.4 Нэвтрэх

Console нээгээд `/platform/login` — tenant login-оос **тусдаа** хуудас, token нь ч тусдаа хадгалагдана.

---

## 14. Хэрэглэгчийн үүрэг тус бүр юу харах вэ

| Эрх | `PLATFORM_SUPER_ADMIN` | `PLATFORM_OPERATOR` | `PLATFORM_AUDITOR` |
|---|:---:|:---:|:---:|
| Control Tower, инцидент унших | ✓ | ✓ | ✓ |
| Компани, агент, review, usage, system, audit унших | ✓ | ✓ | ✓ |
| Run diagnostics | ✓ | ✓ | ✓ |
| AI чанар унших | ✓ | ✓ | ✓ |
| Дэмжлэгийн хандалтын түүх унших | ✓ | ✓ | ✓ |
| Инцидент дээр үйлдэл хийх | ✓ | ✓ | **✗** |
| Agent state удирдах | ✓ | ✓ | ✗ |
| Дэмжлэгийн хандалт хүсэх/шийдэх | ✓ | ✗ | ✗ |
| Integration, settings | ✓ | ✗ | ✗ |

`PLATFORM_AUDITOR` бол цэвэр ажиглагч — түүнд инцидентийн дэлгэрэнгүй дээр үйлдлийн товч **огт харагдахгүй**, серверээс ч `403` авна.

---

## 15. Зориудаар хийгээгүй зүйлс

Дараах зүйлс **огт байхгүй**. Тэдгээрийг «удахгүй» гэж хуурамчаар харуулахгүй:

| Зүйл | Шалтгаан |
|---|---|
| **Agent pause / kill switch** | Agent run үүсэх гурван бие даасан цэг байгаа тул зөвхөн заримыг нь дагадаг pause бол хуурамч хяналт. Урьдчилсан нөхцөл нь admission chokepoint refactor |
| **Billing / subscription / quota** | Limit загвар байхгүй, гадаад billing integration ч байхгүй. Тиймээс `used / budget` progress bar ч харуулахгүй |
| **0–100 эрүүл мэндийн оноо** | Weight, түүх, override тодорхойгүй. Одоогийн ил төлөв (Хэвийн/Доголдолтой/Ноцтой/Тодорхойгүй) илүү үнэн |
| **Багтаамжийн урьдчилсан таамаг** | Probe/capacity түүх цуглуулдаггүй. Түүхгүй таамаг бол зохиомол тоо |
| **Uptime / SLO хувь** | Мөн адил probe түүх байхгүй |
| **Raw prompt / output харагч** | Privacy болон security эрсдэлтэй. Diagnostics зөвхөн metadata харуулна |
| **Super Admin-ийн review approve/reject** | Engineering separation зөрчинө — барилгын шийдвэр компанийн үүрэг |

---

## 16. Нэг өгүүлбэрээр

> **Control Tower нь график харуулах биш — асуудлыг эрт олох, хэн нөлөөлж байгааг ойлгуулах, юу хийхийг санал болгох, хийсэн үйлдэл бүрийг мөрдөх боломжтой болгох зорилготой.** Мэдэхгүй зүйлээ «мэдэхгүй» гэж хэлдэг, загварчлаагүй зүйлээ огт харуулдаггүй нь энэ самбарын хамгийн чухал шинж.
