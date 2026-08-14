# BuildWatch Subscription Payment System — Production хэрэгжүүлэлтийн баримт

**Огноо:** 2026-08-13  
**Төлөв:** Implementation-ready roadmap  
**Хамрах хүрээ:** Landing page → plan сонголт → email verification → checkout/нэхэмжлэх → webhook/баталгаажуулалт → tenant activation → renewal/dunning/suspension → Company Admin ба Platform Super Admin хяналт

> [!IMPORTANT]
> Энэ баримт нь одоогийн эх кодыг дахин шинээр бичих төлөвлөгөө биш. Billing domain, plan catalog,
> provider adapter, access policy, tenant/platform billing UI-ийн суурь аль хэдийн байна. Гэхдээ
> customer onboarding болон payment integrity-д production launch-ийг хаах алдаа үлдсэн.
> Иймээс `HANDOVER-BILLING.md` доторх “код бүрэн дууссан” гэсэн дүгнэлтийг энэ баримт
> **орлоно**.

---

## 1. Эцсийн шийдвэр

BuildWatch-ийн эхний production billing дараах бүтэцтэй байна.

| Хэсэг | Шийдвэр |
|---|---|
| Self-service card payment | **Lemon Squeezy hosted checkout** |
| Дотоодын байгууллагын шилжүүлэг | **Manual invoice**, гэхдээ P0 урсгал бүрэн болсны дараа sales-assisted байдлаар нээнэ |
| Public self-service багц | Starter, Business |
| Enterprise | Гэрээт үнэ, sales-assisted; public checkout байхгүй |
| Public free trial | Эхний хувилбарт байхгүй |
| Үнэ тогтоох үндсэн нэгж | Active project; хэрэглэгчийн тоогоор дангаар үнэ тогтоохгүй |
| Plan interval | MONTH эсвэл YEAR |
| Жилийн үнэ | 10 сарын төлбөртэй тэнцүү буюу 2 сар хэмнэлттэй |
| Access эх сурвалж | Browser redirect биш, зөвхөн баталгаажсан provider event эсвэл audited manual payment |
| Card data | BuildWatch серверээр огт дамжихгүй |
| Provider outage | Одоо ACTIVE байгаа бүх tenant-ийг бөөнөөр нь хаахгүй; local persisted state ашиглана |

### 1.1 Эхний launch-д юу нээх вэ?

1. Starter/Business картын self-service checkout-ыг эхэлж production болгоно.
2. Manual invoice flow бүрэн хэрэгжиж, accountant/legal review дууссаны дараа “Банкны шилжүүлэг” сонголтыг нээнэ.
3. Enterprise-г `/contact` урсгалаар үлдээнэ.
4. Upgrade/downgrade, refund automation, overage billing-ийг үндсэн төлбөрийн lifecycle тогтвортой болсны дараа нээнэ.

### 1.2 Яагаад Lemon Squeezy вэ?

- Hosted checkout тул BuildWatch card number/CVC хадгалахгүй.
- Lemon Squeezy-ийн албан ёсны жагсаалтад Mongolia merchant payout дэмжлэгтэй.
- MNT нь supported selling currency боловч provider төлбөрийг USD equivalent-ээр боловсруулж, payout-ыг USD-аар хийдэг. Валютын тайлбарыг checkout болон invoice дээр үнэн зөв харуулах шаардлагатай.
- Lemon Squeezy нь Merchant of Record тул өөрийн сувгийн sales tax/VAT, refund, chargeback болон PCI үүргийг хариуцдаг. Харин Монголын manual invoice/eBarimt нь тусдаа local accounting flow байна.
- Stripe-ийн шууд payment account availability жагсаалтад Mongolia одоогоор байхгүй. Гадаад legal entity баталгаажаагүй нөхцөлд Stripe-ийг анхны provider болгохгүй.

> Provider сонголт кодоос гадна KYC, prohibited-product review, payout account approval-аас хамаарна.
> Live launch-аас өмнө Lemon Squeezy store бодитоор approved болсон байх ёстой.

---

## 2. Багц ба үнэ

Одоогийн баталсан public catalog:

| Багц | Сар | Жил | Public checkout |
|---|---:|---:|---|
| Starter | 390,000₮ | 3,900,000₮ | Тийм |
| Business | 1,290,000₮ | 12,900,000₮ | Тийм |
| Enterprise | Гэрээт | Гэрээт | Үгүй |

Дүрэм:

- Frontend дээр үнэ hard-code хийхгүй. `GET /public/v1/plans`-оос авна.
- Browser зөвхөн `planCode`, `interval`, `paymentChannel` сонгоно; `amount`, `currency`, `providerPriceId` илгээж эрх мэдэлтэй утга болгохгүй.
- Backend active/public plan-ийн яг тохирох `BillingProviderPrice`-ийг resolve хийнэ.
- Plan version immutable байна. Үнэ эсвэл entitlement солигдвол шинэ version үүсгэнэ; хуучин subscriber-ийн contract-ийг чимээгүй өөрчлөхгүй.
- Enterprise үнэ, дотоод provider ID, unpublished plan public API-аар гарахгүй.
- Overage автомат collection бүрэн болоогүй үед “автоматаар нэмэлт төлбөр авна” гэж UI/гэрээнд амлахгүй.

### 2.1 VAT ба invoice-ийн дүрэм

Card болон manual сувгийг нэг татварын дүрмээр хүчээр холбож болохгүй.

| Суваг | Invoice/tax source of truth |
|---|---|
| Lemon Squeezy | Provider-ийн checkout, receipt, invoice, tax calculation |
| Manual invoice | Монголын НӨАТ/eBarimt болон нягтлан бодох бүртгэлийн баталсан дүрэм |

- Public page дээр “НӨАТ ороогүй/орсон” тайлбар provider-ийн бодит тохиргоотой таарсан байна.
- Lemon Squeezy дээр tax-inclusive эсвэл tax-exclusive аль нэгийг хуульч/нягтлантай батлаад бүх variant-д ижил хэрэглэнэ.
- Manual invoice-д 10% гэж шууд hard-code хийхгүй. `vatPayer`, customer registration number, legal name, tax treatment-ийг immutable quote үүсгэх мөчид хадгална.
- eBarimt integration байхгүй үед “НӨАТ-ын падаан автоматаар олгоно” гэж public UI дээр амлахгүй; operator workflow гэдгийг тодорхой бичнэ.

---

## 3. Одоогийн хэрэгжилтийн үнэн зөв төлөв

### 3.1 Бэлэн байгаа суурь

