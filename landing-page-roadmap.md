# BuildWatch — Landing page, subscription ба paid tenant roadmap

**Баримт бичгийн төрөл:** Product decision record + implementation roadmap
**Төлөв:** Phase 0 шийдвэр батлагдсан · Phase 1-ээс хэрэгжилт эхлэх боломжтой
**Огноо:** 2026-08-12
**Хамаарах систем:** `agent-console`, `agents`, PostgreSQL, tenant authentication, Platform Control Tower
**Орлож буй баримтууд:** `landing-page.md` (техникийн roadmap) + `PRICING-AND-LANDING-DECISION.md` (арилжааны шийдвэр)

> Энэ баримт нь дээрх хоёр файлыг нэгтгэсэн. Үнэ, багц, landing page-ийн агуулга нь тухайн үнийг мөрдүүлэх backend entitlement-тэй нэг файлд байх ёстой — тусад нь байвал зөрнө.

---

## 0. Энэ баримтыг хэрхэн уншиx вэ

| Хэсэг | Агуулга | Хэнд |
|---|---|---|
| **I. Арилжааны шийдвэр** (§1–§9) | Юуг, хэдээр, ямар нөхцөлтэй зарах | Product owner, дипломын хамгаалалт |
| **II. Landing page** (§10–§15) | Public хуудасны агуулга, copy, дизайн | Frontend, маркетинг |
| **III. Техникийн архитектур** (§16–§26) | Billing domain, access policy, checkout, security | Backend, frontend |
| **IV. Хэрэгжүүлэлт** (§27–§33) | Phase, тест, observability, deploy | Бүх баг |
| **Хавсралт** (A–C) | Эрсдэл, эцсийн санал, эх сурвалж | — |

### Шийдвэрийн хураангуй

| Асуулт | Шийдвэр | Дэлгэрэнгүй |
|---|---|---|
| Pricing unit | Компанийн суурь төлбөр + идэвхтэй төслийн эрх (per-user биш) | §4 |
| Нийтэд харагдах багц | 2 — **Starter**, **Business**. Гуравдахь нь **Enterprise** (үнэ нийтлэхгүй) | §5 |
| Интервал | Сар ба жил. Жилийн төлбөр = 10 сарын үнэ (2 сар үнэгүй) | §5 |
| Starter | **390,000₮/сар** · **3,900,000₮/жил** | §5 |
| Business | **1,290,000₮/сар** · **12,900,000₮/жил** | §5 |
| Enterprise | Гэрээт, эхлэх дүн **39,000,000₮/жил** | §5 |
| Валют | Дэлгэц дээр ₮ (НӨАТ ороогүй). Картын checkout USD price ID-аар | §8 |
| Provider | Lemon Squeezy (карт) + Manual invoice (дотоодын шилжүүлэг) | §8, §17 |
| Trial | Нийтийн self-serve trial байхгүй. Enterprise trial зөвхөн audit-тайгаар | §9 |
| Free plan | Байхгүй. Оронд нь тогтмол sample data-тай public demo | §9 |
| Grace | 7 хоног, versioned policy | §9, §19.4 |
| Системийн хөрөнгийн үнэлгээ | Дахин бүтээх өртөг ≈**321 сая₮ ($92 мянга)** | §3 |
| Break-even | ≈**7 Business tenant** | §3.4 |

---

# I ХЭСЭГ — АРИЛЖААНЫ ШИЙДВЭР

## 1. Эцсийн зорилго

BuildWatch-ийг олон байгууллага ашигладаг, төлбөртэй B2B SaaS болгоно.

Эцсийн урсгал:

```text
Public landing page
        ↓
Plan сонгох
        ↓
Company + анхны Company Admin мэдээлэл
        ↓
Hosted checkout / Manual invoice
        ↓
Provider-ийн баталгаажсан webhook
        ↓
Tenant + Company Admin + Subscription provision хийх
        ↓
Email баталгаажуулалт / нууц үг тохируулах
        ↓
Subscription access gate
        ↓
Projects / AI agents / reports ашиглах
```

Үндсэн бизнесийн дүрэм:

> Бодит tenant workspace зөвхөн баталгаажсан төлбөр, идэвхтэй trial эсвэл аудиттай manual contract entitlement-ийн дараа ашиглагдана.

Гэхдээ authentication болон subscription authorization-ийг хооронд нь хольж болохгүй. Төлбөрийн асуудалтай Company Admin нэвтэрч invoice харах, төлбөрийн аргаа шинэчлэх, subscription-ээ сэргээх боломжтой байна. Operational API болон feature access-ийг subscription gate шийднэ.

---

## 2. Одоогийн project-тэй нийцэх байдал

Одоогийн architecture subscription нэмэхэд тохиромжтой суурьтай:

- `Tenant` нь company boundary болсон.
- `User` нь `tenantId`-тай бөгөөд tenant scope-оос гарахгүй.
- Project, file, review, agent run, audit зэрэг business resource бүгд tenant scope-той.
- `PlatformPrincipal` нь tenant хэрэглэгчээс тусдаа.
- Platform Control Tower cross-tenant aggregate-ийг тусдаа read service-ээр уншдаг.
- Company Admin болон project permission flow аль хэдийн бий.
- `/register` нь одоогоор зөвхөн invitation token хүлээн авдаг.

Одоогоор байхгүй зүйлс:

- Tenant lifecycle status
- Billing customer
- Versioned plans
- Subscription lifecycle
- Feature entitlement болон quota limit
- Checkout session / signup intent
- Payment webhook inbox
- Invoice history
- Subscription-aware API authorization
- Company Admin billing UI
- Platform billing monitoring
- Public marketing/landing routes

`AgentUsageBudget.usedMicroUsd` нь бодит ашигласан AI зардлын aggregation. Энэ нь subscription budget limit биш бөгөөд plan limit-ийн эх үүсвэр болгож болохгүй.

---

## 3. Төслийн үнэ цэнэ

Хоёр өөр асуулт тул тусад нь хариулна:

1. **Хөрөнгийн үнэ** — бүтээсэн систем өөрөө хэдэн төгрөгийн үнэтэй вэ? (§3.1–§3.3)
2. **Үйлчилгээний үнэ** — хэрэглэгчээс сард хэд авах вэ? (§4–§7)

### 3.1 Бодитоор юу бүтсэн бэ (үнэлгээний нотолгоо)

| Хэмжүүр | Утга |
|---|---:|
| Backend TypeScript эх код | 102,531 мөр / 345 файл |
| Frontend (PWA console) | 26,259 мөр / 111 файл |
| **Нийт эх код** | **≈128,800 мөр** |
| Prisma domain model | 97 |
| Backend тестийн файл | 137 |
| AI агент | 6 (A0–A5) |
| Application route | 35+ (tenant + platform control tower) |
| Нэмэлт | Multi-tenant isolation, RBAC, audit trail, OpenAPI contract, offline/PWA sync, evaluation harness |

Энэ бол prototype биш, **production сахилгатай multi-tenant SaaS-ийн бүрэн суурь**. Үнэлгээ үүн дээр тулгуурлана.

### 3.2 Дахин бүтээх өртөг (replacement cost)

| Үүрэг | Тоо | Сарын өртөг | 13 сар |
|---|---:|---:|---:|
| Senior backend engineer | 1 | 5,500,000₮ | 71.5 сая₮ |
| AI/LLM engineer | 1 | 6,000,000₮ | 78.0 сая₮ |
| Frontend engineer | 1 | 4,000,000₮ | 52.0 сая₮ |
| PM / QA (0.5+0.5) | 1 | 3,500,000₮ | 45.5 сая₮ |
| **Хөдөлмөрийн дүн** | | | **247 сая₮** |
| Overhead, дэд бүтэц, багаж, LLM туршилтын зардал (+30%) | | | 74 сая₮ |
| **Нийт дахин бүтээх өртөг** | | | **≈321 сая₮ ≈ $92,000** |

Олон улсын гэрээт хөгжүүлэлтийн ханшаар ($45–60/цаг, 7,000–10,000 цаг) энэ систем **$350,000–550,000**-д тохирно. Энэ нь "хэрэв худалдаж авбал" гэсэн дээд хязгаар.

### 3.3 Бодит зах зээлийн үнэ (орлогогүй үед)

Шударга байх ёстой: **төлбөртэй хэрэглэгчгүй SaaS-ийн үнэ нь дахин бүтээх өртгийн 30–50%.** Худалдан авагч эрсдэл (нэвтрэлт батлагдаагүй, дэмжлэгийн ачаалал, багийн шилжилт) хасалт хийдэг.

| Хувилбар | Үнэлгээ |
|---|---|
| Орлогогүй, код + IP + баримтжуулалт | **100–160 сая₮ ($29–46 мянга)** |
| 3 pilot компани, гарын үсэгтэй LOI-той | 180–260 сая₮ |
| 10 төлбөртэй Business tenant (ARR ≈129 сая₮) | ARR-ийн 3–6 дахин = **390–770 сая₮** |

### 3.4 ARR-ийн зам ба break-even

| Хэрэглэгч | Жилийн орлого (ARR) |
|---|---:|
| 5 Starter | 19.5 сая₮ |
| 10 Starter + 5 Business | 103.5 сая₮ |
| 10 Business + 2 Enterprise | 207 сая₮ |
| 25 Business + 5 Enterprise | 517 сая₮ |

**Break-even:** дэд бүтэц + LLM + 1 бүтэн цагийн ажилтны зардал ≈ 8–9 сая₮/сар. Энэ нь **≈7 Business tenant** буюу **≈22 Starter tenant**-тай тэнцэнэ.

> **Дипломын хамгаалалтад хэлэх томьёолол:** "Систем нь ≈320 сая төгрөгийн хөгжүүлэлтийн өртөгтэй тэнцэх ажил. Арилжааны загварын хувьд 7 дунд хэмжээний компани л ашгийн босгыг давуулна."

---

## 4. Үнийн загварын шийдвэр

### 4.1 Яагаад per-user биш вэ

Барилгын компанид per-user үнэ **системийг сүйтгэдэг**:

- Талбайн ахлагч, нярав, хяналтын инженер бүр нэмэгдэх тусам үнэ өснө.
- Компани хэмнэхийн тулд хүмүүсээ системд оруулахгүй.
- Гэтэл BuildWatch-ийн үнэ цэнэ **бүх өдрийн тайлан нэг урсгалаар орж ирснээр** үүсдэг.
- Хэрэглэгч дутуу орсон систем = дутуу өгөгдөл = буруу forecast = хэрэглэгч гарна.

### 4.2 Тогтоосон загвар

```text
Компанийн суурь төлбөр
+ идэвхтэй төслийн эрх (гол хэмжигдэхүүн)
+ хангалттай олон хэрэглэгч (хязгаар нь өсөлтөөс сэргийлэх зорилготой, мөнгө авах зорилготой биш)
+ багцад орсон AI ажиллагаа
+ нэмэлт төсөл / AI / storage add-on
```

**Хэмжигдэхүүн = идэвхтэй төсөл.** Учир нь: (а) компанийн орлоготой шууд хамааралтай, (б) манай зардалтай шууд хамааралтай, (в) хэрэглэгчид ойлгомжтой, (г) төсөл дуусахад доош буух боломжтой тул шударга.

Үнийн дүнг source code-д hard-code хийхгүй. Provider price ID болон internal plan version-оор удирдана.

---

## 5. Багцын бүтэц ба үнэ

