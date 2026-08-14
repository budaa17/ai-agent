# BuildWatch Landing Page, Subscription & Paid Tenant Roadmap

**Баримт бичгийн төрөл:** Implementation roadmap  
**Төлөв:** Proposed  
**Огноо:** 2026-08-11  
**Хамаарах систем:** `agent-console`, `agents`, PostgreSQL, tenant authentication, Platform Control Tower

---

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

## 3. Шийдвэрлэх ёстой үндсэн зарчмууд

### 3.1 Authentication ба paid access тусдаа байна

Login дараах хоёр асуултыг тусад нь шийднэ:

1. Энэ хэрэглэгч хэн бэ?
2. Энэ tenant одоо ямар feature ашиглах эрхтэй вэ?

`RequireAuth` зөвхөн identity/session шалгана. Шинэ `RequireTenantAccess` болон backend `TenantAccessPolicy` нь subscription/lifecycle шалгана.

Subscription status-ийг JWT-д урт хугацаагаар хадахгүй. Subscription webhook-оор хэдийд ч өөрчлөгдөж болох тул backend-ийн authoritative access snapshot-ийг request бүрт эсвэл богино TTL cache-аар шалгана.

### 3.2 Payment provider бол access-ийн цорын ганц model биш

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

### 3.3 Checkout success page төлбөрийн баталгаа биш

Browser redirect, query parameter, provider success URL болон frontend state-ээр tenant идэвхжүүлэхгүй.

Зөвхөн:

- webhook signature амжилттай шалгагдсан;
- event ID өмнө нь боловсруулагдаагүй;
- provider price/product серверийн allowlist-тэй таарсан;
- төлбөрийн canonical төлөв access олгох нөхцөл хангасан;

тохиолдолд provisioning хийнэ.

### 3.4 Төлбөрийн доголдлоор data устгахгүй

Subscription дууссан үед:

- Tenant/project data-г hard delete хийхгүй.
- Шинэ operational mutation болон шинэ AI job-ийг хаана.
- Company Admin-д billing болон шаардлагатай export access үлдээнэ.
- Retention хугацаа дууссаны дараах archive/delete нь тусдаа policy байна.

### 3.5 Provider outage бүх tenant-ийг хаах шалтгаан биш

Request бүр payment provider руу synchronous API call хийхгүй. Verified webhook-оос дотоод access snapshot үүсгэнэ. Provider түр unavailable болсон үед сүүлчийн баталгаажсан access хугацаагаар үйлчилнэ.

---

## 4. Product болон pricing strategy

### 4.1 Зөвлөж буй pricing unit

BuildWatch-д цэвэр per-user pricing тохиромжгүй. Талбайн инженер болон хяналтын ажилтан бүрийг нэмэх тусам үнэ өсвөл компани бодит хэрэглэгчдээ системд оруулахгүй байх эрсдэлтэй.

Зөвлөж буй загвар:

```text
Company base fee
+ active project allowance
+ included users
+ included AI usage
+ optional AI/storage add-on
```

### 4.2 Plan-ийн эхний бүтэц

| Plan | Зориулалт | Гол ялгаа |
|---|---|---|
| Starter | Жижиг компани, анхны төсөл | Цөөн active project, basic agents, standard retention |
| Business | Олон project-тэй компани | Илүү их project/user/AI, advanced reports, өргөтгөсөн audit |
| Enterprise | Том байгууллага | Custom limits, SLA, SSO, invoice contract, priority support |

Үнийн дүнг source code-д hard-code хийхгүй. Provider price ID болон internal plan version-оор удирдана.

### 4.3 Entitlement-ийн эхний каталог

```text
PROJECT_ACTIVE_MAX
USER_ACTIVE_MAX
STORAGE_BYTES_MAX
AI_MONTHLY_MICRO_USD_MAX
AI_OVERAGE_ALLOWED
AGENT_DAILY_REPORT
AGENT_PROGRESS_VERIFICATION
AGENT_BOQ_ANALYSIS
ADVANCED_REPORTS
AUDIT_RETENTION_DAYS
API_ACCESS
PRIORITY_SUPPORT
```

Limit-д хүрсэн үед бүх tenant-ийг хаахгүй. Тухайн operation дээр ойлгомжтой domain error буцаана:

- `PROJECT_LIMIT_REACHED`
- `USER_LIMIT_REACHED`
- `AI_USAGE_LIMIT_REACHED`
- `STORAGE_LIMIT_REACHED`
- `FEATURE_NOT_INCLUDED`