| Domain | Төлөв | Гол файл |
|---|---|---|
| Billing schema, enum, constraint, indexes | Бэлэн | `agents/prisma/schema.prisma` |
| Starter/Business/Enterprise catalog | Бэлэн | `agents/src/backend/billing-contracts.ts` |
| Public plan API | Бэлэн | `agents/src/backend/billing-public-catalog.ts` |
| Server-side provider price resolver | Бэлэн | `agents/src/backend/billing-price-resolver.ts` |
| Lemon Squeezy hosted checkout adapter | Суурь бэлэн | `agents/src/backend/billing-provider-lemon-squeezy.ts` |
| Raw-body HMAC webhook verification | Бэлэн | `agents/src/backend/billing-webhook-service.ts` |
| Signup intent, email verification | Суурь бэлэн | `agents/src/backend/billing-signup-service.ts` |
| Tenant subscription/access lifecycle | Суурь бэлэн | `agents/src/backend/tenant-access-policy.ts` |
| Billing recovery route allowlist | Бэлэн | `agents/src/backend/tenant-access-routes.ts` |
| Company Admin billing page | Суурь бэлэн | `agent-console/src/pages/billing-page.tsx` |
| Platform billing oversight | Суурь бэлэн | `agent-console/src/pages/platform/billing-page.tsx` |
| Reconciliation/maintenance script | Суурь бэлэн | `agents/src/scripts/billing-maintenance.ts` |
| PostgreSQL billing smoke | Бэлэн | `agents/src/scripts/smoke-billing-*.ts` |

### 3.2 Production launch-ийг хааж байгаа P0 асуудлууд

1. **Paid Company Admin password тохируулж чадахгүй.** Backend `/register?setup=...` линк явуулдаг боловч frontend зөвхөн invitation `?token=` урсгал ойлгодог; `PASSWORD_RESET` setup token consume хийх endpoint байхгүй.
2. **Email verification deep link resume ажиллахгүй.** Email дотор `signup` ба `token` ирдэг ч signup page тэдгээрийг уншиж auto-verify хийдэггүй.
3. **Checkout success correlation тасарсан.** Success page `signup`/`checkout` query шаарддаг, харин provider руу static `/checkout/success` URL өгч байна.
4. **Төлбөр батлагдаагүй event ACTIVE tenant үүсгэх эрсдэлтэй.** Provisioning нь subscription status-аас үл хамааран tenant lifecycle-ийг `ACTIVE` гэж hard-code хийсэн.
5. **Provisioning transaction бүрэн atomic биш.** Signup intent эхлээд `COMPLETED` болж, дараа нь tenant transaction эхэлдэг. Transaction унавал төлсөн хэрэглэгч tenant-гүй, retry хийх боломжгүй үлдэнэ.
6. **Failed webhook recover хийх worker байхгүй.** Inbox зөвхөн payload hash хадгалдаг. `FAILED` эсвэл crash болсон `PROCESSING` event retry хийх raw/normalized өгөгдөлгүй; redelivery нь duplicate болоод зогсоно.
7. **Webhook acknowledgment contract зөрүүтэй.** Одоогийн route `202` буцаадаг; Lemon Squeezy successful acknowledgment-д `200` хүлээдэг.
8. **Manual invoice шинэ signup бүтэн ажиллахгүй.** Instructions гардаг ч tenant/subscription/invoice үүсэхгүй; Platform Admin existing subscription-гүй төлбөр батлах боломжгүй.
9. **Paid tenant entitlement алдагдвал unlimited болж магадгүй.** `null` snapshot нь grandfathered tenant-тэй адил утгаар уншигдаж байна. Corrupt/missing paid snapshot fail-closed байх ёстой.
10. **Grace expiry DB-д persist болохгүй.** Request үед write/AI хориглодог ч tenant `PAYMENT_GRACE` хэвээр үлдэж, audit/notification баталгаатай үүсэхгүй.
11. **Existing/PENDING_PAYMENT tenant багц худалдаж авах замгүй.** Public pricing CTA дандаа шинэ company signup үүсгэдэг; authenticated first-purchase/change-plan endpoint байхгүй.
12. **Amount/event binding дутуу.** Event-ийн store, environment, exact intent/checkout, product, price, currency, amount болон paid state бүгдийг нэг мөр баталгаажуулах шаардлагатай.

### 3.3 Одоогийн test truth

- Targeted billing suite аудит хийх үед **99/100** test passed.
- Нэг failure нь `billing-domain.test.ts` дотор Prisma schema-ийн whitespace alignment-ийг exact string-ээр шалгасан brittle test; functional schema failure биш.
- PostgreSQL domain болон lifecycle smoke JSON-ууд `passed: true` боловч дээрх frontend handoff, webhook recovery, manual signup, setup-token урсгалыг бүрэн шалгадаггүй.
- Иймээс одоогийн төлөвийг “billing foundation strong, customer onboarding production-ready биш” гэж үзнэ.

---

## 4. Зорилтот архитектур

```text
Landing / Pricing
       │ planCode + interval + paymentChannel
       ▼
Public Signup API ── email verification ──► Verified Signup Intent
       │
       ├── CARD ──► Lemon Squeezy Hosted Checkout
       │                    │
       │                    └── signed webhook
       │                              │
       └── BANK_TRANSFER ──► Immutable manual invoice/quote
                                      │ operator confirmation
                                      ▼
                          Durable Billing Event / Command
                                      │
                              retryable projector
                                      │ one transaction
                                      ▼
      Tenant + Customer + Subscription + Invoice + Entitlements + Audit
                                      │
                                      ▼
                          One-time Admin Account Setup
                                      │
                                      ▼
                       Local Tenant Access Policy
```

### 4.1 Source of truth

| Асуулт | Source of truth |
|---|---|
| Ямар plan public вэ? | `BillingPlan.active/public/archivedAt` |
| Ямар үнэ provider-тэй холбогдох вэ? | `BillingProviderPrice` |
| Card төлбөр үнэхээр болсон уу? | Баталгаажсан, environment/store-bound provider event |
| Manual төлбөр үнэхээр болсон уу? | Audited, authorized manual confirmation + bank reference |
| Tenant яг одоо ажиллах уу? | Local `Tenant.lifecycleStatus` + canonical subscription + entitlement snapshot |
| Хэдэн project/user/AI run зөвшөөрөх вэ? | Purchased plan version-ы DB entitlement snapshot |
| Invoice юу харуулах вэ? | Immutable local ledger + provider invoice reference |

Browser redirect, success page, email delivery, frontend state нь access grant хийх source of truth биш.

---

## 5. Canonical lifecycle

### 5.1 Signup state

Одоогийн state дээр recoverable provisioning state нэмнэ:

```text
PENDING_VERIFICATION
    └─ email verified ─► VERIFIED
          ├─ checkout/invoice created ─► CHECKOUT_STARTED
          ├─ verified paid evidence ─► PROVISIONING
          │       ├─ transaction committed ─► COMPLETED
          │       └─ retryable failure ─► PROVISIONING (retry)
          ├─ timeout ─► EXPIRED
          └─ user/operator cancel ─► ABANDONED
```

`COMPLETED` төлөвт `completedTenantId` заавал non-null байна. Энэ invariant-ийг DB check эсвэл transaction-аар баталгаажуулна.

### 5.2 Subscription → tenant access mapping

| Subscription/tenant state | Read | Write | AI job | Billing/export | UX |
|---|---:|---:|---:|---:|---|
| `PENDING_PAYMENT` | Үгүй | Үгүй | Үгүй | Тийм | Төлбөрөө үргэлжлүүлэх |
| `ACTIVE` / approved `TRIALING` | Тийм | Тийм | Тийм | Тийм | Хэвийн |
| `PAYMENT_GRACE` | Тийм | Тийм | Тийм | Тийм | Deadline бүхий warning |
| `SUSPENDED` | Тийм | Үгүй | Үгүй | Тийм | Payment recovery CTA |
| `ARCHIVED` | Үгүй | Үгүй | Үгүй | Үгүй | Support-only recovery policy |

Нэмэлт дүрэм:

- `PAST_DUE` анх орж ирэхэд grace deadline нэг удаа тогтооно; retry болгонд сунгахгүй.
- Grace-ийн default нь 7 хоног. Legal policy өөрчлөгдвөл versioned config болгоно.
- Grace deadline хүрмэгц request-time gate шууд write/AI-г хориглоно; lifecycle sweeper DB-г `SUSPENDED` болгож audit болон email үүсгэнэ.
- Cancel хийсэн tenant `currentPeriodEnd` хүртэл paid access-тай; тэр мөчөөс хойш suspended болно.
- Payment recovered event ирвэл local state болон cache шууд шинэчлэгдэж access сэргээнэ.
- Provider API түр unavailable бол ACTIVE tenant-ийг UNKNOWN гэж mass-suspend хийхгүй.

---

## 6. Card self-service бүтэн урсгал

### 6.1 Public хэрэглэгчийн урсгал

1. `/pricing` нь `GET /public/v1/plans`-оос plan/price/limit уншина.
2. Хэрэглэгч MONTH эсвэл YEAR-ийг ил тод сонгоно. CTA өөр interval руу чимээгүй шилжүүлэхгүй.
3. `/company-signup` дээр:
   - company name;
   - workspace slug;
   - admin name/email;
   - plan/interval;
   - payment channel;
   - billing summary;
   - Terms/Privacy acceptance version;
   - шаардлагатай бол billing legal profile авна.
4. `POST /public/v1/company-signups` нь tenant биш, expiring signup intent үүсгэнэ.
5. Verification email-ийн `/company-signup?signup=...&token=...` линк page дээр нээгдэхэд token-ийг нэг удаа consume хийж, VERIFIED state рүү орно.
6. Checkout start request нь нэг open checkout-ыг reuse хийнэ. Concurrent хоёр хүсэлт provider дээр хоёр checkout үүсгэхгүй.
7. Backend exact provider price mapping-аар hosted checkout үүсгэнэ; custom data-д opaque `signupIntentId` холбоно.
8. Return URL нь `/checkout/success?signup=<opaque-id>` байна. `sessionStorage`-т мөн intent ID-г fallback-аар хадгалж болно.
9. Success page `ACTIVE` гэж таахгүй; backend status-ийг bounded exponential backoff-оор poll хийнэ.
10. Signed paid event durable inbox-д орж, worker projection-ийг transaction-аар хийнэ.
11. Tenant, billing customer, subscription, invoice, entitlement snapshot, activation audit, first Company Admin нэг transaction-д үүснэ.
12. Account setup email явж, нэг удаагийн token-оор password тохируулсны дараа admin `ACTIVE` болно.

### 6.2 Account setup contract

Шинэ тусгай урсгал санал болгоно:

```http
GET  /public/v1/account-setups/:token/preview
POST /public/v1/account-setups/complete
```

`complete` body:

```json
{
  "token": "one-time-token",
  "password": "user-selected-password"
}
```

Backend transaction:

1. Token hash-аар unconsumed, unexpired `PASSWORD_RESET` record олно.
2. Token-ий user/tenant binding-ийг шалгана.
3. Password policy, breached/common password хамгаалалт хэрэглэнэ.
4. `UserCredential` үүсгэнэ.
5. User status-ийг `ACTIVE`, `emailVerifiedAt`-г set хийнэ.
6. Token-ийг consume/revoke хийнэ.
7. Audit үүсгэнэ; raw token/password log хийхгүй.
8. Replay бол generic expired/invalid error буцаана.

Frontend `/setup-account?token=...` тусгай page ашиглана. Invitation accept болон paid-account setup-ыг нэг form дээр далд хольж болохгүй.

---

## 7. Webhook-ийн найдвартай загвар

### 7.1 Receive endpoint

```http
POST /webhooks/billing/LEMON_SQUEEZY
```

Алгоритм:

1. JSON parser-аас **өмнө raw bytes** авна.
2. `X-Signature`-ийг webhook secret-ээр HMAC-SHA256 тооцож timing-safe compare хийнэ.
3. Strict schema-р parse хийнэ.
4. `store_id`, `test_mode/live`, event type, product/variant, subscription/customer ID-г баталгаажуулна.
5. `signupIntentId`, provider checkout, exact plan/price mapping, currency/amount, paid status-ийг тулгана.
6. Normalized safe event-ийг durable inbox-д хадгална.
7. Durable insert амжилттай бол **HTTP 200** буцаана.
8. Signature invalid бол generic 401/400; DB-д durable хадгалж чадаагүй бол 503 буцааж provider retry хийх боломж үлдээнэ.

### 7.2 Idempotency ба collision

- Unique key: `(provider, providerEventId)`.
- Ижил ID + ижил payload hash: safe duplicate, HTTP 200, no-op.
- Ижил ID + өөр payload hash: security incident, projection хийхгүй, high-priority alert.
- Projection нь event ID-аар exactly-once effect үүсгэнэ; webhook delivery өөрөө at-least-once байж болно.

### 7.3 Recoverable inbox

`BillingWebhookEvent`-д дараах ойлголтыг нэмнэ:

- normalized safe payload эсвэл encrypted raw payload;
- `nextAttemptAt`;
- `lockedAt`, `lockOwner`, `leaseExpiresAt`;
- `attemptCount`;
- `lastErrorCode`;
- `processedAt`;
- `deadLetteredAt`.

Worker:

```text
RECEIVED/FAILED due row
  └─ lease ─► PROCESSING
        ├─ commit projection + PROCESSED
        ├─ transient error ─► FAILED + exponential backoff
        └─ max attempts/invalid domain ─► DEAD_LETTER + alert
```

- Crash болсон `PROCESSING` lease expiry дараа reclaim хийнэ.
- Projection болон processed marker боломжтой бол нэг transaction-д байна.
- Failed first provisioning event-ийг provider reconciliation дангаараа нөхөж чадна гэж найдахгүй.
- Provider webhook payload, token, email, signature, invoice URL-ийг unrestricted log/audit-д хадгалахгүй.

### 7.4 Сонсох event-үүд

- `subscription_created`
- `subscription_updated`
- `subscription_cancelled`
- `subscription_expired`
- `subscription_paused`
- `subscription_unpaused`
- `subscription_payment_success`
- `subscription_payment_failed`
- `subscription_payment_recovered`
- Refund/chargeback policy хэрэгжүүлэх үед холбогдох order/refund event

---

## 8. Paid-only atomic provisioning

Tenant-ийг зөвхөн дараах бүх нөхцөл биелсэн үед provision хийнэ:

- webhook signature хүчинтэй;
- event live/sandbox environment тохирсон;
- expected store ID таарсан;
- supported event/status;
- status нь `ACTIVE` эсвэл бизнесээр зөвшөөрсөн `TRIALING`;
- signup intent VERIFIED/CHECKOUT_STARTED;
- exact provider checkout ID таарсан;
- intent-ийн provider, planId, interval таарсан;
- external product/price allowlisted;
- currency/amount provider-ийн authoritative invoice/price-тай таарсан;
- intent expired/abandoned/completed биш;
- нэг canonical subscription constraint зөрчөөгүй.

Нэг database transaction-д:

1. Intent row lock/CAS хийж `PROVISIONING` болгоно.
2. Tenant `ACTIVE` үүсгэнэ.
3. BillingCustomer үүсгэнэ.
4. TenantSubscription үүсгэнэ.
5. BillingInvoice upsert хийнэ.
6. Purchased `BillingPlan` болон `PlanEntitlement` DB row-оос snapshot үүсгэнэ.
7. Company Admin-ийг `INVITED` үүсгэнэ.
8. One-time account setup token hash хадгална.
9. Tenant audit үүсгэнэ.
10. Intent-д `COMPLETED + completedTenantId` зэрэг set хийнэ.
11. Webhook projection-ийг processed болгоно.

Transaction rollback бол дээрх бүх өөрчлөлт rollback хийнэ; event retryable хэвээр байна. Email transaction commit-ийн дараа явна. Email failure tenant activation-ийг rollback хийхгүй, харин resend боломжтой queue үүсгэнэ.

---

## 9. Manual invoice зорилтот урсгал

Одоогийн manual adapter-ыг launch-ready гэж үзэхгүй. Дараах бүтэн урсгал хэрэгжинэ.

### 9.1 Customer flow

1. Verified signup дээр `BANK_TRANSFER` сонгоно.
2. Backend plan version, price, tax treatment, total, due date бүхий immutable quote үүсгэнэ.
3. `PENDING_PAYMENT` tenant, BillingCustomer, `MANUAL_INVOICE/PENDING` subscription, `OPEN` invoice-ийг atomically үүсгэнэ.
4. Admin user-ийг credentialгүй INVITED байлгаж, төлбөр батлагдахаас өмнө setup token явуулахгүй.
5. Customer `/checkout/manual/:signupIntentId` дээр:
   - банк/дансны мэдээлэл;
   - exact total;
   - invoice/reference number;
   - due date;
   - “төлбөр шалгагдаж байна” state;
   - support contact харна.

### 9.2 Platform operator flow

1. `/platform/billing` дээр pending manual invoice queue байна.
2. Bank reference, received amount, currency, received date, payer reference-г quote-тэй тулгана.
3. Wrong amount/currency/tax, expired invoice, duplicate reference-г reject хийнэ.
4. Confirm action-д `PLATFORM_BILLING_MANAGE`, step-up MFA/re-auth, reason, impact preview шаардлагатай.
5. Production-д maker-checker буюу хоёр хүний approval ашиглахыг зөвлөж байна.
6. Success transaction:
   - invoice `PAID`;
   - subscription `ACTIVE`;
   - period start/end;
   - tenant `ACTIVE`;
   - entitlement snapshot;
   - setup token;
   - PlatformAuditLog болон tenant AuditLog;
   - email notification.
7. Ижил bank reference/command replay хоёр дахь activation үүсгэхгүй.

### 9.3 Expiry

- Unpaid invoice due date өнгөрвөл `VOID`/`UNCOLLECTIBLE` policy хэрэглэнэ.
- PENDING_PAYMENT tenant operational data үүсгэх эрхгүй.
- Abandoned pending tenant-ийг шууд hard-delete хийхгүй; PII retention, slug release, financial history policy-г хуульчаар батална.

Manual invoice урсгал дуусахаас өмнө landing дээр “банк шилжүүлгээр шууд бүртгүүлнэ” CTA гаргахгүй; “Нэхэмжлэх авах” нь sales-assisted contact руу орж болно.

---

## 10. Existing tenant-ийн purchase ба plan management

Public `/company-signup` нь зөвхөн **шинэ company** үүсгэнэ. Нэвтэрсэн tenant өөрийн billing page-ээс төлөвлөгөөгөө удирдана.

Шинэ API санал:

```http
GET  /v1/billing/plans
POST /v1/billing/checkout
POST /v1/billing/change-plan/preview
POST /v1/billing/change-plan
POST /v1/billing/resume
POST /v1/billing/cancel
GET  /v1/billing/invoices
POST /v1/billing/portal
```

Дүрэм:

- `TENANT_BILLING_READ` зөвхөн харах эрхтэй.
- Checkout/change/cancel/resume/portal нь `TENANT_BILLING_MANAGE` шаарддаг.
- PENDING_PAYMENT болон SUSPENDED tenant billing route-д орж чадна.
- Pricing дээр нэвтэрсэн хэрэглэгч plan сонгоход “Одоогийн workspace-д авах” эсвэл “Шинэ company үүсгэх” гэдгийг ил тод сонгуулна.
- Existing tenant-ийн checkout шинэ tenant үүсгэх custom data агуулахгүй.
- Upgrade/downgrade хийхээс өмнө authoritative preview: current plan, target plan, effective time, proration/credit, next invoice харуулна.
- Upgrade-ыг шууд эсвэл provider-confirmed байдлаар; downgrade-ыг default-аар period end-д хэрэгжүүлнэ.
- Current usage target plan limit-ээс их бол downgrade deny хийж, юу бууруулахыг тодорхой харуулна.