| | **Starter** | **Business** | **Enterprise** |
|---|---|---|---|
| Хэнд | Анхны төслөө системд оруулж буй компани | Зэрэг олон төсөлтэй тогтвортой гүйцэтгэгч | Групп компани, том захиалагч |
| **Сараар** | **390,000₮** | **1,290,000₮** | Гэрээт |
| **Жилээр** | **3,900,000₮** | **12,900,000₮** | 39,000,000₮-өөс |
| Жилийн хэмнэлт | 780,000₮ (2 сар) | 2,580,000₮ (2 сар) | Гэрээгээр |
| Идэвхтэй төсөл | 1 | 5 | Гэрээт |
| Хэрэглэгч | 15 | 60 | Хязгааргүй |
| Файл хадгалалт | 50 GB | 500 GB | Гэрээт |
| AI ажиллагаа/сар | 150 | 900 | Гэрээт |
| A0 baseline үүсгэлт | Сард 1 | Сард 6 | Гэрээт |
| A1 өдрийн тайлан | ✓ | ✓ | ✓ |
| A2 гүйцэтгэл баталгаажуулалт | ✓ | ✓ | ✓ |
| A3 тайлан | Үндсэн | Дэлгэрэнгүй + экспорт | Дэлгэрэнгүй + API |
| A4 лавлагаа туслах | ✓ | ✓ | ✓ |
| A5 orchestration | — | ✓ | ✓ |
| Forecast / recovery санал | ✓ | ✓ | ✓ |
| Audit хадгалах хугацаа | 90 хоног | 365 хоног | Гэрээт (3 жил хүртэл) |
| API хандалт | — | ✓ | ✓ |
| SSO | — | — | ✓ |
| Дэмжлэг | Имэйл, 2 ажлын өдөр | Тэргүүн ээлж, 1 ажлын өдөр | SLA-тай, нэрлэсэн менежер |
| Төлбөрийн хэлбэр | Карт / данс | Карт / данс | Гэрээ + нэхэмжлэх |

**Нийтэд харагдах үнэ 2 багц дээр л байна** (Starter, Business). Enterprise дээр үнэ биш, "Холбоо барих" CTA байрлана — энэ нь том захиалагчтай хэлэлцээрийн орон зайг хамгаална.

### 5.1 Add-on үнэ (хоёр багц дээр адил)

| Add-on | Үнэ |
|---|---|
| Нэмэлт идэвхтэй төсөл | 190,000₮/сар (Business дээр 150,000₮/сар) |
| Нэмэлт AI багц (500 ажиллагаа) | 290,000₮ |
| Нэмэлт 500 GB хадгалалт | 90,000₮/сар |
| Нэвтрүүлэлт + сургалт (нэг удаа) | Starter 2,900,000₮ · Business 5,900,000₮ |

Нэвтрүүлэлтийн багц: каталог (үнэ, норм, бүтээмж) оруулах, эхний A0 baseline-ийг хамтарч гаргах, 2 удаагийн сургалт, эхний сарын дагалдан хяналт. **Энэ нь зөвлөмж биш, шаардлагатай зүйл** — барилгын салбарт өгөгдөл оруулах саад нь хамгийн том эрсдэл. Мөн эхний орлогын урсгалыг бий болгоно.

---

## 6. Entitlement ба хязгаарын зан төлөв

### 6.1 Entitlement matrix

| featureKey | Starter | Business | Enterprise |
|---|---:|---:|---:|
| `PROJECT_ACTIVE_MAX` | 1 | 5 | гэрээт |
| `USER_ACTIVE_MAX` | 15 | 60 | гэрээт |
| `STORAGE_BYTES_MAX` | 50 GiB | 500 GiB | гэрээт |
| `AI_MONTHLY_RUNS_INCLUDED` | 150 | 900 | гэрээт |
| `AI_MONTHLY_MICRO_USD_MAX` | 25,000,000 | 130,000,000 | гэрээт |
| `AI_OVERAGE_ALLOWED` | false | true | true |
| `AGENT_DAILY_REPORT` | true | true | true |
| `AGENT_PROGRESS_VERIFICATION` | true | true | true |
| `AGENT_BOQ_ANALYSIS` | true | true | true |
| `ADVANCED_REPORTS` | false | true | true |
| `AUDIT_RETENTION_DAYS` | 90 | 365 | 1095 |
| `API_ACCESS` | false | true | true |
| `PRIORITY_SUPPORT` | false | true | true |

> **Хоёр давхар хязгаар.** Хэрэглэгчид өгсөн амлалт нь "AI ажиллагаа" (`AI_MONTHLY_RUNS_INCLUDED`) бөгөөд enforcement эхлээд үүгээр явна. `AI_MONTHLY_MICRO_USD_MAX` нь хүлээгдэж буй зардлаас 40–65% дээгүүр тавьсан **backstop** — ер бусын үнэтэй ажиллагааны эсрэг хамгаалалт. Зөвхөн micro-USD-ээр хязгаарлавал 150 ажиллагаа амласан хэрэглэгч 60 дахь ажиллагаан дээрээ хаагдаж, амлалт зөрчигдөнө. Хоёуланг нь `PlanEntitlement`-д хадгална.

### 6.2 Хязгаарт хүрсэн үеийн зан төлөв

Limit-д хүрсэн үед бүх tenant-ийг хаахгүй. Тухайн operation дээр ойлгомжтой domain error буцаана:

```text
PROJECT_LIMIT_REACHED
USER_LIMIT_REACHED
AI_USAGE_LIMIT_REACHED
STORAGE_LIMIT_REACHED
FEATURE_NOT_INCLUDED
```

| Багц | AI хязгаар давсан үед |
|---|---|
| Starter | Шинэ AI ажиллагаа зогсоно (`AI_USAGE_LIMIT_REACHED`). Add-on авах эсвэл дараа сар хүлээх. Ажиллаж буй ажил үргэлжилнэ, өгөгдөл алдагдахгүй |
| Business | Overage зөвшөөрнө: 100 ажиллагаа тутам 65,000₮, сарын нэхэмжлэхэд нэмэгдэнэ. Company Admin-д 80%/100% дээр анхааруулга очно |
| Enterprise | Гэрээгээр |

Төсөл/хэрэглэгчийн хязгаар аль ч багцад **hard limit** — учир нь энэ бол багц ахиулах гол шалтгаан.

---

## 7. Үнийн үндэслэл

**Дээрээс (үнэ цэнэ):** 1.5 тэрбум₮-ийн төсөл дээр 390,000₮/сар = жилд 4.7 сая₮ = **төслийн өртгийн 0.3%**. Нэг долоо хоногийн хоцролтоос сэргийлж чадвал л энэ зардал нөхөгдөнө. Барилгын инженерийн сарын цалингийн ≈15%.

**Доороос (зардал):**

| Зардал (1 идэвхтэй төсөл/сар) | Тооцоо |
|---|---:|
| LLM (A0–A5 холимог) | $9–15 |
| Файл хадгалалт + дамжуулалт | $3–5 |
| Дэд бүтцийн хуваарилалт | $8–12 |
| **COGS дүн** | **≈$25 (≈87,500₮)** |

Starter (390,000₮ ≈ $111) → **gross margin ≈77%**. Business (1,290,000₮ ≈ $369, 5 төсөл дээр COGS ≈$90) → **≈76%**. SaaS-ийн эрүүл босго (75–80%) дотор.

**Хажуугаас (зах зээл):** Procore ≈$375+/сар-аас, Buildertrend $199–799/сар, Fieldwire $39–79/хэрэглэгч/сар. Starter нь Buildertrend-ийн доод түвшинтэй ойролцоо; Business нь Procore-ийн доод түвшнээс хямд. Дотоодын худалдан авах чадвар доогуур ч, **тэдгээр систем монгол хэл, монголын норм, НӨАТ, дотоодын нэхэмжлэхийг дэмждэггүй** — энэ нь үнийн зөвтгөл болно.

**Тоглоомын дүрэм:** Starter-ийг санаатайгаар нэг төсөлтэй болгосон. Компани хоёр дахь төслөө оруулах үед Business руу шилжих нь байгалийн, шударга шалтгаантай болно.

---

## 8. Валют, татвар, төлбөрийн суваг

### 8.1 Provider сонголт

Монголд бүртгэлтэй BuildWatch SaaS-ийн эхний хувилбарт хоёр channel:

1. `LEMON_SQUEEZY` hosted checkout
2. `MANUAL_INVOICE` буюу байгууллагын гэрээ/банк шилжүүлэг

Lemon Squeezy-ийн албан ёсны supported-country жагсаалтад Монгол bank payout дэмждэг гэж орсон. Paddle нь software business-д зориулсан Merchant of Record хувилбар бөгөөд seller onboarding/KYC-г тусад нь баталгаажуулсны дараа хоёр дахь provider болж болно. Stripe-ийн business availability жагсаалтад Монгол одоогоор байхгүй тул supported-country legal entity үүсээгүй нөхцөлд үндсэн төлөвлөгөө болгохгүй.

> **Заавал:** Manual invoice суваг MVP-д ажиллаж байх ёстой. Энэ нь картын суваг ажиллахгүй болсон үеийн fallback бөгөөд дотоодын хуулийн этгээдийн үндсэн сонголт.

### 8.2 Валют ба татвар

| Асуудал | Шийдвэр |
|---|---|
| Дэлгэцийн валют | ₮ (НӨАТ ороогүй үнэ, доор нь "НӨАТ 10% нэмэгдэнэ" тэмдэглэл) |
| Картын checkout | Lemon Squeezy — USD price ID (тухайн provider MNT дэмждэггүй) |
| Дотоодын шилжүүлэг | `MANUAL_INVOICE` суваг — ₮-өөр нэхэмжлэх, НӨАТ-тай |
| Ханшийн бодлого | Plan version бүрт USD price ID тогтмол. Ханш ±10%-иар хазайвал шинэ plan version гаргана. **Кодод ханш hard-code хийхгүй** |
| Тооцооны ханш | 1 USD ≈ 3,500₮ *(баримт гаргах үеийн ойролцоо утга — plan catalog үүсгэхийн өмнө шинэчлэн батлах)* |
| Нэхэмжлэх | Дотоодын хуулийн этгээдэд ₮ нэхэмжлэх, НӨАТ-ийн падаан заавал |

---

## 9. Арилжааны бодлого

| Бодлого | Шийдвэр |
|---|---|
| Grace хугацаа | Төлбөр амжилтгүй болсноос хойш **7 хоног** бүрэн хандалт, анхааруулгатай |
| Grace дууссан | `SUSPENDED` — унших + экспорт + billing үлдэнэ, бичих/AI зогсоно |
| Цуцлалт | Хугацааны эцэст (cancel-at-period-end). Шууд буцаалт хийхгүй |
| Буцаалт | Жилийн багцад эхний 14 хоногт бүтэн буцаалт. Дараа нь буцаалтгүй, хугацааны эцэст зогсоно |
| Өгөгдлийн эзэмшил | Өгөгдөл хэрэглэгчийнх. `SUSPENDED` төлөвт **90 хоног** экспорт хийх боломж нээлттэй |
| Архивлалт | 90 хоногийн дараа `ARCHIVED`; устгал нь тусдаа, бичгээр хүсэлтээр |
| Багц ахиулах | Шууд идэвхжинэ, prorate хийнэ |
| Багц бууруулах | Хугацааны эцэст. Хязгаараас хэтэрсэн төсөл байвал аль нь идэвхтэй үлдэхийг Company Admin сонгоно |
| Нээлттэй trial | **Байхгүй** |

### 9.1 Paid-only болон demo

Real company workspace зөвхөн төлбөрийн дараа provision хийнэ. Борлуулалтын demo хэрэгтэй бол production tenant биш, **тогтмол sample data-тай тусдаа public demo** ашиглана.

Enterprise trial шаардлагатай бол Platform Admin тусгай хугацаатай `TRIAL` entitlement үүсгэнэ. Trial бүр:

- эхлэх/дуусах хугацаа;
- олгосон principal;
- reason;
- entitlement snapshot;
- audit log;

хадгална.

---

# II ХЭСЭГ — LANDING PAGE

## 10. Landing page-ийн стратеги

### 10.1 Гол санаа: "нэг асуулт"