### 4.4 Paid-only болон demo

Real company workspace зөвхөн төлбөрийн дараа provision хийнэ. Борлуулалтын demo хэрэгтэй бол production tenant биш, тогтмол sample data-тай тусдаа public demo ашиглана.

Enterprise trial шаардлагатай бол Platform Admin тусгай хугацаатай `TRIAL` entitlement үүсгэнэ. Trial бүр:

- эхлэх/дуусах хугацаа;
- олгосон principal;
- reason;
- entitlement snapshot;
- audit log;

хадгална.

---

## 5. Payment provider strategy

### 5.1 MVP сонголт

Монголд бүртгэлтэй BuildWatch SaaS-ийн эхний хувилбарт:

1. `LEMON_SQUEEZY` hosted checkout
2. `MANUAL_INVOICE` буюу байгууллагын гэрээ/банк шилжүүлэг

гэсэн хоёр channel санал болгоно.

Lemon Squeezy-ийн албан ёсны supported-country жагсаалтад Монгол bank payout дэмждэг гэж орсон. Paddle нь software business-д зориулсан Merchant of Record хувилбар бөгөөд seller onboarding/KYC-г тусад нь баталгаажуулсны дараа хоёр дахь provider болж болно. Stripe-ийн business availability жагсаалтад Монгол одоогоор байхгүй тул supported-country legal entity үүсээгүй нөхцөлд үндсэн төлөвлөгөө болгохгүй.

### 5.2 Provider abstraction

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

## 6. Domain model

### 6.1 Canonical enums

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

### 6.2 Tenant model-ийн өөрчлөлт

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

### 6.3 Plan болон version

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

  @@unique([code, version])
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

### 6.4 Subscription

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

### 6.5 Signup intent

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
  status            String
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

### 6.6 Entitlement snapshot

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

### 6.7 Webhook inbox болон invoice

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

## 7. Tenant access policy

### 7.1 Access matrix

| Tenant lifecycle | Login | Billing | Read business data | Write business data | New AI jobs |
|---|---:|---:|---:|---:|---:|
| `PENDING_PAYMENT` | Company Admin only | Тийм | Үгүй | Үгүй | Үгүй |
| `ACTIVE` | Тийм | Company Admin | Тийм | Entitlement-аар | Entitlement/quota-аар |
| `PAYMENT_GRACE` | Тийм | Company Admin | Тийм | Тийм, warning-тай | Policy-оор хязгаарлаж болно |
| `SUSPENDED` | Тийм | Company Admin | Limited/read-only | Үгүй | Үгүй |
| `ARCHIVED` | Үгүй эсвэл support flow | Үгүй | Үгүй | Үгүй | Үгүй |

### 7.2 Backend enforcement

Шинэ service:

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

### 7.3 Route allowlist

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

Бусад endpoint `TENANT_SUBSCRIPTION_REQUIRED` эсвэл `TENANT_ACCESS_SUSPENDED` domain error буцаана.

### 7.4 Grace policy

MVP default:

- `PAST_DUE` эхэлснээс хойш 7 хоногийн grace.
- Grace үед Company Admin бүх дэлгэц дээр persistent warning харна.
- Renewal амжилттай бол `ACTIVE` руу автоматаар буцна.
- Grace дуусвал `SUSPENDED` болно.
- Provider webhook ирээгүй/саатсан үед confirmed paid period дуусаагүй бол access-ийг хаахгүй.
- Manual invoice-д due date болон Platform Operator approval policy хэрэглэнэ.

Grace хугацаа versioned policy байна; UI-д hard-code хийхгүй.

---

## 8. Checkout ба provisioning flow

### 8.1 Public company signup

`POST /public/v1/company-signups`:

1. Company name, desired slug, admin name/email, plan code хүлээн авна.
2. Input-ийг strict parse хийнэ.
3. Plan public/active/version зөв эсэхийг сервер шалгана.
4. Email verification challenge үүсгэнэ.
5. `CompanySignupIntent` үүсгэнэ.
6. Rate limit болон abuse prevention хэрэглэнэ.

Existing invitation `/register` урсгалыг өөрчлөхгүй. Company signup болон invited-user registration хоёр тусдаа route байна.

### 8.2 Checkout creation

`POST /public/v1/company-signups/:id/checkout`:

- Signup intent verified бөгөөд expire болоогүй эсэхийг шалгана.
- Frontend-ээс amount, currency, provider price ID авахгүй.
- Internal plan version-оос server allowlist price ID сонгоно.
- Provider checkout metadata-д зөвхөн opaque `signupIntentId` болон correlation ID өгнө.
- Нэг intent дээр давтан дарахад existing valid checkout URL буцаах idempotency хэрэглэнэ.

### 8.3 Webhook processing

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

### 8.4 Atomic provisioning

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

### 8.5 Success page

`/checkout/success?checkout=opaque-id` page:

- “Payment received” гэж шууд зарлахгүй.
- Backend confirmation status poll хийнэ.
- Төлөв: `CONFIRMING`, `ACTIVE`, `FAILED`, `EXPIRED`.
- `ACTIVE` бол “Email-ээ шалгаж account-аа идэвхжүүлнэ үү” гэж харуулна.
- Poll bounded backoff ашиглаж, user refresh хийсэн ч ажиллана.

---

## 9. Landing page information architecture

### 9.1 Public routes

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

### 9.2 Frontend shell

Шинэ `MarketingShell`:

- Public header
- Product navigation
- Language selector бэлдэх боломж
- Login CTA
- Plan CTA
- Footer/legal links

Marketing route нь tenant `AppShell`, platform `PlatformShell`, token store болон protected API prefetch-ийг ачаалахгүй.

Одоогийн Vite app дотор route-level lazy chunks ашиглан эхэлнэ. SEO болон content marketing өссөний дараа л тусдаа SSR marketing app авч үзнэ; MVP-д хоёр frontend deployment үүсгэх шаардлагагүй.

### 9.3 Landing page section

1. **Hero** — BuildWatch-ийн нэг өгүүлбэрийн value proposition
2. **Pain** — төлөвлөгөө, талбайн тайлан, гүйцэтгэл, эрсдэлийн тасархай байдлыг тайлбарлах
3. **How it works** — Plan → Capture → Verify → Decide
4. **Role outcomes** — Company Admin, Project Manager, Engineer, Reviewer
5. **AI agents** — яг юу хийдэг, хүн ямар шийдвэр гаргадаг
6. **Trust** — tenant isolation, audit, approval boundary, data handling
7. **Feature comparison** — бодит entitlement-тэй таарсан plan table
8. **Pricing** — monthly/yearly сонголт, tax/contract тайлбар
9. **FAQ** — payment, cancellation, data ownership, onboarding
10. **CTA** — Plan сонгох / Enterprise demo хүсэх

### 9.4 Copy зарчим

- Нотлогдоогүй customer logo ашиглахгүй.
- Fake usage count, fake review, fake uptime харуулахгүй.
- “AI бүгдийг автоматаар зөв шийднэ” гэж амлахгүй.
- Human review, auditability, tenant isolation-ийг бодитоор тайлбарлана.
- Plan card дээр hidden fee гаргахгүй.
- AI allowance, overage, storage, cancel нөхцөлийг ойлгомжтой бичнэ.

### 9.5 Responsive/accessibility

- Mobile-first navigation
- Keyboard ашиглах боломжтой menu/dialog
- Visible focus state
- WCAG AA contrast зорилт
- Form label/error холбоос
- `prefers-reduced-motion`
- Pricing data-г зөвхөн өнгөөр ялгахгүй
- Checkout CTA pending үед давхар submit хаах

---

## 10. Company Admin billing experience

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
- Limit болон overage policy
- Invoice history
- Hosted invoice link
- “Manage subscription/payment” provider portal button
- Cancel-at-period-end төлөв

Permission:

```text
TENANT_BILLING_READ
TENANT_BILLING_MANAGE
```

MVP-д `COMPANY_ADMIN` эдгээр permission-ийг авна. Project role payment method өөрчлөхгүй.

Billing page subscription хаалттай үед ч ажиллах ёстой тул ердийн workspace access guard-ийн дотор биш, `RequireAuth + RequireBillingPermission` доор байна.

---

## 11. Platform Super Admin billing experience

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

## 12. API contract

### 12.1 Public API

```text
GET  /public/v1/plans
POST /public/v1/company-signups
POST /public/v1/company-signups/:id/verify-email
POST /public/v1/company-signups/:id/checkout
GET  /public/v1/company-signups/:id/status
POST /webhooks/billing/:provider
```

### 12.2 Tenant billing API