---

## 11. Entitlement ба quota enforcement

### 11.1 Snapshot integrity

- Snapshot-ийг in-code latest catalog-аас биш, subscription-ийн яг худалдаж авсан `BillingPlan` + `PlanEntitlement` DB row-оос үүсгэнэ.
- `sourceVersion = plan:<code>@<version>:<interval>` байна.
- Paid tenant-ийн snapshot missing/corrupt бол unlimited гэж үзэхгүй.
- Grandfathered tenant-ийг explicit `GRANDFATHERED` provenance/flag-аар тэмдэглэнэ.
- Corrupt paid snapshot үед premium write/AI feature fail-closed, billing/read/export нээлттэй, Platform alert үүснэ.

### 11.2 Enforcement points

| Limit/feature | Enforcement |
|---|---|
| Active projects | Transaction/advisory-lock reservation |
| Active users/invitations | Atomic seat reservation; invitation accept дээр дахин шалгах |
| Storage | Upload reservation → commit/release |
| AI monthly runs | Atomic usage reservation before enqueue |
| AI cost cap | Actual/estimated cost backstop + reconciliation |
| API access | Route-level `requireFeature` |
| Advanced reports/agent capabilities | Server-side feature guard, зөвхөн UI hide биш |

Check-then-create race ашиглахгүй. Unknown usage-ийг 0 гэж үзэж нэмэлт багтаамж өгөхгүй.

---

## 12. Invoice, refund, chargeback, ledger

### 12.1 Invoice

Invoice model дараахыг алдагдалгүй хадгална:

- subtotal;
- discount;
- tax;
- total;
- paid amount;
- refunded amount;
- currency;
- provider invoice/order ID;
- provider update/version timestamp;
- hosted invoice URL;
- immutable adjustment history.

Unknown provider invoice status-ийг `OPEN` гэж таахгүй; `UNKNOWN/REVIEW_REQUIRED` байдлаар quarantine хийнэ.

### 12.2 Refund policy-г кодоос өмнө батлах

| Event | Шийдэх зүйл |
|---|---|
| Full refund | Access шууд хаах уу, period end хүртэл үлдээх үү? |
| Partial refund | Access өөрчлөхгүй юу, credit үүсгэх үү? |
| Chargeback/fraud | Шууд suspend + security review хийх үү? |
| Chargeback reversal | Auto restore эсвэл manual review хийх үү? |
| Annual refund | 14 хоногийн draft policy-г хуульчаар батлах |

Refund нь original invoice-г overwrite хийхгүй; immutable adjustment/credit record нэмнэ. Эхний launch-д refund-ийг Lemon Squeezy dashboard дээр operator хийж болох ч local ledger болон access reconciliation заавал дагалдана.

---

## 13. Frontend UX шаардлага

### 13.1 Public pricing/signup

- MONTH/YEAR сонголт CTA дээр хадгалагдана.
- API-аас resolve хийсэн order summary харуулна.
- Plan interval-д price байхгүй бол CTA disabled байна.
- Card/bank сонголт зөвхөн тухайн channel production-ready, enabled үед харагдана.
- Terms/Privacy versioned consent авна.
- Verification email resend, expired token, already verified, back-to-pricing states байна.
- Checkout cancelled/failed/processing/confirmed state тус бүр ялгаатай байна.
- Success page 5 минутын дараа “payment failed” гэж таахгүй; “баталгаажуулалт удаж байна” support/retry path харуулна.
- Paid success дараа account setup линк хүлээх/дахин илгээх боломж байна.

### 13.2 Company Admin `/admin/billing`

- Current plan/status/renewal/grace deadline.
- Usage болон limit-үүдийн truthful state; unknown-г 0 гэж харуулахгүй.
- Invoice list болон provider invoice link.
- Upgrade/change/resume/cancel flow.
- Cancel confirmation, reason, effective date, undo/resume.
- PAYMENT_GRACE/SUSPENDED үед app-wide banner + direct payment CTA.
- READ-only хэрэглэгч manage button харахгүй/disabled тайлбартай байна.
- Query тус бүрийн error state тусдаа; backend error-ийг empty healthy state болгож нуухгүй.

### 13.3 Platform Super Admin `/platform/billing`

- Active, grace, suspended, canceled subscription counts.
- Revenue гэдэг нэр зөвхөн reconciliation батлагдсан санхүүгийн хэмжүүрт хэрэглэнэ; tenant count-ыг revenue гэж нэрлэхгүй.
- Failed/stuck webhook inbox, attempt count, age, dead-letter queue.
- Pending signup provisioning болон manual invoice queue.
- Invoice/reconciliation mismatch.
- Access override expiry ба audit.
- Manual confirmation-д permission + step-up + confirmation + reason.
- Search/filter/pagination: tenant, provider, status, plan, invoice state, webhook state.
- Platform admin tenant-ийн operational feature-ийг billing screen-ээс өөрчлөхгүй.

---

## 14. Security non-negotiables

1. Card number/CVC BuildWatch API, DB, log, analytics-аар дамжихгүй.
2. Client amount, providerPriceId, tenant lifecycle-д итгэхгүй.
3. Webhook raw body signature-г JSON parse-аас өмнө шалгана.
4. Store/environment/price/product/intent/checkout/status/currency/amount binding бүгд баталгаатай байна.
5. Live server sandbox key-тай, sandbox server live key-тай асахгүй.
6. Return URL exact allowlist + HTTPS; open redirect байхгүй.
7. Email verification/setup token random 32-byte, DB-д hash-аар, single-use, short TTL.
8. Password, raw token, API key, webhook secret/signature, raw payload, invoice private URL log/audit-д орохгүй.
9. Public signup/status/resend endpoint-д IP + email + intent rate limit; response нь account enumeration хийхгүй.
10. Tenant billing object бүр `(tenantId, id)` authorization-тай; invoice URL cross-tenant ашиглагдахгүй.
11. Platform billing identity tenant user-ээс тусдаа; tenant token platform endpoint-д 403.
12. Manual payment, access override, refund зэрэг high-impact command idempotency key, optimistic lock, audit шаарддаг.
13. Manual confirmation/refund-д MFA step-up; боломжтой бол maker-checker.
14. Audit append-only: actor, scope, action, before/after hash, result, reason, correlation ID.
15. Provider outage/UNKNOWN state нь ACTIVE tenant-ийг автоматаар mass-suspend хийхгүй.

---

## 15. Background jobs ба operations

Нэг daily script бүх ажлыг хийхэд хангалтгүй. Дараах job-уудыг салгана.