Барилгын салбарын шийдвэр гаргагч feature жагсаалт уншдаггүй. Landing page-ийг **нэг асуултын эргэн тойронд** бүтээнэ:

> **"Өнөөдрийн ажил төлөвлөснөөрөө явж байна уу?"**

Энэ асуулт нь: (а) шийдвэр гаргагчийн бодит өвдөлт, (б) BuildWatch-ийн бүтээгдэхүүний гол чадвар, (в) өрсөлдөгчид (файл хадгалах систем, ERP) хариулж чаддаггүй асуулт — гурвуулаа нэг дор.

### 10.2 Hero — 3 хувилбар (A/B тест хийх)

**Хувилбар A — асуултаар (санал болгож буй):**
> # Өнөөдрийн ажил төлөвлөснөөрөө явсан уу?
> Зураг төслөөс baseline, талбайн тайлангаас баталгаажсан гүйцэтгэл, тэндээс хугацааны урьдчилсан таамаг. Нэг урсгалд. **AI ноорог бэлдэнэ — инженер батална.**
>
> `[Багц сонгох]` `[Демо үзэх]`

**Хувилбар B — өвдөлтөөр:**
> # Хоцролтыг сар эцэст биш, өнөөдөр мэд
> BuildWatch өдөр бүрийн тайлан, зураг, материалын хөдөлгөөнийг батлагдсан baseline-тай тулгаж, хугацаанд амжих эсэхийг тооцоолно.

**Хувилбар C — ялгаагаар:**
> # Тоог AI зохиодоггүй систем
> Тоо хэмжээ, төсөв, critical path, forecast-ийг детерминистик тооцоолол бодно. AI зөвхөн бэлтгэнэ. Эцсийн баталгаа инженерт үлдэнэ.

**Hero-гийн visual:** дэлгэцийн бодит зураг — өдрийн төлөвлөгөө vs гүйцэтгэл, зөрүү тодруулсан. Stock зураг, барилгын талбайн ерөнхий фото **ашиглахгүй** (итгэл алддаг).

---

## 11. Public route ба frontend shell

### 11.1 Public routes

```text
/
/features
/pricing
/security
/contact
/company-signup
/checkout/success
/login
/register                 # existing invitation acceptance хэвээр
/terms
/privacy
```

`/platform/*` нь public navigation-д огт харагдахгүй.

### 11.2 Frontend shell

Шинэ `MarketingShell`:

- Public header
- Product navigation
- Language selector бэлдэх боломж
- Login CTA
- Plan CTA
- Footer/legal links

Marketing route нь tenant `AppShell`, platform `PlatformShell`, token store болон protected API prefetch-ийг **ачаалахгүй**.

Одоогийн Vite app дотор route-level lazy chunks ашиглан эхэлнэ. SEO болон content marketing өссөний дараа л тусдаа SSR marketing app авч үзнэ; MVP-д хоёр frontend deployment үүсгэх шаардлагагүй.

---

## 12. Хуудасны бүтэц

| # | Хэсэг | Гол мессеж | Visual |
|---|---|---|---|
| 1 | Hero | §10.2-ийн асуулт + давхар CTA | Бодит dashboard screenshot |
| 2 | Өвдөлт | "Өгөгдөл бий. Итгэж ашиглах нэг хувилбар алга." | 4 тарсан эх сурвалж → асуултын тэмдэг |
| 3 | Ажиллах зарчим | **Төлөвлө → Бүртгэ → Баталгаажуул → Шийд** | 4 алхамт хэвтээ урсгал |
| 4 | Дүрээр үр дүн | ПМ / Инженер / Хянагч / Удирдлага — тус бүр 1 өгүүлбэр + 1 дэлгэц | Tab-аар солигдох screenshot |
| 5 | AI агентууд | 6 агент юу хийдэг, **юу хийдэггүй** | A0–A5 картууд, "Хүн батална" тэмдэг |
| 6 | Итгэл | Tenant тусгаарлалт, audit trail, "тоо LLM-ээс гарахгүй", өгөгдлийн эзэмшил | Архитектурын хялбар зураг |
| 7 | Багц харьцуулалт | §5-ийн хүснэгт, entitlement-тэй яг таарсан | Хүснэгт |
| 8 | **Үнэ** | Сар/жил toggle, 2 карт + Enterprise | §13-ийг үз |
| 9 | Нэвтрүүлэлт | "Эхний 30 хоногт юу болох вэ" — 4 долоо хоногийн төлөвлөгөө | Хугацааны шугам |
| 10 | FAQ | Төлбөр, цуцлалт, өгөгдлийн эзэмшил, офлайн, НӨАТ | Accordion |
| 11 | Эцсийн CTA | "Багц сонгох" + "Enterprise демо" | Тод хэсэг |

---

## 13. Үнийн хэсгийн зохиомж

```text
┌──────────────────────────────────────────────────────────────────┐
│                        Ил тод үнэ                                │
│        Нуугдмал төлбөргүй. Хэрэглэгчээр биш, төслөөр.            │
│                                                                  │
│            ( Сараар )  [ Жилээр — 2 сар үнэгүй ]                 │
│                                                                  │
│  ┌────────────────────────┐  ┌────────────────────────────────┐  │
│  │ STARTER                │  │ BUSINESS      ★ Санал болгож буй│ │
│  │                        │  │                                │  │
│  │ 390,000₮ /сар          │  │ 1,290,000₮ /сар                │  │
│  │ НӨАТ ороогүй           │  │ НӨАТ ороогүй                   │  │
│  │ жилээр 3,900,000₮      │  │ жилээр 12,900,000₮             │  │
│  │                        │  │                                │  │
│  │ ✓ 1 идэвхтэй төсөл     │  │ ✓ 5 идэвхтэй төсөл             │  │
│  │ ✓ 15 хэрэглэгч         │  │ ✓ 60 хэрэглэгч                 │  │
│  │ ✓ 50 GB                │  │ ✓ 500 GB                       │  │
│  │ ✓ 150 AI ажиллагаа/сар │  │ ✓ 900 AI ажиллагаа/сар         │  │
│  │ ✓ A0–A4 агент          │  │ ✓ A0–A5 бүх агент              │  │
│  │ ✓ Forecast + alert     │  │ ✓ Дэлгэрэнгүй тайлан + API     │  │
│  │ ✓ 90 хоног audit       │  │ ✓ 365 хоног audit              │  │
│  │                        │  │ ✓ Тэргүүн ээлжийн дэмжлэг      │  │
│  │  [ Starter сонгох ]    │  │  [ Business сонгох ]           │  │
│  └────────────────────────┘  └────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ENTERPRISE — групп компани, SSO, SLA, гэрээт нэхэмжлэх     │  │
│  │ Хэрэгцээнд тохирсон хязгаар    [ Холбоо барих ]            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Бүх багцад: монгол хэл, офлайн талбайн горим, audit trail,      │
│  өгөгдлийн экспорт, дотоодын нэхэмжлэх + НӨАТ-ын падаан         │
└──────────────────────────────────────────────────────────────────┘
```

**Заавал биелэх дүрмүүд:**

- Toggle-ийн анхны утга = **Жилээр** (retention өндөр, cash flow сайн). Сарын үнэ хажууд нь харагдана.
- "2 сар үнэгүй"-г **дүнгээр** давхар харуулна: "жилд 780,000₮ хэмнэнэ".
- НӨАТ-ийн тэмдэглэл карт бүр дээр — гэнэтийн зардал гаргахгүй.
- Business дээр **"Хамгийн түгээмэл" гэж бичихгүй** — бодит статистик гарах хүртэл "Санал болгож буй" гэж бичнэ (§14-ийн хуурамч social proof хориг).
- Хязгаарын тоо `PlanEntitlement`-аас **API-аар** ирнэ. Landing дээр гараар бичсэн тоо байвал entitlement өөрчлөгдөхөд худал болно.
- Add-on үнийг картын доор "Хэрэгцээгээ давбал" гэсэн задардаг хэсэгт байрлуулна.
- Checkout CTA pending үед давхар submit хаана.

---

## 14. Copy зарчим

**Хийх:**

- "AI ноорог бэлдэнэ, инженер батална" — энэ өгүүлбэрийг 3 газар давтана.
- Тоог эх сурвалжтай нь ярина: "тоо хэмжээ, төсөв, critical path-ийг детерминистик service бодно".
- Мэдэхгүй үедээ мэдэхгүй гэж хэлдэг гэдгээ давуу тал болгож харуулна (`INSUFFICIENT_INFORMATION`).
- Human review, auditability, tenant isolation-ийг бодитоор тайлбарлана.
- AI allowance, overage, storage, cancel нөхцөлийг ойлгомжтой бичнэ.

**Хийхгүй:**

- Нотлогдоогүй customer logo.
- Fake usage count, fake review, fake uptime ("99.9%" гэх мэт хэмжигдээгүй амлалт).
- "AI бүгдийг автоматаар зөв шийднэ" — P-07 зарчмыг зөрчинө.
- Plan card дээр hidden fee.
- Өрсөлдөгчийг нэрлэн шүүмжлэх.

---

## 15. Дизайн, хүртээмж, гүйцэтгэл

### 15.1 Дизайны чиглэл

- **Өнгө:** одоогийн console-ийн палитрыг үргэлжлүүлнэ — marketing-д тусдаа brand үүсгэхгүй. Хэрэглэгч landing-аас апп руу орход тасралт мэдрэхгүй.
- **Хэмнэл:** хэсэг бүр 1 санаа. Дээд тал нь 3 bullet.
- **Screenshot бодит байх.** Демо tenant-ийн тогтмол sample өгөгдөл ашиглана (§9.1).
- **Гар утас эхэнд.** Талбайн инженер утсаар ханддаг; шийдвэр гаргагч утсаар линк нээж үздэг.

### 15.2 Responsive ба хүртээмж

- Mobile-first navigation
- Keyboard ашиглах боломжтой menu/dialog
- Visible focus state
- WCAG AA contrast зорилт
- Form label/error холбоос
- `prefers-reduced-motion`
- Pricing data-г зөвхөн өнгөөр ялгахгүй, тэмдгээр давхар илэрхийлнэ

### 15.3 Гүйцэтгэл ба SEO

- LCP < 2.0 сек (3G), marketing route-ийн JS < 120 KB gzip
- `/` `/features` `/pricing` `/security` бүрд өвөрмөц title/description
- Монгол хэлний `og:` мета, JSON-LD `SoftwareApplication` + `Offer`
- Sitemap/robots deployment strategy
- Analytics: consent policy батлагдсан үед л privacy-safe funnel event

### 15.4 Хэл

MVP-д зөвхөн монгол. `MarketingShell`-д хэлний сонголтын суурь тавина; англи хувилбар нь Enterprise/экспортын шатанд.

---

# III ХЭСЭГ — ТЕХНИКИЙН АРХИТЕКТУР

## 16. Шийдвэрлэх ёстой үндсэн зарчмууд

### 16.1 Authentication ба paid access тусдаа байна

Login дараах хоёр асуултыг тусад нь шийднэ:

1. Энэ хэрэглэгч хэн бэ?
2. Энэ tenant одоо ямар feature ашиглах эрхтэй вэ?

`RequireAuth` зөвхөн identity/session шалгана. Шинэ `RequireTenantAccess` болон backend `TenantAccessPolicy` нь subscription/lifecycle шалгана.

Subscription status-ийг JWT-д урт хугацаагаар хадахгүй. Subscription webhook-оор хэдийд ч өөрчлөгдөж болох тул backend-ийн authoritative access snapshot-ийг request бүрт эсвэл богино TTL cache-аар шалгана.

### 16.2 Payment provider бол access-ийн цорын ганц model биш

Business logic provider-ийн `active`, `past_due` зэрэг raw status-оос шууд хамаарахгүй. Provider status-ийг BuildWatch-ийн canonical status руу хөрвүүлнэ.