```text
GET  /v1/billing/subscription
GET  /v1/billing/entitlements
GET  /v1/billing/usage
GET  /v1/billing/invoices
POST /v1/billing/portal
POST /v1/billing/change-plan       # MVP дараа байж болно
POST /v1/billing/cancel
```

### 12.3 Platform billing API

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

## 13. Security requirements

### 13.1 Webhook

- Raw request body дээр signature verify хийх
- Timestamp tolerance шалгах
- Provider secret зөвхөн backend environment-д хадгалах
- Signature fail бол generic `400/401`
- Provider event ID unique/idempotent байх
- Unknown product/price access олгохгүй
- Event processing retry bounded байх
- Raw secret, signature, payment payload log-д оруулахгүй

### 13.2 Checkout

- Amount/currency/price-ийг client-ээс итгэхгүй
- `signupIntentId` таах боломжгүй байх
- Email болон slug enumeration-ийг generic response-оор багасгах
- Signup/checkout rate limit
- Return URL allowlist
- Open redirect хориглох
- Checkout creation idempotency

### 13.3 Tenant isolation

- Billing query бүр tenant context-ийг verified token-оос авна
- Client-ийн `tenantId` access proof биш
- Company Admin өөр tenant-ийн invoice/subscription ID-г ашиглаж чадахгүй
- Platform billing endpoint tenant bearer хүлээн авахгүй
- Platform token tenant mutation endpoint-д ажиллахгүй хэвээр байна

### 13.4 Sensitive data

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

### 13.5 Audit

Audit action:

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

## 14. Background jobs

Шаардлагатай worker/job:

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

## 15. Notification policy

| Event | Company Admin | Platform Operator |
|---|---:|---:|
| Payment successful | Тийм | Үгүй |
| Trial/payment period ending | Тийм | Үгүй |
| Payment failed | Тийм | Aggregate/critical үед |
| Grace started | Тийм | Тийм |
| Grace ending soon | Тийм | Тийм |
| Tenant suspended | Тийм | Тийм |
| Subscription restored | Тийм | Үгүй |
| Webhook dead-letter | Үгүй | Тийм |

Email notification өөрөө access state-ийн эх үүсвэр биш. Notification fail болсон ч subscription transition алдагдахгүй.

---

## 16. Implementation phases

### Phase 0 — Product decisions freeze

**Зорилго:** Код эхлэхээс өмнө өөрчлөгдвөл их дахин ажил үүсгэх шийдвэрүүдийг батлах.

- [ ] MVP provider: Lemon Squeezy эсвэл өөр provider батлах
- [ ] Manual invoice дэмжих эсэх
- [ ] Monthly/yearly interval
- [ ] Starter/Business/Enterprise entitlement matrix
- [ ] Валют болон tax display
- [ ] 7 хоногийн grace policy
- [ ] Cancel-at-period-end policy
- [ ] Refund/access policy
- [ ] Data retention/archive policy
- [ ] Enterprise trial policy
- [ ] Terms, Privacy, Subscription/Cancellation нөхцөлийн legal review

**Exit criteria:** Нэг versioned plan catalog болон access-state table батлагдсан байна.

### Phase 1 — Billing domain ба migration

**Зорилго:** Provider-оос үл хамаарах canonical billing model бий болгох.

- [ ] Enums нэмэх
- [ ] `Tenant.lifecycleStatus` нэмэх
- [ ] `BillingPlan`, `PlanEntitlement`
- [ ] `BillingProviderPrice`
- [ ] `BillingCustomer`, `TenantSubscription`
- [ ] `TenantEntitlementSnapshot`
- [ ] `CompanySignupIntent`
- [ ] `BillingWebhookEvent`, `BillingInvoice`
- [ ] Constraint/index/custom SQL migration
- [ ] Existing tenant grandfather/backfill migration
- [ ] Billing audit event contract
- [ ] Prisma validation/generate

**Exit criteria:** Existing tenant-ууд хаагдаагүй, plan/subscription fixture strict contract-аар үүсдэг байна.

### Phase 2 — Tenant access policy

**Зорилго:** Subscription төлөвөөс хамаарсан backend authorization boundary бий болгох.

- [ ] `TenantAccessPolicy` service
- [ ] Canonical access decision contract
- [ ] Billing-only endpoint allowlist
- [ ] Workspace read/write gate
- [ ] Feature entitlement gate
- [ ] Project/user/storage/AI limit gate
- [ ] Worker болон agent-job gate
- [ ] Stable domain error codes
- [ ] Access decision audit/metrics