| Job | Давтамж | Үүрэг |
|---|---|---|
| Webhook projector/retry | Continuous эсвэл 1 минут | RECEIVED/FAILED event process, lease recovery, DLQ |
| Grace/lifecycle sweeper | 5–15 минут | Expired grace/cancel period/manual period persist, audit/email |
| Provider reconciliation | Өдөрт 1 удаа + manual trigger | Missed event, status/period/plan/customer/entitlement repair |
| Signup cleanup | Өдөрт 1 удаа | Expired unverified/abandoned intent cleanup |
| Override expiry | 5–15 минут | Temporary access override close |
| Invoice reconciliation | Өдөрт 1 удаа | Provider invoice/ledger mismatch |

Reconciliation:

- page/cursor ашиглаж бүх subscription-ийг ээлжээр шалгана; үргэлж oldest 200 дээр гацахгүй;
- `lastReconciledAt`, result, error code хадгална;
- provider unavailable бол no access mutation;
- status-аас гадна plan/price, period, cancel flag, customer ID, entitlement snapshot, invoice-г тулгана;
- зассан бүх өөрчлөлт audit-тай байна.

### 15.1 Monitoring/alerts

Хамгийн бага metrics:

- `billing_checkout_created_total`
- `billing_checkout_failed_total{reason}`
- `billing_webhook_received_total{event}`
- `billing_webhook_invalid_total`
- `billing_webhook_duplicate_total`
- `billing_webhook_processing_seconds`
- `billing_webhook_failed_total{code}`
- `billing_webhook_dead_letter_total`
- `billing_provisioning_stuck_total`
- `billing_reconciliation_mismatch_total`
- `billing_grace_tenants`
- `billing_suspended_tenants`
- `billing_manual_pending_total`

Alert:

- valid webhook processing failure;
- oldest RECEIVED/PROCESSING age threshold давсан;
- DLQ > 0;
- payment confirmed боловч tenant provision хийгдээгүй;
- ACTIVE paid tenant entitlement missing/corrupt;
- reconciliation provider outage эсвэл mismatch spike;
- manual invoice overdue;
- setup email repeatedly failed.

---

## 16. Хэрэгжүүлэх roadmap

Phase-ийг дарааллаар нь хийнэ. Дараагийн phase өмнөх exit gate ногоон болсны дараа эхэлнэ.

### Phase 0 — Commercial, legal, provider freeze

**Хийх ажил**

- Starter/Business үнэ, entitlement, annual discount-ийг freeze хийх.
- Grace, cancellation, refund, data export/retention policy-г legal/accounting review-д өгөх.
- Lemon Squeezy store нээж KYC/payout approval авах.
- Tax-inclusive/exclusive шийдвэр гаргах.
- Manual invoice/eBarimt workflow-ийн owner, bank account, approval policy тогтоох.
- Card checkout, public manual signup, plan change, overage collection-д тусдаа kill/feature flag тодорхойлох.
- Public copy-оос хэрэгжээгүй амлалтыг түр арилгах.

**Exit gate**

- Approved store;
- signed commercial decision record;
- Terms/Privacy draft биш болсон;
- card launch болон manual launch тусдаа feature flag-тай.

### Phase 1 — P0 payment integrity

**Backend**

- `PROVISIONING` state + atomic claim/provision transaction.
- ACTIVE/TRIALING-only provisioning.
- Exact store/environment/intent/checkout/price/currency/amount binding.
- Recoverable webhook inbox, worker, lease, retry, DLQ.
- Webhook acknowledgment `200`.
- Concurrent checkout creation lease/idempotency.
- DB PlanEntitlement-аас snapshot үүсгэх.
- Paid missing/corrupt snapshot fail-closed.
- Grace lifecycle sweeper.

**Frontend/Auth**

- Verification deep-link resume.
- Correlated success URL + session fallback.
- `/setup-account` endpoint/page.
- Checkout cancelled/failed/pending recovery.

**Exit gate**

- Paid card happy path нэг ч manual DB edit-гүйгээр login хүртэл дуусна.
- Duplicate, crash, out-of-order event tenant-ийг давхар үүсгэхгүй.
- Forged/unpaid/wrong price event access өгөхгүй.

### Phase 2 — Card billing product completion

**Хийх ажил**

- Existing tenant first purchase.
- `/admin/billing/plans`.
- Permission-aware portal/cancel controls.
- Cancel confirmation + period-end semantics + resume.
- Global dunning/grace/suspended banner.
- Invoice/error states.
- Platform webhook/reconciliation visibility.

**Exit gate**

- New company болон existing tenant card purchase хоёулаа sandbox E2E passed.
- Payment failure → grace → recovery → suspension lifecycle automated.

### Phase 3 — Manual invoice

**Хийх ажил**

- Payment channel selection/feature flag.
- Immutable quote + PENDING_PAYMENT tenant/subscription/open invoice.
- Manual instructions page.
- Platform pending queue.
- Amount/currency/tax/reference validation.
- Step-up + maker-checker + idempotent confirmation.
- Expiry/renewal/reminder/eBarimt operations.

**Exit gate**

- Wrong/duplicate payment rejected.
- Correct payment exactly one activation үүсгэнэ.
- Accountant/legal sign-off.

### Phase 4 — Plan lifecycle

**Хийх ажил**

- Upgrade/downgrade preview.
- Proration/credit policy.
- Resume/reactivate.
- Provider portal/deep link.
- Reconciliation plan/entitlement repair.
- Full/partial refund болон chargeback ledger/policy.

**Exit gate**

- Every lifecycle transition idempotent, audited, reversible where policy allows.

### Phase 5 — Quota ба overage

**Хийх ажил**

- Project/user/storage/AI atomic reservations.
- API/advanced feature server guards.
- Usage reporting reconciliation.
- Overage preview, cap, notification.
- Provider metering/extra invoice эсвэл manual overage invoice.

**Exit gate**

- Concurrency test plan limit-ээс хэтрүүлэхгүй.
- Overage charge rounding/currency/invoice нийлнэ.

### Phase 6 — Production rollout

**Хийх ажил**

- Sandbox contract/E2E.
- Production env validation.
- Internal tenant canary.
- 1–3 pilot company.
- Provider outage drill.
- Backup/restore + reconciliation drill.
- Alert/on-call/runbook.

**Exit gate**

- Pilot renewal болон payment failure recovery бодитоор шалгагдсан.
- No unresolved P0/P1 billing incident.
- Rollback/new-checkout kill switch туршигдсан.

---

## 17. API contract-ийн зорилтот жагсаалт