```text
Lemon Squeezy / Paddle / Manual invoice
                    ↓
           BillingProvider adapter
                    ↓
      BuildWatch SubscriptionStatus
                    ↓
        TenantAccessPolicy decision
```

Ингэснээр provider солиход tenant auth, project API болон UI-г дахин бичихгүй.

### 16.3 Checkout success page төлбөрийн баталгаа биш

Browser redirect, query parameter, provider success URL болон frontend state-ээр tenant идэвхжүүлэхгүй.

Зөвхөн:

- webhook signature амжилттай шалгагдсан;
- event ID өмнө нь боловсруулагдаагүй;
- provider price/product серверийн allowlist-тэй таарсан;
- төлбөрийн canonical төлөв access олгох нөхцөл хангасан;

тохиолдолд provisioning хийнэ.

### 16.4 Төлбөрийн доголдлоор data устгахгүй

Subscription дууссан үед:

- Tenant/project data-г hard delete хийхгүй.
- Шинэ operational mutation болон шинэ AI job-ийг хаана.
- Company Admin-д billing болон шаардлагатай export access үлдээнэ.
- Retention хугацаа дууссаны дараах archive/delete нь тусдаа policy байна (§9).

### 16.5 Provider outage бүх tenant-ийг хаах шалтгаан биш

Request бүр payment provider руу synchronous API call хийхгүй. Verified webhook-оос дотоод access snapshot үүсгэнэ. Provider түр unavailable болсон үед сүүлчийн баталгаажсан access хугацаагаар үйлчилнэ.

---

## 17. Payment provider abstraction

Backend interface:

```ts
interface BillingProvider {
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutResult>;
  createCustomerPortal(input: CustomerPortalInput): Promise<PortalResult>;
  verifyWebhook(input: RawWebhookInput): Promise<VerifiedBillingEvent>;
  getSubscription(externalId: string): Promise<ProviderSubscription>;
  cancelAtPeriodEnd(externalId: string): Promise<void>;
}
```

Provider implementation:

```text
LemonSqueezyBillingProvider
PaddleBillingProvider              # дараагийн үе
ManualInvoiceBillingProvider       # automatic webhook биш, audited operator workflow
```

Card number, CVC, full payment method data BuildWatch frontend/backend/database-аар дамжихгүй. Hosted checkout ашиглана.

---

## 18. Domain model

### 18.1 Canonical enums

```prisma
enum TenantLifecycleStatus {
  PENDING_PAYMENT
  ACTIVE
  PAYMENT_GRACE
  SUSPENDED
  ARCHIVED
}

enum BillingProviderKind {
  LEMON_SQUEEZY
  PADDLE
  MANUAL_INVOICE
}

enum SubscriptionStatus {
  PENDING
  TRIALING
  ACTIVE
  PAST_DUE
  PAUSED
  CANCELED
  EXPIRED
}

enum BillingInterval {
  MONTH
  YEAR
  CUSTOM
}

enum BillingEventProcessingStatus {
  RECEIVED
  PROCESSING
  PROCESSED
  IGNORED
  FAILED
}

enum InvoiceStatus {
  DRAFT
  OPEN
  PAID
  VOID
  UNCOLLECTIBLE
  REFUNDED
}
```

### 18.2 Tenant model-ийн өөрчлөлт

`Tenant` дээр provider-ийн raw field олноор нэмэхгүй.

```prisma
model Tenant {
  // existing fields
  lifecycleStatus TenantLifecycleStatus @default(PENDING_PAYMENT)
  accessChangedAt DateTime?
  accessReason    String?
  subscriptions  TenantSubscription[]
  billingCustomer BillingCustomer?
  entitlementSnapshot TenantEntitlementSnapshot?
  invoices       BillingInvoice[]
}
```

Existing tenant-ууд migration хийхдээ шууд хаагдах ёсгүй. Backfill хийх хүртэл `ACTIVE` grandfathered subscription/override үүсгэж, дараа нь default-ийг `PENDING_PAYMENT` болгоно.

### 18.3 Plan болон version

```prisma
model BillingPlan {
  id              String   @id @default(cuid())
  code            String
  version         Int
  name            String
  description     String
  interval        BillingInterval
  currency        String
  unitAmountMinor BigInt?
  active          Boolean  @default(true)
  public          Boolean  @default(false)
  createdAt       DateTime @default(now())
  archivedAt      DateTime?
  entitlements    PlanEntitlement[]
  providerPrices  BillingProviderPrice[]

  @@unique([code, version, interval])
  @@index([active, public])
}

model BillingProviderPrice {
  id              String @id @default(cuid())
  planId          String
  provider        BillingProviderKind
  externalProductId String
  externalPriceId String
  environment     String
  plan            BillingPlan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@unique([provider, environment, externalPriceId])
}
```

Plan version өөрчлөгдөхөд хуучин subscriber-ийн эрх автоматаар өөрчлөгдөхгүй. Шинэ plan version үүсгээд migration policy-оор шилжүүлнэ.

Нэг tier нь сар/жилийн хоёр мөртэй тул unique key нь `interval`-ыг агуулна. Хоёр мөр entitlement-ээ давхардуулж хадгалдаг тул catalog module тэднийг ялгарахаас хамгаалж, тест нь ижил байхыг шаардана.

**§5-аас гарах seed:** `starter@1` болон `business@1` × `MONTH`/`YEAR` = 4 `BillingPlan` мөр, `enterprise@1` × `CUSTOM` = 1 мөр, тус бүр §6.1-ийн 13 `PlanEntitlement` түлхүүртэй.

Money бүх талбарт ISO 4217 minor unit-аар хадгалагдана. MNT хоёр аравтайтай тул 390,000₮ = `39_000_000`.

### 18.4 Subscription

```prisma
model TenantSubscription {
  id                     String @id @default(cuid())
  tenantId               String
  planId                 String
  provider               BillingProviderKind
  providerCustomerId     String?
  providerSubscriptionId String?
  status                 SubscriptionStatus
  currentPeriodStart     DateTime?
  currentPeriodEnd       DateTime?
  graceEndsAt            DateTime?
  cancelAtPeriodEnd      Boolean @default(false)
  canceledAt             DateTime?
  providerUpdatedAt      DateTime?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
  tenant                 Tenant @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  plan                   BillingPlan @relation(fields: [planId], references: [id], onDelete: Restrict)

  @@unique([provider, providerSubscriptionId])
  @@index([tenantId, status, currentPeriodEnd])
  @@index([status, graceEndsAt])
}
```

Нэг tenant subscription history-тай байна. Нэг агшинд access олгох нэг canonical subscription/contract л байна. Энэ invariant-ийг service transaction болон DB constraint-аар хамгаална.

### 18.5 Signup intent

Төлбөр баталгаажаагүй үед бүрэн Tenant/User үүсгэхгүй.

```prisma
model CompanySignupIntent {
  id                String @id @default(cuid())
  companyName       String
  desiredSlug       String
  adminEmail        String
  adminEmailNormalized String
  adminDisplayName  String
  planId            String
  provider          BillingProviderKind
  providerCheckoutId String? @unique
  status            CompanySignupIntentStatus @default(PENDING_VERIFICATION)
  expiresAt         DateTime
  emailVerifiedAt   DateTime?
  completedTenantId String?
  idempotencyKeyHash String
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([adminEmailNormalized, status])
  @@index([expiresAt, status])
}
```

Password-ийг checkout-аас өмнө хадгалахгүй. Payment баталгаажсаны дараа Company Admin-д нэг удаагийн password-setup token илгээнэ. Token-ийг одоогийн security-token pattern-ийн адил hash хэлбэрээр хадгална.

### 18.6 Entitlement snapshot

```prisma
model PlanEntitlement {
  id           String @id @default(cuid())
  planId       String
  featureKey   String
  enabled      Boolean
  limitValue   BigInt?
  unit         String?
  plan         BillingPlan @relation(fields: [planId], references: [id], onDelete: Cascade)

  @@unique([planId, featureKey])
}

model TenantEntitlementSnapshot {
  tenantId       String @id
  subscriptionId String?
  sourceVersion  String
  entitlements   Json
  effectiveFrom  DateTime
  effectiveUntil DateTime?
  refreshedAt    DateTime
  tenant         Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
}
```

`entitlements` JSON нь arbitrary provider payload биш. Strict allowlisted, versioned internal schema байна.

### 18.7 Webhook inbox болон invoice

```prisma
model BillingWebhookEvent {
  id               String @id @default(cuid())
  provider         BillingProviderKind
  providerEventId  String
  eventType        String
  payloadHash      String
  occurredAt       DateTime
  receivedAt       DateTime @default(now())
  processedAt      DateTime?
  status           BillingEventProcessingStatus
  attemptCount     Int @default(0)
  lastErrorCode    String?
  correlationId    String

  @@unique([provider, providerEventId])
  @@index([status, receivedAt])
}

model BillingInvoice {
  id                String @id @default(cuid())
  tenantId          String
  subscriptionId    String?
  provider          BillingProviderKind
  providerInvoiceId String
  invoiceNumber     String?
  status            InvoiceStatus
  currency          String
  subtotalMinor     BigInt
  taxMinor          BigInt
  totalMinor        BigInt
  paidAt            DateTime?
  dueAt             DateTime?
  hostedInvoiceUrl  String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@unique([provider, providerInvoiceId])
  @@index([tenantId, createdAt])
}
```

Raw webhook payload-ийг business table-д хуулж хадгалахгүй. Debug/replay шаардлагатай бол encrypted, access-controlled, богино retention бүхий тусдаа storage policy хэрэгтэй.

---

## 19. Tenant access policy

### 19.1 Access matrix

| Tenant lifecycle | Login | Billing | Read business data | Write business data | New AI jobs |
|---|---:|---:|---:|---:|---:|
| `PENDING_PAYMENT` | Company Admin only | Тийм | Үгүй | Үгүй | Үгүй |
| `ACTIVE` | Тийм | Company Admin | Тийм | Entitlement-аар | Entitlement/quota-аар |
| `PAYMENT_GRACE` | Тийм | Company Admin | Тийм | Тийм, warning-тай | Policy-оор хязгаарлаж болно |
| `SUSPENDED` | Тийм | Company Admin | Limited/read-only | Үгүй | Үгүй |
| `ARCHIVED` | Үгүй эсвэл support flow | Үгүй | Үгүй | Үгүй | Үгүй |

### 19.2 Backend enforcement

```text
TenantAccessPolicy
├── getDecision(tenantId, userId, operation)
├── requireWorkspaceAccess(...)
├── requireFeature(featureKey)
├── requireLimit(featureKey, requestedDelta)
└── explainDecision(...)
```

Enforcement дараах бүх замд орно:

- REST API mutation
- File upload/download authorization
- Agent run creation
- Outbox worker
- Scheduled job
- Notification action
- Invitation acceptance
- Project creation
- User activation

Frontend guard бол UX бөгөөд security boundary биш. Backend default-deny байна.

### 19.3 Route allowlist

Subscription хаалттай tenant-ийн Company Admin дараах endpoint-уудыг ашиглаж болно:

```text
GET  /v1/session
GET  /v1/billing/subscription
GET  /v1/billing/invoices
POST /v1/billing/checkout
POST /v1/billing/portal
POST /v1/auth/logout
POST /v1/auth/refresh
GET  /v1/account/export-status       # policy зөвшөөрвөл
```

Бусад endpoint `TENANT_SUBSCRIPTION_REQUIRED` эсвэл `TENANT_ACCESS_SUSPENDED` domain error буцаана (HTTP **402**).

`/v1/auth/*` нь authenticated `/v1` stack-аас өмнө бүртгэгддэг тул энэ gate-д огт хүрэхгүй — нэвтрэлт subscription-оос үл хамаарна.

### 19.4 Grace policy

§9-ийн шийдвэрийн техникийн хэрэгжилт:

- `PAST_DUE` эхэлснээс хойш 7 хоногийн grace.
- Grace үед Company Admin бүх дэлгэц дээр persistent warning харна.
- Renewal амжилттай бол `ACTIVE` руу автоматаар буцна.
- Grace дуусвал `SUSPENDED` болно.
- Provider webhook ирээгүй/саатсан үед confirmed paid period дуусаагүй бол access-ийг хаахгүй.
- Manual invoice-д due date болон Platform Operator approval policy хэрэглэнэ.

Grace хугацаа versioned policy байна; UI-д hard-code хийхгүй.

---

## 20. Checkout ба provisioning flow

### 20.1 Public company signup

`POST /public/v1/company-signups`:

1. Company name, desired slug, admin name/email, plan code хүлээн авна.
2. Input-ийг strict parse хийнэ.
3. Plan public/active/version зөв эсэхийг сервер шалгана.
4. Email verification challenge үүсгэнэ.
5. `CompanySignupIntent` үүсгэнэ.
6. Rate limit болон abuse prevention хэрэглэнэ.

Existing invitation `/register` урсгалыг өөрчлөхгүй. Company signup болон invited-user registration хоёр тусдаа route байна.

### 20.2 Checkout creation

`POST /public/v1/company-signups/:id/checkout`:

- Signup intent verified бөгөөд expire болоогүй эсэхийг шалгана.
- Frontend-ээс amount, currency, provider price ID авахгүй.
- Internal plan version-оос server allowlist price ID сонгоно.
- Provider checkout metadata-д зөвхөн opaque `signupIntentId` болон correlation ID өгнө.
- Нэг intent дээр давтан дарахад existing valid checkout URL буцаах idempotency хэрэглэнэ.

### 20.3 Webhook processing

```text
POST /webhooks/billing/:provider
        ↓
Raw body авах
        ↓
Signature + timestamp шалгах
        ↓
providerEventId unique insert
        ↓
Strict event mapping
        ↓
Transaction / outbox
        ↓
Subscription + invoice update
        ↓
Entitlement snapshot refresh
        ↓
Tenant lifecycle transition
```

Webhook handler хурдан `2xx` буцааж, хүнд processing-ийг durable worker хийж болно. Processing нь duplicate болон out-of-order event-д тэсвэртэй байна.

Out-of-order хамгаалалт:

- `providerUpdatedAt`-аас хуучин event canonical subscription-ийг буцааж дордуулахгүй.
- Invoice event болон subscription event тусдаа version/timestamp-тай байна.
- Unknown event type-ийг `IGNORED` гэж хадгална; access олгохгүй.

### 20.4 Atomic provisioning

Анхны confirmed payment дээр нэг transaction-аар:

1. Signup intent lock хийх
2. Давхар completion эсэхийг шалгах
3. Tenant үүсгэх
4. Billing customer үүсгэх
5. Tenant subscription үүсгэх
6. Company Admin user-ийг `INVITED` төлөвөөр үүсгэх
7. Password setup/email verification token үүсгэх
8. Entitlement snapshot үүсгэх
9. Tenant lifecycle-ийг `ACTIVE` болгох
10. Tenant audit/outbox event үүсгэх
11. Signup intent-ийг completed болгох

Email явуулах ажиллагаа transaction дотор network call хийхгүй; outbox ашиглана.

Хэрэв company admin email өөр tenant-д аль хэдийн байгаа бол одоогийн multi-tenant login selection flow-той нийцүүлж тухайн tenant-д шинэ `User` row үүсгэж болно. Global user model руу одоо migration хийх шаардлагагүй.

### 20.5 Success page

`/checkout/success?checkout=opaque-id` page:

- "Payment received" гэж шууд зарлахгүй.
- Backend confirmation status poll хийнэ.
- Төлөв: `CONFIRMING`, `ACTIVE`, `FAILED`, `EXPIRED`.
- `ACTIVE` бол "Email-ээ шалгаж account-аа идэвхжүүлнэ үү" гэж харуулна.
- Poll bounded backoff ашиглаж, user refresh хийсэн ч ажиллана.

---

## 21. Company Admin billing experience

Шинэ route:

```text
/admin/billing
```

Харуулах зүйл:

- Current plan болон version
- Subscription/access status
- Current billing period
- Next renewal/due date
- Grace end date
- Active project/user/AI/storage usage
- Limit болон overage policy (§6.2)
- Invoice history
- Hosted invoice link
- "Manage subscription/payment" provider portal button
- Cancel-at-period-end төлөв

Permission:

```text
TENANT_BILLING_READ
TENANT_BILLING_MANAGE
```

MVP-д `COMPANY_ADMIN` эдгээр permission-ийг авна. Project role payment method өөрчлөхгүй.

Billing page subscription хаалттай үед ч ажиллах ёстой тул ердийн workspace access guard-ийн дотор биш, `RequireAuth + RequireBillingPermission` доор байна.

---

## 22. Platform Super Admin billing experience

Шинэ platform permission:

```text
PLATFORM_BILLING_READ
PLATFORM_BILLING_MANAGE
PLATFORM_PLAN_MANAGE
```

Role санал:

| Role | Billing read | Manual invoice/override | Plan publish |
|---|---:|---:|---:|
| `PLATFORM_AUDITOR` | Тийм | Үгүй | Үгүй |
| `PLATFORM_OPERATOR` | Тийм | Policy-оор | Үгүй |
| `PLATFORM_SUPER_ADMIN` | Тийм | Тийм | Тийм |

Routes:

```text
/platform/billing
/platform/billing/subscriptions
/platform/billing/invoices
/platform/billing/webhooks
/platform/plans
```

Control Tower дээр:

- Active subscriptions
- Past due tenants
- Grace ending soon
- Suspended tenants
- Failed billing webhooks
- Monthly recurring revenue — зөвхөн reconciliation найдвартай болсны дараа

MRR, churn, failed payment зэрэг KPI-г invoice/subscription model бүрэн баталгаажаагүй үед placeholder байдлаар гаргахгүй.

Manual action:

- Invoice paid confirm
- Time-bound access override
- Grace extension
- Subscription reconcile

Action бүр reason, impact preview, confirm, idempotency key болон `PlatformAuditLog` шаардлагатай. Card/payment credential platform UI-д харагдахгүй.

---

## 23. API contract

### 23.1 Public API

```text
GET  /public/v1/plans
POST /public/v1/company-signups
POST /public/v1/company-signups/:id/verify-email
POST /public/v1/company-signups/:id/checkout
GET  /public/v1/company-signups/:id/status
POST /webhooks/billing/:provider
```

`GET /public/v1/plans` нь §13-ийн үнийн хэсгийг тэжээнэ — landing page дээрх хязгаарын тоо гараар бичигдэхгүй.

### 23.2 Tenant billing API

```text
GET  /v1/billing/subscription
GET  /v1/billing/entitlements
GET  /v1/billing/usage
GET  /v1/billing/invoices
POST /v1/billing/portal
POST /v1/billing/change-plan       # MVP дараа байж болно
POST /v1/billing/cancel
```

### 23.3 Platform billing API

```text
GET  /platform/v1/billing/overview
GET  /platform/v1/billing/subscriptions
GET  /platform/v1/billing/invoices
GET  /platform/v1/billing/webhooks
POST /platform/v1/billing/manual-invoices/:id/confirm
POST /platform/v1/billing/tenants/:tenantId/override
POST /platform/v1/billing/subscriptions/:id/reconcile
GET  /platform/v1/plans
POST /platform/v1/plans
POST /platform/v1/plans/:id/publish
POST /platform/v1/plans/:id/archive
```

Public plans response нь internal/provider IDs, secret, unpublished plan, negotiated Enterprise price задруулахгүй.

---

## 24. Security requirements

### 24.1 Webhook

- Raw request body дээр signature verify хийх
- Timestamp tolerance шалгах
- Provider secret зөвхөн backend environment-д хадгалах
- Signature fail бол generic `400/401`
- Provider event ID unique/idempotent байх
- Unknown product/price access олгохгүй
- Event processing retry bounded байх
- Raw secret, signature, payment payload log-д оруулахгүй

### 24.2 Checkout

- Amount/currency/price-ийг client-ээс итгэхгүй
- `signupIntentId` таах боломжгүй байх
- Email болон slug enumeration-ийг generic response-оор багасгах
- Signup/checkout rate limit
- Return URL allowlist
- Open redirect хориглох
- Checkout creation idempotency

### 24.3 Tenant isolation

- Billing query бүр tenant context-ийг verified token-оос авна
- Client-ийн `tenantId` access proof биш
- Company Admin өөр tenant-ийн invoice/subscription ID-г ашиглаж чадахгүй
- Platform billing endpoint tenant bearer хүлээн авахгүй
- Platform token tenant mutation endpoint-д ажиллахгүй хэвээр байна

### 24.4 Sensitive data

Хадгалж болохгүй:

- Card number/CVC
- Provider API secret
- Webhook signing secret
- Raw payment method object
- Raw billing payload бүхий audit metadata
- Password/verification token plaintext

Хадгалж болох safe reference:

- Provider customer/subscription/invoice ID
- Card brand + last4 зөвхөн provider portal шаардлагагүй үед, policy зөвшөөрвөл
- Invoice total/currency/status
- Hosted invoice URL — богино/controlled access нөхцөлтэй
- Payload hash

### 24.5 Audit

```text
BILLING_CHECKOUT_CREATED
BILLING_WEBHOOK_PROCESSED
SUBSCRIPTION_ACTIVATED
SUBSCRIPTION_PAST_DUE
SUBSCRIPTION_SUSPENDED
SUBSCRIPTION_RESTORED
SUBSCRIPTION_CANCELED
PLAN_CHANGED
MANUAL_INVOICE_CONFIRMED
BILLING_ACCESS_OVERRIDE_CREATED
BILLING_ACCESS_OVERRIDE_EXPIRED
```

Platform operator action `PlatformAuditLog`, tenant-side action `AuditLog` дээр бичигдэнэ.

---

## 25. Background jobs

1. Billing webhook processor
2. Subscription reconciliation
3. Grace expiration evaluator
4. Expiring-card/upcoming-renewal notification — provider дэмжвэл
5. Usage snapshot/limit evaluator
6. Expired signup cleanup
7. Expired override cleanup
8. Failed webhook retry/dead-letter monitor

Reconciliation job provider unavailable үед tenant-ийг mass suspend хийхгүй. `UNKNOWN` billing health үүсгэж Platform Control Tower дээр attention гаргана.

---

## 26. Notification policy

| Event | Company Admin | Platform Operator |
|---|---:|---:|
| Payment successful | Тийм | Үгүй |
| Trial/payment period ending | Тийм | Үгүй |
| Payment failed | Тийм | Aggregate/critical үед |
| Grace started | Тийм | Тийм |
| Grace ending soon | Тийм | Тийм |
| Tenant suspended | Тийм | Тийм |
| Subscription restored | Тийм | Үгүй |
| AI quota 80% / 100% (§6.2) | Тийм | Үгүй |
| Webhook dead-letter | Үгүй | Тийм |

Email notification өөрөө access state-ийн эх үүсвэр биш. Notification fail болсон ч subscription transition алдагдахгүй.

---

# IV ХЭСЭГ — ХЭРЭГЖҮҮЛЭЛТ

## 27. Implementation phases

### Phase 0 — Product decisions freeze ✅ **ДУУССАН**