**Exit criteria:** Suspended tenant client-side bypass хийсэн ч operational mutation болон шинэ AI job эхлүүлж чадахгүй.

### Phase 3 — Billing provider adapter

**Зорилго:** Hosted checkout болон customer portal-ийг provider-neutral service-ээр ажиллуулах.

- [ ] `BillingProvider` interface
- [ ] Provider sandbox account/KYC readiness
- [ ] Product/price mapping
- [ ] Lemon Squeezy adapter
- [ ] Checkout idempotency
- [ ] Portal session
- [ ] Environment/config validation
- [ ] Secret scanning/log redaction
- [ ] Provider contract tests

**Exit criteria:** Sandbox hosted checkout server-selected plan/price-аар нээгдэнэ; card data BuildWatch-д дамжихгүй.

### Phase 4 — Webhook inbox ба subscription state machine

**Зорилго:** Payment result-ийг баталгаатай, duplicate-safe байдлаар дотоод state болгох.

- [ ] Raw body signature verification
- [ ] Webhook inbox insert
- [ ] Duplicate event replay
- [ ] Out-of-order хамгаалалт
- [ ] Subscription transition state machine
- [ ] Invoice projection
- [ ] Entitlement snapshot refresh
- [ ] Tenant lifecycle transition
- [ ] Retry/dead-letter
- [ ] Reconciliation command/job
- [ ] Sanitized diagnostics

**Exit criteria:** Browser success URL activation хийдэггүй; зөв signed webhook л paid access олгодог байна.

### Phase 5 — Company signup ба atomic provisioning

**Зорилго:** Public visitor-оос paid tenant хүртэл orphan/duplicate үүсгэхгүй урсгал бий болгох.

- [ ] Company signup request schema/API
- [ ] Email verification
- [ ] Desired slug reservation/conflict handling
- [ ] Plan selection
- [ ] Checkout creation
- [ ] Status polling endpoint
- [ ] Atomic tenant/subscription/admin provisioning
- [ ] Password setup token
- [ ] Welcome/invite outbox
- [ ] Abandoned/expired signup cleanup

**Exit criteria:** Нэг confirmed payment яг нэг tenant, нэг subscription, нэг initial Company Admin үүсгэнэ.

### Phase 6 — Public landing page

**Зорилго:** Product-ийг тайлбарлаж, plan сонгуулж, signup/checkout руу найдвартай шилжүүлэх.

- [ ] `MarketingShell`
- [ ] `/` landing page
- [ ] `/features`
- [ ] `/pricing`
- [ ] `/security`
- [ ] `/contact`
- [ ] `/company-signup`
- [ ] `/checkout/success`
- [ ] Terms/privacy routes
- [ ] Public plan API integration
- [ ] Route-level lazy loading
- [ ] Responsive/accessibility
- [ ] SEO metadata, OpenGraph, sitemap/robots deployment strategy
- [ ] Analytics consent policy батлагдсан үед privacy-safe funnel events

**Exit criteria:** Visitor landing → plan → verified signup → hosted checkout → confirming page хүртэл явна.

### Phase 7 — Company Admin billing UI

**Зорилго:** Company Admin өөрийн plan, invoice, usage, payment recovery-г удирдах.

- [ ] `TENANT_BILLING_READ/MANAGE`
- [ ] `/admin/billing`
- [ ] Subscription/access status
- [ ] Usage/limit cards
- [ ] Invoice history
- [ ] Provider portal
- [ ] Cancel-at-period-end
- [ ] Grace/suspension banners
- [ ] Billing-only shell state
- [ ] Optimistic/network error UX

**Exit criteria:** Suspended Company Admin login хийгээд төлбөрөө сэргээж чадна; project mutation ашиглаж чадахгүй.

### Phase 8 — Platform billing control

**Зорилго:** Platform team subscription health болон manual contract-ийг audit-тай удирдах.

- [ ] Platform billing permissions
- [ ] Billing overview/read model
- [ ] Subscription list/detail
- [ ] Past-due/grace/suspended queues
- [ ] Webhook health/dead-letter
- [ ] Manual invoice confirmation
- [ ] Time-bound access override
- [ ] Plan publish/archive
- [ ] Critical action confirmation/idempotency/audit
- [ ] Control Tower billing attention integration

**Exit criteria:** Platform operator payment issue оношилж чадна, гэхдээ tenant operational business data mutation хийхгүй.

### Phase 9 — Usage limit ба enforcement