### Public

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/public/v1/plans` | Public catalog |
| POST | `/public/v1/company-signups` | Expiring intent |
| POST | `/public/v1/company-signups/:id/verify-email` | Single-use verify |
| POST | `/public/v1/company-signups/:id/resend-verification` | Rate-limited resend |
| GET | `/public/v1/company-signups/:id/summary` | Redacted order/status summary |
| POST | `/public/v1/company-signups/:id/checkout` | Hosted card checkout |
| POST | `/public/v1/company-signups/:id/manual-invoice` | Manual quote/invoice request |
| GET | `/public/v1/company-signups/:id/status` | PENDING/CONFIRMING/ACTIVE/FAILED/EXPIRED |
| POST | `/public/v1/account-setups/complete` | One-time password setup |

Public status endpoint raw email, tenant internals, provider IDs гаргахгүй. Intent ID нь authorization secret биш; sensitive operation token шаарддаг.

### Tenant

| Permission | Endpoint group |
|---|---|
| `TENANT_BILLING_READ` | subscription, plans, usage, entitlements, invoices |
| `TENANT_BILLING_MANAGE` | checkout, portal, change plan, resume, cancel |

### Platform

| Permission | Endpoint group |
|---|---|
| `PLATFORM_BILLING_READ` | overview, subscriptions, invoices, webhook/DLQ, reconciliation, manual queue |
| `PLATFORM_BILLING_MANAGE` | manual confirm, replay/reconcile command, access override |

Manage command бүр idempotency key, reason, audit, шаардлагатай үед step-up шаардана.

---

## 18. Minimum acceptance test suite

### 18.1 Payment authenticity

- Missing/forged signature, altered raw bytes → no inbox projection, no tenant.
- Wrong store/test-mode/product/price/intent/checkout/currency/amount/status → no activation.
- Success-page URL-г шууд нээх → no activation.
- Client amount/price ID өөрчлөх → server ignore/reject.

### 18.2 Idempotency/recovery

- Нэг valid event-ийг 20 удаа зэрэг хүргэхэд яг 1 tenant, 1 subscription, 1 invoice, 1 snapshot, 1 activation audit.
- Same event ID + different hash → security alert.
- Inbox insert дараа crash → lease expiry retry exactly once completes.
- Poison event → max attempt дараа DLQ; healthy events үргэлжилнэ.
- Provision transaction middle failure → intent completed болохгүй, partial tenant үлдэхгүй.
- Concurrent checkout requests → 1 provider checkout.

### 18.3 Lifecycle

- ACTIVE → PAST_DUE → recovered.
- ACTIVE → PAST_DUE → grace expiry → SUSPENDED.
- Out-of-order/equal-time event newer state-г regress хийхгүй.
- Cancel → period end хүртэл access → дараа suspend.
- Repeated cancel/resume duplicate effect үүсгэхгүй.
- Provider outage ACTIVE tenant-ийг хаахгүй.

### 18.4 Account onboarding

- Email deep link auto-resume.
- Verification token single-use/expiry.
- Checkout return exact intent-ээ poll хийнэ.
- Setup token single-use/expiry/tenant binding.
- Password set хийсний дараа Company Admin login ажиллана.
- SMTP failure paid tenant-ийг rollback хийхгүй; resend ажиллана.

### 18.5 Manual payment

- Wrong amount/currency/tax/reference reject.
- Duplicate bank reference reject.
- Unauthorized role 403.
- Expired invoice confirm болохгүй.
- Valid maker/checker confirmation exactly one activation.

### 18.6 Tenant isolation/limits

- Company A Company Admin Company B invoice/subscription/status-г ID tampering-аар харах/өөрчлөхгүй.
- Platform bearer tenant operational API-д 403.
- Suspended tenant write/AI 402, read/billing/export allowed.
- Paid tenant corrupt entitlement unlimited болохгүй.
- Concurrent project/user/storage/AI request plan limit-ийг хэтрүүлэхгүй.

### 18.7 Frontend

- API price/limit only; no hard-coded authoritative amount.
- MONTH/YEAR CTA сонголтоо хадгална.
- Verification, pending, failure, canceled, active states.
- READ permission manage action харахгүй.
- Partial query failure empty/healthy болж харагдахгүй.
- 390px mobile overflowгүй, keyboard/focus, screen reader labels зөв.

---

## 19. Production setup checklist

### 19.1 Lemon Squeezy

- [ ] Store account/KYC/payout approved.
- [ ] 2 product эсвэл 1 product/4 variant бүтэц батлагдсан.
- [ ] Starter MONTH/YEAR, Business MONTH/YEAR live variant үүссэн.
- [ ] Үнэ exact MNT amount-аар тохирсон; checkout дахь USD conversion тайлбар шалгасан.
- [ ] Tax-inclusive/exclusive setting legal decision-тэй таарсан.
- [ ] Webhook URL: `https://<domain>/webhooks/billing/LEMON_SQUEEZY`.
- [ ] Зөвхөн шаардлагатай subscription/payment event сонгосон.
- [ ] API key, Store ID, webhook secret тусдаа secret store-д.
- [ ] Test mode simulation-аар renewal/failure/recovery шалгасан.

### 19.2 Production environment

```dotenv
BILLING_PROVIDER=LEMON_SQUEEZY
BILLING_ENVIRONMENT=live
BILLING_MANUAL_INVOICE_ENABLED=true
# Phase 1-д нэмэх тусдаа public-channel flag; Phase 3 exit gate хүртэл false байна.
BILLING_MANUAL_PUBLIC_SIGNUP_ENABLED=false
BILLING_RETURN_URL_ALLOWLIST=https://<domain>
LEMON_SQUEEZY_API_KEY=...
LEMON_SQUEEZY_STORE_ID=...
LEMON_SQUEEZY_WEBHOOK_SECRET=...

SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=no-reply@<domain>
SMTP_REPLY_TO=support@<domain>
```

Одоогийн `billing-config.ts` production дээр `BILLING_MANUAL_INVOICE_ENABLED=true` байхыг
шаарддаг. Энэ нь adapter/operator fallback бүртгэгдсэнийг илэрхийлэхээс public customer flow
ажиллана гэсэн үг биш. Phase 1-д `BILLING_MANUAL_PUBLIC_SIGNUP_ENABLED` гэсэн тусдаа flag
нэмж, Phase 3 exit gate дуусах хүртэл `false` байлгана.

### 19.3 Deploy order

```bash
cd agents
pnpm run db:migrate:deploy
pnpm run seed:billing:plans -- --environment live
pnpm run ops:config:v22 -- --env .env.production
pnpm run security:secrets:v22
pnpm run check
pnpm exec vitest run tests/backend/billing-domain.test.ts \
  tests/backend/billing-provider.test.ts \
  tests/backend/billing-idor.test.ts \
  tests/backend/platform-billing.test.ts \
  tests/backend/tenant-access-policy.test.ts
pnpm run smoke:billing:postgres
pnpm run smoke:billing:lifecycle

cd ../agent-console
pnpm run verify
pnpm run audit:marketing
pnpm run audit:platform
```