| Шийдвэр | Төлөв | Хаана |
|---|---|---|
| MVP provider батлах | ✅ Lemon Squeezy (карт) + Manual invoice (дотоод) | §8.1 |
| Manual invoice дэмжих эсэх | ✅ Тийм, дотоодын хуулийн этгээдэд заавал | §8.1 |
| Monthly/yearly interval | ✅ Хоёулаа; жил = 10 сарын үнэ | §5 |
| Starter/Business/Enterprise entitlement matrix | ✅ | §6.1 |
| Валют болон tax display | ✅ ₮ дэлгэц / USD price ID / НӨАТ 10% тусад нь | §8.2 |
| 7 хоногийн grace policy | ✅ 7 хоног | §9, §19.4 |
| Cancel-at-period-end policy | ✅ | §9 |
| Refund/access policy | ✅ 14 хоног (жилийн багц) | §9 |
| Data retention/archive policy | ✅ 90 хоног экспорт → архив | §9 |
| Enterprise trial policy | ✅ Зөвхөн Platform Admin, audit-тай | §9.1 |
| Terms, Privacy, Subscription нөхцөлийн legal review | ⬜ **НЭЭЛТТЭЙ** — хуульчийн хяналт шаардлагатай | — |

**Exit criteria:** Нэг versioned plan catalog болон access-state table батлагдсан. §5 + §6.1 нь plan catalog-ийн эх сурвалж; access-state table §19.1-д бий. **Phase 1 эхлэх боломжтой.**

### Phase 1 — Billing domain ба migration ✅ **ДУУССАН**

**Зорилго:** Provider-оос үл хамаарах canonical billing model бий болгох.

- [x] 7 enum нэмэх — `agents/prisma/schema.prisma`
- [x] `Tenant.lifecycleStatus`, `accessChangedAt`, `accessReason`
- [x] `BillingPlan`, `PlanEntitlement`
- [x] `BillingProviderPrice`
- [x] `BillingCustomer`, `TenantSubscription`
- [x] `TenantEntitlementSnapshot`
- [x] `CompanySignupIntent`
- [x] `BillingWebhookEvent`, `BillingInvoice`
- [x] Constraint/index/custom SQL migration — `20260812071010_add_billing_domain`
- [x] Existing tenant grandfather/backfill migration
- [x] Billing audit event contract — `agents/src/backend/billing-contracts.ts`
- [x] **§5-ийн plan seed** — `pnpm run seed:billing:plans` (idempotent)
- [x] Prisma validation/generate

**Exit criteria:** Existing tenant-ууд хаагдаагүй, plan/subscription fixture strict contract-аар үүсдэг байна. ✅

**Нотолгоо:**

| Шалгалт | Тушаал | Үр дүн |
|---|---|---|
| Contract/schema тест | `pnpm exec vitest run tests/backend/billing-domain.test.ts` | 19/19 |
| Backend regression | `pnpm exec vitest run tests/backend` | 209/209 |
| DB invariant smoke | `pnpm run smoke:billing:postgres` | 12/12 |
| Schema | `pnpm exec prisma validate` · `tsc --noEmit` | цэвэр |

Grandfather backfill: 4 tenant → `ACTIVE` + `GRANDFATHERED_PRE_BILLING`, шинэ default `PENDING_PAYMENT`.

**Хэрэгжилтийн үед нэмсэн хамгаалалт:**

- `TenantSubscription_one_canonical_per_tenant_key` — partial unique index. Нэг tenant дээр access олгох хоёр дахь subscription DB түвшинд татгалзана; `CANCELED`/`EXPIRED` түүх хязгааргүй хуримтлагдана.
- `BillingPlan_public_requires_amount_check` — үнэгүй plan нийтэд харагдах боломжгүй. Landing page үнэгүй карт харуулах техникийн боломжгүй болсон.
- `BillingInvoice_total_matches_components_check` — `total = subtotal + tax`. Webhook projection-ийн алдааг DB барина.
- `onDelete: Restrict` санхүүгийн бүх мөр дээр — tenant устгалт нэхэмжлэхийн түүхийг устгаж чадахгүй.
- Seed нь subscriber-тэй plan version-ийг **дахин үнэлэхээс татгалзана** (§18.3-ийг гүйцэтгэлээр хамгаална).

**Илэрсэн асуудал (Phase 1-ийн гадна):** `prisma migrate dev` нь Control Tower-ийн 10 гүйцэтгэлийн индексийг устгахыг санал болгодог. Тэдгээр нь raw SQL-ээр үүссэн бөгөөд `schema.prisma`-д зарлагдаагүй. Энэ migration-д санаатайгаар оруулаагүй. Дараагийн migration-д индексүүдийг schema.prisma-д зарлаж drift-ийг хаах шаардлагатай.

### Phase 2 — Tenant access policy ✅ **ДУУССАН**

**Зорилго:** Subscription төлөвөөс хамаарсан backend authorization boundary бий болгох.

- [x] `TenantAccessPolicy` service — `agents/src/backend/tenant-access-policy.ts`
- [x] Canonical access decision contract (`TenantAccessDecision`)
- [x] Billing-only endpoint allowlist — `agents/src/backend/tenant-access-routes.ts`
- [x] Workspace read/write gate — `/v1` Express middleware
- [x] Feature entitlement gate — `requireFeature`
- [x] Project/user/storage/AI limit gate — `requireLimit` (дуудлагын цэгүүд Phase 9-д)
- [x] Agent-job gate — AI_JOB route классификац
- [x] Stable domain error codes (§6.2) — 7 код `phase9ErrorCodeSchema`-д
- [x] Access decision audit/metrics — `tenant_access_denied_*_total`

**Exit criteria:** Suspended tenant client-side bypass хийсэн ч operational mutation болон шинэ AI job эхлүүлж чадахгүй. ✅

**Нотолгоо:**

| Шалгалт | Тушаал | Үр дүн |
|---|---|---|
| Access policy тест | `pnpm exec vitest run tests/backend/tenant-access-policy.test.ts` | 24/24 |
| Бүх agents suite | `pnpm exec vitest run` | 838/838 (139 файл) |
| Console suite | `pnpm --dir agent-console run test:components` | 121/121 |
| DB invariant smoke | `pnpm run smoke:billing:postgres` | 15/15 |

Suspended tenant-ийн бодит HTTP оролдлого: `POST /v1/projects` → **402 `TENANT_ACCESS_SUSPENDED`**, `POST /v1/projects/:id/a1-intakes` → **402**, харин `GET /v1/session` болон `GET /v1/projects` → **200**.

**Хэрэгжилтийн үед нэмсэн хамгаалалт:**

- **Production дээр gate байхгүй бол сервер асахгүй.** `createPhase9Api` нь `nodeEnv=production` үед `tenantAccess` дутуу бол шууд throw хийнэ. Security gate "санамсаргүй унтарсан" байх боломжгүй.
- **Дууссан grace = suspended.** Grace evaluator ажиллаагүй байсан ч `graceEndsAt` өнгөрсөн бол policy шууд SUSPENDED гэж үзнэ. Гацсан worker үнэгүй хандалт тараахгүй.
- **Path traversal-аар billing эрх авах боломжгүй.** `/v1/billing/../projects`, `%2e%2e`, `//` зэрэг канон бус зам allowlist-д тохирохгүй бөгөөд WRITE болж ангилагдана.
- **Хэрэглээ мэдэгдэхгүй бол зөвшөөрөхгүй.** `requireLimit`-д `currentUsage: null` дамжуулбал 503 буцаана — 0 гэж хуурамчаар тооцохгүй (§28).
- **Grandfathered tenant хаагдахгүй.** Entitlement snapshot байхгүй бол "хязгааргүй" гэж үзнэ, "бүх хязгаар тэг" гэж үзэхгүй. Эвдэрсэн snapshot ч мөн адил — lifecycle gate хэвээр ажиллана.
- **Console-д монгол мессеж.** 7 шинэ код бүрд `agent-console/src/lib/api-error.ts`-д тодорхой хариу нэмсэн; 402 нь "Хүсэлт амжилтгүй боллоо" гэж харагдахгүй.

**Илэрсэн асуудал (Phase 2-ийн гадна):** OpenAPI-ийн `ErrorEnvelope` нь `code`-ыг `type: string` гэж зарладаг, enum байхгүй. Тиймээс client error code-ийн жагсаалтыг гэрээнээс мэдэх боломжгүй. Enum нэмбэл console-ийн codegen өөрчлөгдөх тул Phase 10-ийн contract ажилд оруулах нь зөв.

### Phase 3 — Billing provider adapter ✅ **КОД ДУУССАН** (нэг зүйл хүнээс хамаарна)

**Зорилго:** Hosted checkout болон customer portal-ийг provider-neutral service-ээр ажиллуулах.

- [x] `BillingProvider` interface — `agents/src/backend/billing-provider.ts`
- [ ] **Provider sandbox account/KYC readiness** — Lemon Squeezy дээр бодит store үүсгэх нь бизнесийн алхам; кодоор хийгдэхгүй
- [x] Product/price mapping — manual суваг бүрэн seed хийгдсэн; LS variant ID нь store үүссэний дараа
- [x] Lemon Squeezy adapter — `billing-provider-lemon-squeezy.ts`
- [x] Manual invoice adapter — `billing-provider-manual.ts`
- [x] Checkout idempotency — `BillingCheckoutService` + `CheckoutIdempotencyStore` port
- [x] Portal session — `createCustomerPortal`
- [x] Environment/config validation — `billing-config.ts` + release gate
- [x] Secret scanning/log redaction — `redactBillingSecrets`, `security:secrets:v22` PASS
- [x] Provider contract tests — 36 тест

**Exit criteria:** Sandbox hosted checkout server-selected plan/price-аар нээгдэнэ; card data BuildWatch-д дамжихгүй.
Картын суваг: бодит sandbox store гарсны дараа баталгаажна. **Дотоодын нэхэмжлэхийн суваг гуравдагч этгээдгүйгээр бүтнээрээ ажиллаж байгааг postgres smoke дээр баталсан.**

**Нотолгоо:**

| Шалгалт | Тушаал | Үр дүн |
|---|---|---|
| Provider contract тест | `pnpm exec vitest run tests/backend/billing-provider.test.ts` | 36/36 |
| Бүх agents suite | `pnpm exec vitest run` | 874/874 (140 файл) |
| DB smoke (Phase 1–3) | `pnpm run smoke:billing:postgres` | 18/18 |
| Secret scan | `pnpm run security:secrets:v22` | PASS |

**Хэрэгжилтийн үед олсон бодит алдаа:** `subscription_payment_success` нь `subscription_` угтвартай тул subscription гэж уншигдаж, `status: "paid"` дээр `PAYLOAD_INVALID` шидэж байсан. Энэ нь **амжилттай төлбөрийн webhook бүрийг татгалзах** байлаа. Event нэрээр биш JSON:API `data.type`-аар ялгахаар засаж, regression тест нэмсэн.

**Хэрэгжилтийн үед нэмсэн хамгаалалт:**

- **Цуцалсан захиалга төлсөн хугацаагаа дуустал ажиллана.** Lemon Squeezy нь товч дармагц `cancelled` болгодог ч `ends_at` хүртэл төлбөр хийгдсэн байдаг. Шууд `CANCELED` гэж уншвал төлсөн хэрэглэгчийг эрт таслана. Одоо: `ends_at` ирээдүйд байвал `ACTIVE` + `cancelAtPeriodEnd`.
- **Танихгүй статус хэзээ ч ACTIVE болохгүй.** Шинэ provider статус гарвал `PAYLOAD_INVALID` шидэж, хандалт олгохгүй (default-deny).
- **Нэхэмжлэхийн дүнг дахин тооцно.** `total = subtotal + tax` гэж бодож, provider-ийн мэдээлсэн дүнтэй зөрвөл татгалзана — DB-ийн CHECK constraint дээр унахаас өмнө барина.
- **Retry хийхгүй.** LS-д checkout үүсгэх idempotency key байхгүй тул timeout дээр дахин оролдвол нэг худалдан авагчид хоёр төлбөрийн хуудас үүснэ. Нэг л оролдлого, дараа нь caller-ийн idempotency record шийднэ.
- **Event ID детерминистик.** LS event id өгөөгүй үед `sha256(eventType|type|id|updated_at)`-аас гаргана. Жинхэнэ давхардал нэг мөр болж хураагдана, бодит өөрчлөлт өөр id авна.
- **Open redirect хаагдсан.** Return URL нь origin + path prefix-ээр яг таарах ёстой; `javascript:`, credential, traversal, `//host`, `app.test.evil.test` бүгд татгалзана.
- **Production дээр sandbox ажиллуулах боломжгүй.** `BILLING_ENVIRONMENT=sandbox` + `NODE_ENV=production` → startup дээр унана. Мөн manual суваг production-д унтраагдахгүй.
- **Manual суваг webhook хүлээж авахгүй.** `verifyWebhook` нь `UNSUPPORTED_OPERATION` шидэнэ — гарын үсэггүй POST-оор tenant идэвхжүүлэх зам байхгүй.
- **Dev машин нууц түлхүүргүйгээр ажиллана.** LS credential байхгүй бол автоматаар manual суваг руу шилжинэ; production дээр л картын provider заавал.