**Зорилго:** Plan-ийн project/user/storage/AI limit-ийг бодит хэрэглээтэй холбох.

- [ ] Usage source-of-truth тогтоох
- [ ] AI actual/estimated cost separation
- [ ] Usage snapshot/reconciliation
- [ ] Soft warning thresholds
- [ ] Hard-limit operation gates
- [ ] Concurrent limit reservation
- [ ] Overage policy
- [ ] Company/Platform usage UI
- [ ] Month boundary/time-zone tests

**Exit criteria:** Concurrent request limit давуулж resource үүсгэхгүй; usage unknown үед data-г zero гэж үзэхгүй.

### Phase 10 — Hardening ба production release

**Зорилго:** Payment/security/operational failure-уудыг production түвшинд шалгах.

- [ ] Sandbox end-to-end suite
- [ ] Webhook replay/tamper suite
- [ ] Cross-tenant billing IDOR suite
- [ ] Provider outage drill
- [ ] Duplicate/out-of-order event tests
- [ ] Renewal failure/grace/suspension/restore tests
- [ ] Cancel/refund tests
- [ ] Existing tenant regression
- [ ] Backup/restore billing reconciliation
- [ ] Monitoring/alerts/runbook
- [ ] Legal copy approval
- [ ] Provider production credentials/KYC
- [ ] Staged rollout/feature flag
- [ ] Rollback plan

**Exit criteria:** Production checklist бүрэн, security regression ногоон, provider webhook/checkout live-mode smoke амжилттай байна.

---

## 17. Critical acceptance tests

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

### Redaction/audit

- [ ] Card/payment secret response, log, audit metadata-д байхгүй.
- [ ] Manual override бүр actor/reason/expiry/before-after audit-тай.
- [ ] Webhook error public response raw provider payload задруулахгүй.
- [ ] Subscription transition correlation ID-аар мөрдөгдөнө.

---

## 18. Observability

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

## 19. Deployment strategy

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

## 20. Rollback strategy

Provider эсвэл billing deploy доголдсон үед:

- Checkout creation feature flag-ийг унтраана.
- Existing active tenant access хэвээр үлдэнэ.
- Webhook-ийг inbox-д durable хадгалж processing pause хийнэ.
- Reconciliation зассаны дараа event replay хийнэ.
- Tenant lifecycle-г bulk update хийхгүй.
- Manual override зөвхөн хугацаатай, audit-тай байна.
- Schema migration additive байх ба эхний release дээр destructive column/table drop хийхгүй.

---

## 21. MVP scope

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

## 22. Definition of Done

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
- [ ] Backend/frontend strict contract болон OpenAPI sync байна.
- [ ] Migration, regression, E2E, live-mode smoke test амжилттай.

---

## 23. Эцсийн санал

BuildWatch-д хамгийн тохирох эхний хувилбар:

```text
Provider:             Lemon Squeezy + Manual Invoice
Checkout:             Hosted checkout
Workspace policy:     Confirmed payment-ийн дараа real tenant provision
Pricing:              Company base + active projects + included AI usage
Grace:                7 хоног, versioned policy
Suspension:           Billing access үлдээнэ, operational write/AI job хаана
Plan enforcement:     Backend entitlement service
Provider sync:        Signed webhook + local snapshot + reconciliation
Landing deployment:   Одоогийн Vite app дотор lazy public MarketingShell
```

Хэрэгжүүлэх техникийн зөв эхлэл нь landing UI биш. Эхлээд **Phase 0 product decisions**, дараа нь **Phase 1 billing domain**, **Phase 2 access policy**, **Phase 3–5 payment/provisioning**-ийг хийж байж Phase 6 landing CTA-г бодит checkout-той холбоно.

---

## 24. Ашигласан албан ёсны эх сурвалж

- Stripe subscription lifecycle and webhooks: <https://docs.stripe.com/billing/subscriptions/webhooks>
- Stripe entitlements: <https://docs.stripe.com/billing/entitlements>
- Stripe customer portal: <https://docs.stripe.com/customer-management>
- Stripe global availability: <https://stripe.com/global>
- Paddle seller availability: <https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle>
- Paddle supported markets/Merchant of Record: <https://developer.paddle.com/concepts/sell/supported-countries-locales/>
- Paddle completed transaction webhook: <https://developer.paddle.com/webhooks/transactions/transaction-completed/>
- Lemon Squeezy supported countries: <https://docs.lemonsqueezy.com/help/getting-started/supported-countries>