Windows PowerShell дээр multiline `\`-ийн оронд command-ийг нэг мөрөөр эсвэл PowerShell backtick ашиглаж ажиллуулна.

### 19.4 Go-live өмнө

- [ ] Live provider price mapping 4/4 exact, duplicateгүй.
- [ ] Deploy preflight missing mapping дээр fail хийнэ.
- [ ] Real low-risk card purchase → webhook → setup → login E2E passed.
- [ ] Cancellation болон provider portal passed.
- [ ] Payment failure/recovery simulation passed.
- [ ] Webhook DLQ/replay UI/runbook passed.
- [ ] Grace sweeper/reconciliation scheduler active.
- [ ] Alert destination/on-call owner configured.
- [ ] Terms, Privacy, Refund, VAT/eBarimt policy reviewed.
- [ ] Backup/restore хийсний дараах reconciliation drill passed.

---

## 20. Rollout ба rollback

### 20.1 Rollout

1. Local/test provider fixture.
2. Lemon Squeezy test mode.
3. Internal BuildWatch tenant.
4. 1 pilot company.
5. 3 pilot company.
6. Public card checkout.
7. Manual invoice тусдаа pilot.

### 20.2 Kill switches

- New public signup disable.
- New checkout creation disable.
- Manual invoice channel disable.
- Plan change disable.
- Overage collection disable.

Webhook intake/retry болон existing paid tenant access-ийг kill switch-ээр хамт унтраахгүй.

### 20.3 Rollback зарчим

- Provider доголдвол шинэ checkout-ыг pause хийнэ.
- Existing ACTIVE tenant local state-аар ажилласаар байна.
- Webhook durable intake боломжтой бол үргэлжилнэ.
- Migration backward compatibility эсвэл forward-fix ашиглана; financial history hard-delete хийхгүй.
- Access mass change хийхээс өмнө impact preview болон operator confirmation шаардана.

---

## 21. Definition of Done

Subscription payment system production-ready гэж үзэхийн тулд:

- [ ] Card төлбөрөөс login хүртэл бүтэн E2E ажилласан.
- [ ] Browser redirect access grant хийдэггүй.
- [ ] Paid-only exact event binding implemented.
- [ ] Webhook retry/lease/DLQ ажилладаг.
- [ ] Atomic provisioning partial state үлдээдэггүй.
- [ ] Verification болон account setup token single-use ажилладаг.
- [ ] Existing tenant first purchase/cancel/resume ажилладаг.
- [ ] Grace expiry persist, audit, notification хийдэг.
- [ ] Paid entitlement corruption fail-closed.
- [ ] Company/Platform billing permission UI ба API таарсан.
- [ ] Reconciliation бүх material field-ийг шалгадаг.
- [ ] Provider outage mass suspension үүсгэдэггүй.
- [ ] Manual invoice нээгдсэн бол amount/tax/reference/maker-checker/eBarimt flow бүрэн.
- [ ] Refund/chargeback policy legal-аар батлагдсан.
- [ ] Security, concurrency, IDOR, provider sandbox, browser E2E бүгд green.
- [ ] Metrics, alerts, runbook, backup/restore drill бэлэн.

---

## 22. Одоо эхлэх яг дараалал

1. `billing-domain.test.ts`-ийн whitespace-only failed test-ийг semantic assertion болгох.
2. Paid account setup endpoint + `/setup-account` page хийх.
3. Verification deep-link resume засах.
4. Checkout success URL-д signup correlation хийх.
5. ACTIVE/TRIALING-only exact payment binding хийх.
6. Signup claim/provision-ийг нэг recoverable transaction/state machine болгох.
7. Webhook durable payload + retry worker + lease + DLQ хийх.
8. Webhook response-г successful durable accept үед 200 болгох.
9. Entitlement snapshot-ийг DB plan rows-аас үүсгэдэг болгох.
10. Grace/lifecycle sweeper хийх.
11. Card sandbox E2E тест ногоон болгох.
12. Existing tenant first-purchase болон billing UX хийх.
13. Manual invoice PENDING_PAYMENT урсгалыг хийх эсвэл public copy/feature flag-аар бүрэн хаах.
14. Дараа нь upgrade/downgrade, refund, overage руу орох.

Энэ дараалал нь хамгийн түрүүнд “мөнгө авсан ч tenant/login үүсэхгүй” болон “мөнгө төлөөгүй ч ACTIVE болох” хоёр хамгийн өндөр эрсдэлийг хаана.

---

## 23. Холбогдох одоогийн файлууд

- `agents/prisma/schema.prisma`
- `agents/src/backend/billing-config.ts`
- `agents/src/backend/billing-contracts.ts`
- `agents/src/backend/billing-signup-service.ts`
- `agents/src/backend/billing-checkout-service.ts`
- `agents/src/backend/billing-provider-lemon-squeezy.ts`
- `agents/src/backend/billing-provider-manual.ts`
- `agents/src/backend/billing-webhook-service.ts`
- `agents/src/backend/billing-reconciliation.ts`
- `agents/src/backend/tenant-access-policy.ts`
- `agents/src/backend/tenant-billing-service.ts`
- `agents/src/backend/platform-billing-service.ts`
- `agents/src/scripts/billing-maintenance.ts`
- `agent-console/src/pages/marketing/company-signup-page.tsx`
- `agent-console/src/pages/marketing/checkout-success-page.tsx`
- `agent-console/src/pages/billing-page.tsx`
- `agent-console/src/pages/platform/billing-page.tsx`

---

## 24. Албан ёсны provider эх сурвалж

- [Lemon Squeezy — Supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)
- [Lemon Squeezy — Supported currencies](https://docs.lemonsqueezy.com/help/payments/currencies)
- [Lemon Squeezy — Sync with webhooks](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks)
- [Lemon Squeezy — Test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode)
- [Lemon Squeezy — Merchant of Record](https://docs.lemonsqueezy.com/help/payments/merchant-of-record)
- [Lemon Squeezy — Sales tax and VAT](https://docs.lemonsqueezy.com/help/payments/sales-tax-vat)
- [Lemon Squeezy — Recovery and dunning](https://docs.lemonsqueezy.com/help/online-store/recovery-dunning)
- [Lemon Squeezy — Refunds and chargebacks](https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks)
- [Stripe — Global availability](https://stripe.com/global)

Provider-ийн event, country, currency, fee, tax behavior цаг хугацаанд өөрчлөгдөж болно. Production өөрчлөлт бүрийн өмнө дээрх official docs болон live dashboard contract-ийг дахин шалгана.