**Хүнээс хамаарах үлдэгдэл:** Lemon Squeezy дээр бодит store, product, variant үүсгээд `BillingProviderPrice`-д 4 variant ID оруулах. Түүнээс өмнө картын checkout ажиллахгүй. Мөн адаптерын payload талбарын нэрсийг live sandbox-ийн бодит webhook-той тулгаж баталгаажуулах шаардлагатай.

### Phase 4 — Webhook inbox ба subscription state machine ✅ **ДУУССАН**

**Зорилго:** Payment result-ийг баталгаатай, duplicate-safe байдлаар дотоод state болгох.

- [x] Raw body signature verification — `POST /webhooks/billing/:provider` нь `express.raw`-аар JSON parser-аас өмнө
- [x] Webhook inbox insert — `BillingWebhookEvent`, unique `(provider, providerEventId)`
- [x] Duplicate event replay — давхардсан хүргэлт `DUPLICATE` болж, юу ч үүсгэхгүй
- [x] Out-of-order хамгаалалт — `providerUpdatedAt`-аар хуучин event татгалзана
- [x] Subscription transition state machine — `billing-webhook-service.ts`
- [x] Invoice projection
- [x] Entitlement snapshot refresh
- [x] Tenant lifecycle transition + access cache invalidation
- [x] Retry/dead-letter — inbox `FAILED` төлөвт `lastErrorCode`-той үлдэнэ
- [x] Reconciliation command/job — `billing-reconciliation.ts` + `pnpm run billing:maintenance`
- [x] Sanitized diagnostics — `redactBillingSecrets`

**Exit criteria:** Browser success URL activation хийдэггүй; зөвхөн зөв signed webhook paid access олгоно. ✅ `smoke:billing:lifecycle` дээр батлагдсан.

### Phase 5 — Company signup ба atomic provisioning ✅ **ДУУССАН**

**Зорилго:** Public visitor-оос paid tenant хүртэл orphan/duplicate үүсгэхгүй урсгал бий болгох.

- [x] Company signup request schema/API
- [x] Email verification — нэг удаагийн hash, атомик compare-and-set
- [x] Desired slug reservation/conflict handling
- [x] Plan selection — зөвхөн public plan
- [x] Checkout creation + idempotency
- [x] Status polling endpoint
- [x] Atomic tenant/subscription/admin provisioning — нэг transaction
- [x] Password setup token — `SecurityToken`, hash хэлбэрээр
- [x] **Welcome/invite email** — `mailer.ts`, SMTP transport, 4 захидал. Delivery нь төлөв шийддэггүй
- [x] Abandoned/expired signup cleanup — `purgeExpired()`

**Exit criteria:** Нэг confirmed payment яг нэг tenant, нэг subscription, нэг initial Company Admin үүсгэнэ. ✅

### Phase 6 — Public landing page ✅ **ДУУССАН**

**Зорилго:** Product-ийг тайлбарлаж, plan сонгуулж, signup/checkout руу найдвартай шилжүүлэх.

- [x] `MarketingShell` — token store, protected prefetch ачаалахгүй
- [x] `/` landing — §12-ийн 11 хэсэг, үнэ ба багц landing дээрээ
- [x] `/features`, `/security`, `/contact`, `/terms`, `/privacy`
- [x] `/pricing` — §13-ийн зохиомж, сар/жил toggle (default жил)
- [x] `/company-signup`, `/checkout/success`
- [x] Public plan API integration — үнэ/хязгаар `PlanEntitlement`-аас
- [ ] Демо screenshot — ажиллаж буй апп шаардана
- [x] Route-level lazy loading
- [x] Responsive/accessibility — skip link, focus ring, ARIA, гар утасны hamburger цэс
- [x] SEO metadata, OpenGraph, og:image, JSON-LD `SoftwareApplication`+`Offer`
- [x] Sitemap/robots — `agent-console/public/`, домэйн орлуулах шаардлагатай
- [ ] Analytics — consent policy батлагдаагүй тул санаатайгаар хийгээгүй

**Exit criteria:** Visitor landing → plan → verified signup → hosted checkout → confirming page хүртэл явна. ✅

### Phase 7 — Company Admin billing UI ✅ **ДУУССАН**

**Зорилго:** Company Admin өөрийн plan, invoice, usage, payment recovery-г удирдах.

- [x] `TENANT_BILLING_READ/MANAGE` — SUPER_ADMIN + COMPANY_ADMIN
- [x] `/admin/billing` + sidebar холбоос
- [x] Subscription/access status
- [x] Usage/limit cards — 80%/100% дээр өнгө солигдоно
- [x] Invoice history
- [x] Provider portal — manual сувагт ойлгомжтой татгалзал
- [x] Cancel-at-period-end
- [x] Grace/suspension banners
- [x] Billing-only shell state — allowlist-ээр хаагдсан үед ажиллана
- [x] Network error UX

**Exit criteria:** Suspended Company Admin login хийгээд төлбөрөө сэргээж чадна; project mutation ашиглаж чадахгүй. ✅

### Phase 8 — Platform billing control ✅ **ДУУССАН**

**Зорилго:** Platform team subscription health болон manual contract-ийг audit-тай удирдах.

- [x] Platform billing permissions — `PLATFORM_BILLING_READ` (auditor хүртэл), `PLATFORM_BILLING_MANAGE` (operator), `PLATFORM_PLAN_MANAGE` (зөвхөн super admin)
- [x] Billing overview/read model — `platform-billing-service.ts`
- [x] Subscription list/detail
- [x] Past-due/grace/suspended тоолуур
- [x] Webhook health/dead-letter дэлгэц
- [x] **Manual invoice confirmation** — дотоодын сувгийн tenant-ийг идэвхжүүлэх audit-тай зам
- [x] Time-bound access override — дээд тал нь 90 хоног, `expireOverrides()` дуусахад нь хаана
- [ ] Plan publish/archive — plan catalog seed script-ээр удирдагдаж байгаа тул UI үлдсэн
- [x] Critical action confirmation/audit — үйлдэл бүр бичгээр шалтгаан шаардана
- [x] Control Tower навигацид `/platform/billing`

**Exit criteria:** Platform operator payment issue оношилж чадна, гэхдээ tenant operational business data mutation хийхгүй. ✅

**Хэрэгжилтийн үед нэмсэн хамгаалалт:**

- **Картын захиалгыг гараар "төлөгдсөн" болгох боломжгүй.** Зөвхөн `MANUAL_INVOICE` provider-тэй захиалгыг operator баталгаажуулна. Эс тэгвэл гарын үсэгтэй нотолгооны гинжинд хүн эргэж орно.
- **Override үүрд үргэлжлэхгүй.** Дээд тал нь 90 хоног, дуусах огноо нь `accessReason`-д бичигдэж харагдана, `expireOverrides()` хугацаа дуусахад SUSPENDED болгоно.
- **MRR/churn харуулахгүй.** §22-ийн дагуу reconciliation найдвартай болтол орлогын тоо гаргахгүй — тест нь `overview()`-ийн талбаруудыг шалгаж баталгаажуулна.
- **Нэхэмжлэхийн дүнг сервер тооцно.** Operator subtotal + НӨАТ оруулна; total-ыг сервер бодно, DB-ийн CHECK constraint давхар барина.
- **Router-ийн mutating route-ын тоо тестээр түгжигдсэн** — шинэ POST нэмэхэд `platform-hardening.test.ts` анхааруулна.

### Phase 9 — Usage limit ба enforcement 🟡 **ГОЛ ХЭСЭГ ДУУССАН**

**Зорилго:** Plan-ийн project/user/storage/AI limit-ийг бодит хэрэглээтэй холбох.

- [x] Usage source-of-truth — `PrismaTenantUsageReader`
- [x] AI actual/estimated cost separation
- [x] "AI ажиллагаа" ↔ micro-USD хөрвүүлэлт
- [x] Hard-limit operation gates — project, invitation, 4 AI route
- [x] **Concurrent limit reservation** — `tenant-limit-reservation.ts`. Тоолол ба insert нэг transaction дотор, `pg_advisory_xact_lock`-оор tenant+хязгаараар цуваачилна
- [x] Company usage UI
- [x] Usage unknown үед fabricated zero гаргахгүй
- [x] Storage limit gate — upload дээр файлын хэмжээгээр тооцно
- [x] Overage тооцоо (Business) — 100 ажиллагаа тутам 65,000₮, хэрэглээний хариуд харагдана
- [x] Grace/suspension имэйл мэдэгдэл — §26-ийн матрицаар
- [ ] Month boundary/time-zone тест

**Exit criteria:** Concurrent request limit давуулж resource үүсгэхгүй. ✅ Starter (1 төсөл) дээр зэрэг 4 хүсэлт илгээхэд яг 1 нь амжилттай болохыг `smoke:billing:lifecycle` баталсан.

> Хэрэглэгч болон AI-ийн хязгаар нь одоогоор check-then-create хэвээр. Хэрэглэгчийг хүн нэг нэгээр урьдаг, AI-д micro-USD backstop бий тул практик эрсдэл нь төслийнхөөс хамаагүй бага.

### Phase 10 — Hardening ба production release 🟡 **ХЭСЭГЧЛЭН**

**Зорилго:** Payment/security/operational failure-уудыг production түвшинд шалгах.

- [x] Sandbox end-to-end suite — `smoke:billing:lifecycle` (13 шалгалт)
- [x] Webhook replay/tamper suite
- [x] Duplicate/out-of-order event tests
- [x] Renewal failure/grace/suspension тест
- [x] Concurrent reservation тест
- [x] Existing tenant regression — 887 тест, grandfather smoke
- [x] Monitoring — `billing_webhook_*`, `tenant_access_denied_*` metric
- [x] Rollback plan — §31; бүх migration additive
- [x] Cross-tenant billing IDOR suite — `billing-idor.test.ts` + platform-idor өргөтгөсөн
- [ ] Provider outage drill
- [ ] Refund урсгал — LS refund API-тай холбогдоогүй
- [ ] Backup/restore billing reconciliation
- [x] Reconciliation job
- [ ] Runbook шинэчлэлт
- [ ] **Legal copy approval** — хуульчийн хяналт
- [ ] **Provider production credentials/KYC**
- [ ] Staged rollout/feature flag

**Exit criteria:** Production checklist бүрэн, security regression ногоон, live-mode smoke амжилттай — **live-mode хэсэг нь бодит store гарсны дараа**.

### 27.1 Phase дараалал ба зах зээлийн эрсдэл

Техникийн хувьд landing page-ийг Phase 6-д хийх нь зөв — CTA нь бодит checkout-той холбогдох ёстой. Гэхдээ энэ нь **Phase 1–5 (≈3–5 сар) хүртэл нэг ч компанитай үнийн талаар ярихгүй** гэсэн үг. Энэ бол product эрсдэл.

**Зөвлөмж:** Phase 1-ээс эхлэн зэрэгцээ **борлуулалтын шугам** явуулна:

| Долоо хоног | Ажил |
|---|---|
| Phase 1 үед | §5-ийн үнийг 5–8 барилгын компанид танилцуулж, эсэргүүцлийг бүртгэх |
| Phase 3 үед | 3 pilot компанитай LOI (жилийн үнийн 50% хөнгөлөлттэй, жагсаалтын үнийг өөрчлөхгүй) |
| Phase 6 гарахад | Pilot-ууд аль хэдийн онбоордсон, landing дээр бодит case study бэлэн |

Хэрэв анхны 8 ярилцлагаас **үнийн эсэргүүцэл давамгайлбал** §5-ийг Phase 3 дуусахаас өмнө засах цаг байна. Phase 6-д очоод мэдэх нь хэтэрхий оройтдог.

---

## 28. Critical acceptance tests

### Payment integrity

- [ ] Fake checkout success URL tenant идэвхжүүлэхгүй.
- [ ] Invalid webhook signature state өөрчлөхгүй.
- [ ] Duplicate webhook нэг subscription/invoice/provisioning л үүсгэнэ.
- [ ] Out-of-order хуучин event active subscription-ийг expired болгохгүй.
- [ ] Unknown price/product access олгохгүй.
- [ ] `actual amount = 0` зэрэг edge case status mapping-ийг эвдэхгүй.

### Tenant isolation

- [ ] Tenant A Company Admin Tenant B-ийн subscription/invoice ID-г уншихгүй.
- [ ] Tenant A checkout Tenant B intent-ийг complete хийхгүй.
- [ ] Company Admin platform billing API ашиглахгүй.
- [ ] Platform token tenant operational API ашиглахгүй.
- [ ] Client-supplied tenant ID access proof болохгүй.

### Lifecycle

- [ ] Active tenant бүрэн ажиллана.
- [ ] Past due tenant grace banner авна.
- [ ] Grace boundary equality deterministic байна.
- [ ] Suspended tenant шинэ project/user/AI job үүсгэхгүй.
- [ ] Suspended Company Admin billing page руу орно.
- [ ] Renewal paid webhook access сэргээнэ.
- [ ] Cancel-at-period-end paid period дуустал access хадгална.
- [ ] Provider outage existing active tenant-ийг mass suspend хийхгүй.

### Provisioning

- [ ] Confirmed payment нэг tenant л үүсгэнэ.
- [ ] Давхар concurrent webhook duplicate admin үүсгэхгүй.
- [ ] Slug collision deterministic conflict/alternative гаргана.
- [ ] Welcome email fail болсон ч paid subscription алдагдахгүй.
- [ ] Password/token plaintext хадгалагдахгүй.

### Entitlement/limit

- [ ] Plan-д байхгүй feature frontend нуусан эсэхээс үл хамааран API дээр deny болно.
- [ ] Concurrent project/user creation limit давуулахгүй.
- [ ] AI limit unknown/stale үед fabricated zero гаргахгүй.
- [ ] Plan version change existing subscriber-г санамсаргүй өөрчлөхгүй.
- [ ] Starter дээр AI overage хийгдэхгүй; Business дээр overage тооцоологдоно.

### Landing/pricing

- [ ] `/pricing` дээрх хязгаарын тоо `PlanEntitlement`-тай таарна (hard-code илрүүлэх тест).
- [ ] Public plans response provider price ID болон Enterprise дүн задруулахгүй.
- [ ] Marketing route tenant token store болон protected prefetch ачаалахгүй.

### Redaction/audit

- [ ] Card/payment secret response, log, audit metadata-д байхгүй.
- [ ] Manual override бүр actor/reason/expiry/before-after audit-тай.
- [ ] Webhook error public response raw provider payload задруулахгүй.
- [ ] Subscription transition correlation ID-аар мөрдөгдөнө.

---

## 29. Observability

Metrics:

```text
billing_checkout_created_total
billing_checkout_completed_total
billing_webhook_received_total
billing_webhook_invalid_total
billing_webhook_duplicate_total
billing_webhook_failed_total
billing_reconciliation_mismatch_total
subscription_active_total
subscription_past_due_total
subscription_suspended_total
subscription_restored_total
tenant_access_denied_total{reason}
```

Alert:

- Webhook failure/dead-letter нэмэгдэх
- Provider event удаан боловсруулагдах
- Reconciliation mismatch
- Past-due → suspended spike
- Checkout completion rate огцом унах
- Provider sandbox/live configuration холилдох

Metrics label дээр tenant ID, email, invoice ID зэрэг high-cardinality/PII утга хийхгүй.

---

## 30. Deployment strategy

1. Schema/model-ийг feature flag-ийн ард deploy хийх
2. Existing tenant-уудыг grandfathered active болгох
3. Access policy-г shadow mode-д ажиллуулж decision metric цуглуулах
4. Provider sandbox checkout/webhook асаах
5. Internal test tenant дээр enforcement асаах
6. Landing болон pricing public болгох
7. Limited pilot company onboarding
8. Billing support/runbook шалгах
9. New tenant-д paid provisioning mandatory болгох
10. Existing tenant contract-ийг тусдаа migration campaign-аар шилжүүлэх

Existing production tenant-ийг subscription row байхгүй гэж шууд хаахыг хориглоно.

---

## 31. Rollback strategy

Provider эсвэл billing deploy доголдсон үед:

- Checkout creation feature flag-ийг унтраана.
- Existing active tenant access хэвээр үлдэнэ.
- Webhook-ийг inbox-д durable хадгалж processing pause хийнэ.
- Reconciliation зассаны дараа event replay хийнэ.
- Tenant lifecycle-г bulk update хийхгүй.
- Manual override зөвхөн хугацаатай, audit-тай байна.
- Schema migration additive байх ба эхний release дээр destructive column/table drop хийхгүй.

---

## 32. MVP scope

MVP-д заавал:

- Public landing/pricing
- Paid company signup
- Hosted checkout
- Verified/idempotent webhook
- Atomic tenant provisioning
- Canonical subscription/access state
- Company Admin billing page
- Invoice list/provider portal
- Grace/suspension/restore
- Platform subscription monitoring
- Manual invoice суваг (дотоодын хуулийн этгээдэд)
- Cross-tenant/payment security tests

MVP-ээс хасах:

- Олон provider зэрэг production-д ажиллуулах
- Usage-based real-time charging
- Coupon/referral system
- Complex proration UI
- Seat auto-billing
- Bulk tenant billing operation
- Custom tax engine
- Crypto payment
- Marketplace/payment splitting
- Mobile app purchase
- Fake MRR/churn dashboard

---

## 33. Definition of Done

Subscription/landing initiative дараах бүгд биелсэн үед complete:

- [ ] Public visitor product болон plan-ийг authentication-гүй харна.
- [ ] Client amount/price сонгон хуурамчаар checkout хийж чадахгүй.
- [ ] Signed payment event-гүйгээр real tenant provision болохгүй.
- [ ] Paid company initial Company Admin account-аа идэвхжүүлж нэвтэрнэ.
- [ ] Active subscription-ийн entitlement backend дээр мөрдөгдөнө.
- [ ] Unpaid/suspended tenant operational API-г bypass хийхгүй.
- [ ] Suspended Company Admin billing/payment recovery ашиглаж чадна.
- [ ] Existing invitation registration хэвээр ажиллана.
- [ ] Existing tenant болон platform auth boundary эвдрээгүй.
- [ ] Company A Company B-ийн billing/business data-д хүрэхгүй.
- [ ] Duplicate/out-of-order webhook safe байна.
- [ ] Provider outage active tenant-ийг үндэслэлгүй хаахгүй.
- [ ] Card, secret, raw payment payload log/audit/public API-д байхгүй.
- [ ] Platform manual action бүр audit, reason, expiry-тай.
- [ ] Landing дээрх үнэ/хязгаар `PlanEntitlement`-аас ирдэг, hard-code биш.
- [ ] Backend/frontend strict contract болон OpenAPI sync байна.
- [ ] Migration, regression, E2E, live-mode smoke test амжилттай.

---

# ХАВСРАЛТ

## Хавсралт A — Таамаглал ба эрсдэл

| # | Таамаглал / эрсдэл | Нөлөө | Хариу арга |
|---|---|---|---|
| 1 | 1 USD ≈ 3,500₮ | Ханш огцом хөдлөвөл USD price ID-ийн ₮ дүн зөрнө | Ханшийг plan version-оор удирдана; ±10% дээр шинэ version |
| 2 | LLM-ийн зардал $25/төсөл/сар | 2 дахин өсвөл Starter-ийн margin 55% болно | Хэрэглээг эхний 3 tenant дээр хэмжиж, plan v2-т залруулах |
| 3 | Дотоодын худалдан авах чадвар | 390,000₮ өндөр санагдаж болзошгүй | Нэвтрүүлэлтийн багцаар үнэ цэнэ баталгаажуулах; улирлын төлбөр Enterprise-д нээх |
| 4 | Lemon Squeezy-ийн Монголд төлбөр авах нөхцөл | Картын суваг ажиллахгүй бол | Manual invoice суваг MVP-д заавал ажиллаж байх ёстой (§8.1) |
| 5 | Барилгын салбарын борлуулалтын мөчлөг 3–9 сар | Break-even удаашрана | §27.1-ийн зэрэгцээ борлуулалтын шугам |
| 6 | Legal review хийгдээгүй | Terms/Privacy-гүйгээр төлбөр авах боломжгүй | Phase 6 эхлэхээс өмнө хуульчид өгөх |

## Хавсралт B — Эцсийн санал

BuildWatch-д хамгийн тохирох эхний хувилбар:

```text
Provider:             Lemon Squeezy + Manual Invoice
Checkout:             Hosted checkout
Workspace policy:     Confirmed payment-ийн дараа real tenant provision
Pricing:              Starter 390,000₮/сар · Business 1,290,000₮/сар · жил = 10 сар
Pricing unit:         Company base + active projects + included AI usage
Grace:                7 хоног, versioned policy
Suspension:           Billing access үлдээнэ, operational write/AI job хаана
Plan enforcement:     Backend entitlement service
Provider sync:        Signed webhook + local snapshot + reconciliation
Landing deployment:   Одоогийн Vite app дотор lazy public MarketingShell
```

Хэрэгжүүлэх техникийн зөв эхлэл нь landing UI биш. Phase 0 (арилжааны шийдвэр) хаагдсан тул одоо **Phase 1 billing domain**, **Phase 2 access policy**, **Phase 3–5 payment/provisioning**-ийг хийж байж Phase 6 landing CTA-г бодит checkout-той холбоно. Зэрэгцээгээр §27.1-ийн борлуулалтын шугамыг явуулна.

## Хавсралт C — Ашигласан албан ёсны эх сурвалж

- Stripe subscription lifecycle and webhooks: <https://docs.stripe.com/billing/subscriptions/webhooks>
- Stripe entitlements: <https://docs.stripe.com/billing/entitlements>
- Stripe customer portal: <https://docs.stripe.com/customer-management>
- Stripe global availability: <https://stripe.com/global>
- Paddle seller availability: <https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle>
- Paddle supported markets/Merchant of Record: <https://developer.paddle.com/concepts/sell/supported-countries-locales/>

> **Тэмдэглэл:** Stripe-ийн баримтуудыг lifecycle/entitlement/webhook загварын лавлагаа болгон ашигласан; Stripe өөрөө provider биш (§8.1). Lemon Squeezy-ийн webhook signature болон checkout API-ийн албан ёсны баримтыг Phase 3-т нэмнэ.

---

**Холбоотой баримтууд:** `buildwatch.md` (requirement v2.2) · `BUILDWATCH-DIPLOM-SLIDES.md` (танилцуулга) · `SUPER-ADMIN-DASHBOARD.md` (platform monitoring) · `ROLES-UX.md` (дүр, эрх)
