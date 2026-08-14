# BuildWatch Stripe Subscription Roadmap

**Огноо:** 2026-08-14  
**Төлөв:** Phase 1 code complete; Phase 0 external Stripe gate болон test catalog mapping хүлээгдэж байна  
**Үндэслэсэн баримт:** `subscription-payment-system.md`  
**Хамрах хүрээ:** Pricing → company signup → Stripe Checkout → webhook → paid tenant provisioning → account setup → renewal/dunning → Customer Portal → Platform billing monitoring

> [!IMPORTANT]
> Энэ roadmap-д QPay, manual bank transfer болон Lemon Squeezy-г production төлбөрийн
> сувгаар ашиглахгүй. BuildWatch-ийн self-service subscription нь **Stripe Checkout +
> Stripe Billing** байна. Гэхдээ Stripe account нээх legal entity болон payout bank account
> нь Stripe-ийн дэмждэг улсад байх ёстой. Mongolia нь 2026-08-14-ний Stripe-ийн direct
> payments availability жагсаалтад байхгүй тул энэ нөхцөлийг Phase 0 дээр нотлоогүй бол
> production payment launch хийхгүй.

---

## 1. Өмнөх баримтын дүгнэлт

`subscription-payment-system.md` нь payment provider-оос үл хамаарах гол архитектурын
асуудлуудыг сайн тодорхойлсон. Тэр баримтыг бүхэлд нь хаях шаардлагагүй.

### 1.1 Сайн болсон хэсгүүд

- Browser success redirect төлбөрийн баталгаа биш гэж зөв тогтоосон.
- Tenant access-ийг provider API-аас шууд бус, local persisted subscription state-аас шийддэг.
- `PENDING_PAYMENT`, `ACTIVE`, `PAYMENT_GRACE`, `SUSPENDED`, `ARCHIVED` access matrix зөв.
- Webhook signature, idempotency, retry, lease, dead-letter queue-ийн шаардлага сайн.
- Paid tenant provisioning-ийг atomic transaction болгох шаардлагыг зөв гаргасан.
- Email verification болон paid Company Admin account setup-ийн тасарсан урсгалыг илрүүлсэн.
- Entitlement snapshot, quota enforcement, tenant isolation, audit, reconciliation-ийг зөв хамруулсан.
- Production blocker болон acceptance test-үүд бодит эх кодын эрсдэлийг сайн барьсан.

### 1.2 Засах шаардлагатай хэсгүүд

- Гол provider нь Lemon Squeezy гэж сонгосон нь шинэ бизнесийн шийдвэртэй зөрсөн.
- QPay хийгээгүй ч manual invoice/eBarimt урсгал roadmap-ийн том хэсгийг эзэлсэн.
- Одоогийн codebase-д Stripe enum/config/adapter байхгүй тул migration scope тусгайлан гараагүй.
- Stripe Checkout Session, Product/Price, Customer Portal, event mapping, API version pinning,
  idempotency key, Stripe CLI/Test Clock-ийн тодорхой төлөвлөгөө дутуу.
- Stripe ашиглах legal entity/account eligibility-г энгийн risk биш, **Phase 0 hard gate** болгох ёстой.
- Stripe нь стандарт Payments/Billing integration үед Merchant of Record биш. Tax, invoice,
  refund, chargeback, business registration-ийн хариуцлагыг BuildWatch-ийн operator entity
  өөрөө хариуцна гэдгийг тусгайлан тодорхойлох шаардлагатай.

### 1.3 Эцсийн үнэлгээ

Өмнөх баримт архитектурын хувьд сайн, production эрсдэлийг нуусангүй. Шинэ roadmap нь
тэр суурийг хадгалж, provider болон rollout хэсгийг Stripe-д зориулан сольж байна.

---

## 2. Шинэ эцсийн шийдвэр

| Хэсэг | Шийдвэр |
|---|---|
| Payment provider | Stripe |
| Checkout UI | Stripe-hosted Checkout |
| Recurring billing | Stripe Billing Subscriptions |
| Customer self-service | Stripe Customer Portal |
| Public plans | Starter, Business |
| Enterprise | `/contact`, public checkout байхгүй |
| Billing interval | Monthly, Yearly |
| Payment method MVP | Card; Stripe account-д бодитоор eligible wallet байвал Checkout автоматаар харуулж болно |
| QPay | Хийхгүй |
| Manual invoice | Энэ roadmap-аас хассан |
| Currency | Эхний сонголт MNT; тухайн Stripe account/card configuration дээр sandbox ба live test-ээр батална |
| Tax | Stripe Tax ашиглах эсэхийг legal/accounting шийдвэрээр сонгоно |
| Access activation | Зөвхөн verified Stripe event + server-side object verification |
| Card data | BuildWatch API/DB/log-оор дамжихгүй |
| Free trial | MVP-д байхгүй |

### 2.1 Stripe account eligibility hard gate

Stripe-ийн official global availability page дээр Mongolia direct payment account-н supported
country байдлаар байхгүй. Тиймээс Stripe implementation эхлэхээс өмнө дараах хувилбарын аль нэг
нь **хууль ёсоор бодит** байх ёстой:

1. BuildWatch-ийн operator company Stripe-supported улсад бүртгэлтэй, тухайн улсын шаардлага
   хангасан bank account, tax/business мэдээлэлтэй байх; эсвэл
2. Stripe Atlas зэрэг хууль ёсны incorporation замыг сонгож, company, bank, tax, accounting,
   ongoing compliance-ийг бүрэн хариуцах; эсвэл
3. Stripe өөрөө Mongolia-г direct payments-д албан ёсоор нээсэн байх.

Хийж болохгүй зүйл:

- өөр хүний company/account ашиглах;
- хуурамч address, tax ID эсвэл nominee ашиглах;
- зөвхөн VPN/гадаад карттай гэдгээр availability requirement давсан гэж үзэх;
- test mode ажилласныг live account approved болсон гэж үзэх.

**Phase 0 exit gate:** live-capable Stripe account, payout bank, business verification болон
account capability бүгд Dashboard дээр баталгаатай байна. Энэ gate хаалттай бол кодыг sandbox-д
хөгжүүлж болно, харин production checkout-ыг нээхгүй.

---

## 3. Product, Price ба валютын загвар

### 3.1 Stripe catalog

Stripe дээр дараах Product/Price үүсгэнэ:

| BuildWatch plan | Stripe Product | Recurring Price |
|---|---|---|
| Starter | `BuildWatch Starter` | MONTH + YEAR |
| Business | `BuildWatch Business` | MONTH + YEAR |

Enterprise-д public Stripe Price үүсгэхгүй. Contract батлагдсаны дараа тусдаа private Price,
invoice эсвэл subscription үүсгэхийг дараагийн phase-д шийднэ.

### 3.2 Local catalog хэвээр үлдэнэ

`BillingPlan`, `PlanEntitlement`, `BillingProviderPrice` нь BuildWatch-ийн source of truth хэвээр.
Stripe Product/Price нь payment provider mapping байна.

```text
BillingPlan(code, version, interval, currency, unitAmountMinor)
       │
       └── BillingProviderPrice(
             provider = STRIPE,
             environment = test | live,
             externalProductId = prod_...,
             externalPriceId = price_...
           )
```

Frontend Stripe `price_...`, amount, currency илгээхгүй. Browser зөвхөн `planCode` ба
`interval` илгээнэ. Backend local allowlist-аас price mapping resolve хийнэ.

### 3.3 MNT amount

Stripe-ийн supported presentment currencies жагсаалтад MNT ордог бөгөөд MNT нь zero-decimal
currency-ийн жагсаалтад байхгүй. Өөрөөр хэлбэл API amount нь minor unit ашиглана:

```text
390,000.00 MNT  → 39,000,000 minor units
1,290,000.00 MNT → 129,000,000 minor units
```

Одоогийн Prisma comment мөн MNT-г 2-decimal minor unit гэж хадгалдаг тул энэ загвартай таарна.
Гэхдээ MNT presentment нь тухайн Stripe account country, card network, live capability дээр
бодитоор ажиллаж байгаа эсэхийг sandbox болон low-risk live charge-аар шалгана.

Хэрэв live account MNT recurring charge дэмжихгүй бол:

- public display MNT хэвээр байлгаад checkout USD amount-ийг чимээгүй hard-code хийхгүй;
- official FX/price policy баталж, USD-д тусдаа immutable plan version ба Stripe Price үүсгэнэ;
- checkout өмнө customer-д charge currency болон exact total-ийг ил тод харуулна.

---

## 4. Одоогийн кодоос Stripe рүү шилжих нөлөөлөл

Одоогийн billing foundation-ийг ашиглана, бүхнийг шинээр бичихгүй.

### 4.1 Schema өөрчлөлт

```prisma
enum BillingProviderKind {
  STRIPE
  LEMON_SQUEEZY // migration хугацаанд historical row уншихын тулд түр үлдээж болно
  PADDLE
  MANUAL_INVOICE
}
```

Хэрэв production financial history огт байхгүй бол unused provider enum/adapter-уудыг нэг цэвэр
migration-аар устгаж болно. Хэрэв ямар нэг provider row/event/invoice байгаа бол enum-г шууд
устгахгүй; historical read-only data retention plan гаргана.

Нэмэх/засах field-үүд:

- `CompanySignupIntent.providerCheckoutId` → Stripe Checkout Session ID;
- Stripe Customer ID `cus_...`;
- Stripe Subscription ID `sub_...`;
- Stripe Invoice ID `in_...`;
- `providerEventId = evt_...`;
- webhook-ийн recoverable normalized payload/secure reference;
- `nextAttemptAt`, lease, `deadLetteredAt`;
- provider API version/object updated timestamp;
- `lastReconciledAt` болон cursor;
- `PROVISIONING` signup status;
- paid tenant entitlement provenance.

### 4.2 Backend файлын өөрчлөлт

| Одоогийн файл | Шийдвэр |
|---|---|
| `billing-provider.ts` | Provider-neutral interface-г хадгалж Stripe-д шаардлагатай normalized fields нэмнэ |
| `billing-provider-lemon-squeezy.ts` | Runtime registry-ээс салгана; history байхгүй бол дараа нь устгана |
| `billing-provider-manual.ts` | Runtime registry-ээс бүрэн салгана |
| `billing-config.ts` | Stripe config + test/live validation болгоно |
| `billing-checkout-service.ts` | Stripe adapter registry, atomic checkout idempotency |
| `billing-price-resolver.ts` | `provider=STRIPE` mapping ашиглана |
| `billing-webhook-service.ts` | Stripe event normalization, retryable projector |
| `billing-signup-service.ts` | Stripe paid-only atomic provisioning |
| `billing-reconciliation.ts` | Stripe subscription/invoice/customer reconciliation |
| `tenant-billing-service.ts` | Stripe Customer Portal, cancel/resume/change plan |
| `runtime.ts` | Stripe provider wiring; manual/Lemon wiring хасна |

Шинээр:

- `agents/src/backend/billing-provider-stripe.ts`
- `agents/src/backend/billing-stripe-events.ts`
- `agents/src/backend/billing-webhook-worker.ts`
- `agents/src/scripts/seed-stripe-prices.ts`
- `agents/src/scripts/validate-stripe-catalog.ts`
- `agents/src/scripts/billing-webhook-worker.ts`

### 4.3 Dependency/config

Official Stripe Node SDK ашиглана; Stripe REST payload/parser-ийг гараар бүхэлд нь бичихгүй.
SDK version болон Stripe API version-ийг lock/pin хийнэ.

```dotenv
BILLING_PROVIDER=STRIPE
BILLING_ENVIRONMENT=test
BILLING_RETURN_URL_ALLOWLIST=http://127.0.0.1:4173
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_VERSION=<pinned-version>
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_AUTOMATIC_TAX_ENABLED=false
```

Production:

```dotenv
BILLING_PROVIDER=STRIPE
BILLING_ENVIRONMENT=live
BILLING_RETURN_URL_ALLOWLIST=https://<domain>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_VERSION=<same-pinned-version>
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_AUTOMATIC_TAX_ENABLED=<legal-decision>
```

Дүрэм:

- production + `sk_test_` → startup fail;
- non-production + `sk_live_` → startup fail;
- webhook secret API secret-тэй ижил байж болохгүй;
- secret client bundle, frontend env, log, error payload-д орохгүй;
- publishable key hosted Checkout redirect-only integration-д шаардлагагүй бол frontend-д нэмэхгүй.

---

## 5. Зорилтот Stripe architecture

```text
Pricing page
    │ planCode + interval
    ▼
Verified Company Signup Intent
    │
    ▼
POST /public/v1/company-signups/:id/checkout
    │ local price allowlist + Stripe idempotency key
    ▼
Stripe Checkout Session (mode=subscription)
    │ customer card payment
    ├──────── browser success_url ───────► confirmation/poll page only
    │
    └──────── signed Stripe events ─────► durable event inbox
                                                │
                                         retryable projector
                                                │ one transaction
                                                ▼
 Tenant + Customer + Subscription + Invoice + Entitlements + Audit
                                                │
                                                ▼
                                   One-time Company Admin setup
                                                │
                                                ▼
                                    Local tenant access policy
```

BuildWatch Stripe Connect marketplace биш. Нэг BuildWatch merchant account дээр BuildWatch
subscription-уудыг авна. Tenant тус бүр Stripe Connected Account болохгүй.

---

## 6. Checkout Session contract

Stripe Checkout Session үүсгэхдээ:

```ts
{
  mode: "subscription",
  line_items: [{ price: allowedStripePriceId, quantity: 1 }],
  customer_email: verifiedAdminEmail,
  client_reference_id: signupIntentId,
  metadata: {
    buildwatchSignupIntentId: signupIntentId,
    buildwatchPlanId: planId,
    buildwatchPlanVersion: String(planVersion)
  },
  subscription_data: {
    metadata: {
      buildwatchSignupIntentId: signupIntentId,
      buildwatchPlanId: planId
    }
  },
  success_url: "https://<domain>/checkout/success?session_id={CHECKOUT_SESSION_ID}",
  cancel_url: "https://<domain>/company-signup?signup=<opaque-id>&checkout=cancelled"
}
```

Энэ нь conceptual contract; SDK-ийн pinned API version-ийн exact type-оор хэрэгжүүлнэ.

### 6.1 Checkout idempotency

- Local command бүр stable operation ID үүсгэнэ.
- Stripe create session POST дээр `Idempotency-Key` өгнө.
- Key-г `stripe:checkout:<signupIntentId>:<planId>:<attemptGeneration>` хэлбэрээр hash/derive хийж болно.
- Ижил body/key retry нэг session үүсгэнэ.
- Plan/interval өөрчлөгдвөл хуучин open session-г reuse хийхгүй; new generation үүсгэнэ.
- Local `CHECKOUT_CREATING` lease хэрэглэж concurrent requests-ийг нэг болгоно.
- Network timeout болсон үед шинэ key-тай шууд дахин create хийхгүй; local operation ID/Stripe object-оор reconcile хийнэ.

### 6.2 Success page

- `{CHECKOUT_SESSION_ID}`-г Stripe placeholder-аар success URL-д оруулна.
- Success page session ID-г backend status endpoint рүү өгч болно, гэхдээ client session ID alone access grant хийхгүй.
- Backend session-г Stripe API-аас татаж, metadata/signup binding шалгаж status summary буцаана.
- Page `ACTIVE` болох хүртэл bounded backoff poll хийнэ.
- 5 минут өнгөрлөө гээд payment failed гэж таахгүй; `CONFIRMING` + support/retry state харуулна.
- URL query/local storage-д secret key, customer email, raw token хадгалахгүй.

---

## 7. Stripe webhook design

Endpoint:

```http
POST /webhooks/billing/STRIPE
```

### 7.1 Receive algorithm

1. `express.raw({ type: "application/json" })`-аар exact raw bytes авна.
2. Official SDK-ийн `constructEvent(rawBody, stripeSignature, webhookSecret)` ашиглана.
3. Signature invalid бол generic `400`; event хадгалахгүй.
4. Expected live/test mode, account/context, API version policy, object type-г шалгана.
5. Event ID + payload hash collision check хийнэ.
6. Safe normalized event эсвэл encrypted raw payload-ийг durable inbox-д хадгална.
7. Durable insert амжилттай бол хурдан `200` буцаана.
8. DB durable write амжилтгүй бол `5xx` буцааж Stripe retry хийх боломж үлдээнэ.
9. Complex provisioning webhook request thread дээр биш worker/projector дээр ажиллана.

Stripe official docs raw body шаардаж, webhook handler-ийг хурдан `2xx` буцаахыг зөвлөдөг.

### 7.2 MVP event allowlist

| Stripe event | BuildWatch action |
|---|---|
| `checkout.session.completed` | Checkout/signup/customer/subscription binding хадгалах; async method байвал payment complete гэж дангаар үзэхгүй |
| `checkout.session.async_payment_succeeded` | Хэрэв delayed method enabled бол paid projection үргэлжлүүлэх |
| `checkout.session.async_payment_failed` | Signup/payment failure state |
| `customer.subscription.created` | Subscription snapshot/update; paid access policy-г invoice state-тай тулгах |
| `customer.subscription.updated` | Status, price, period, cancel flag sync |
| `customer.subscription.deleted` | Cancellation/expiration sync |
| `invoice.paid` | Paid evidence; activation/renewal/recovery |
| `invoice.payment_failed` | Fixed grace deadline + notification |
| `invoice.finalized` | Invoice metadata/hosted URL sync |
| `invoice.voided` | Invoice state sync |
| `credit_note.created` | Refund/credit ledger sync |
| `charge.refunded` | Refund policy projection |
| `charge.dispute.created` | Security/chargeback policy, possible suspension review |
| `charge.dispute.closed` | Dispute resolution/reversal sync |

Эхний access grant-ийн authoritative rule:

- subscription mode Checkout Session signup intent-тэй exact bound;
- Stripe Customer/Subscription/Price mapping таарсан;
- relevant invoice нь `paid=true`/`status=paid` буюу explicitly approved trial policy;
- amount, currency, line items local purchased plan-тай таарсан;
- event live/test account environment таарсан;
- нэг canonical tenant subscription constraint зөрчөөгүй.

`checkout.session.completed` дангаараа бүх payment method-д paid гэсэн баталгаа биш.

### 7.3 Ordering ба idempotency

- Stripe event delivery order-д найдахгүй.
- Event `(created, id)`-г diagnostics-д ашиглах боловч provider object-ийг шаардлагатай үед Stripe API-аас retrieve хийж authoritative snapshot авна.
- Local transition allowlist ба provider object `status`, period, price-г хамтад нь шалгана.
- Ижил `evt_...` + ижил hash → no-op.
- Ижил `evt_...` + өөр hash → security incident.
- Event бүрийн projection exactly-once local effect үүсгэнэ.
- `FAILED/PROCESSING` lease reclaim, retry/backoff, DLQ заавал байна.

---

## 8. Atomic paid tenant provisioning

Нэг transaction-д:

1. Signup intent row lock/CAS → `PROVISIONING`.
2. Stripe event/session/customer/subscription/price/invoice binding шалгах.
3. Tenant `ACTIVE` үүсгэх.
4. BillingCustomer `provider=STRIPE`, `providerCustomerId=cus_...` үүсгэх.
5. TenantSubscription `sub_...` үүсгэх.
6. Paid BillingInvoice `in_...` upsert хийх.
7. Худалдаж авсан DB `BillingPlan` + `PlanEntitlement` row-оос snapshot үүсгэх.
8. Initial Company Admin `INVITED` үүсгэх.
9. One-time setup token hash үүсгэх.
10. Tenant audit болон billing event projection marker үүсгэх.
11. Intent `COMPLETED + completedTenantId` set хийх.

Transaction rollback бол бүх entity rollback; inbox event retryable хэвээр байна.

Provision хийхгүй нөхцөл:

- unpaid/open/incomplete invoice;
- `incomplete`, `incomplete_expired`, unpaid/past_due initial subscription;
- wrong Price/Product/currency/amount;
- wrong signup metadata/session;
- test event live runtime-д эсвэл эсрэгээр;
- expired/abandoned/already completed intent;
- unknown/unpublished plan mapping.

Email commit-ийн дараа queue-ээр явна. Email failure payment transaction-ийг rollback хийхгүй.

---

## 9. Paid Company Admin account setup

Одоогийн `/register?setup=...` handoff ажиллахгүй байгаа тул тусдаа flow хийнэ.

```http
POST /public/v1/account-setups/preview
POST /public/v1/account-setups/complete
POST /public/v1/account-setups/resend
```

Frontend:

```text
/setup-account?token=<one-time-token>
```

`complete` transaction:

- token hash-аар unexpired/unconsumed record олох;
- exact user/tenant binding;
- password policy;
- credential create;
- user `ACTIVE`, email verified;
- token consume;
- audit;
- replay/expired үед generic error.

Raw token/password log, audit metadata, analytics, referrer рүү гарахгүй. Page third-party analytics
ачаалахгүй эсвэл token URL-ээс history replace-ээр шууд арилгана.

---

## 10. Subscription lifecycle ба tenant access

Stripe status-ийг BuildWatch canonical status руу explicit map хийнэ.

| Stripe status/event | Local subscription | Tenant lifecycle |
|---|---|---|
| Paid active | `ACTIVE` | `ACTIVE` |
| Approved trial | `TRIALING` | `ACTIVE` |
| Initial incomplete | `PENDING` | `PENDING_PAYMENT` |
| `past_due` / `invoice.payment_failed` | `PAST_DUE` | `PAYMENT_GRACE` |
| `paused` | `PAUSED` | `SUSPENDED` |
| canceled/deleted at paid-through end | `CANCELED` | `SUSPENDED` |
| `incomplete_expired` / expired | `EXPIRED` | `SUSPENDED` эсвэл unprovisioned intent |

Access matrix:

| Lifecycle | Read | Write | AI | Billing/portal/export |
|---|---:|---:|---:|---:|
| `PENDING_PAYMENT` | Үгүй | Үгүй | Үгүй | Тийм |
| `ACTIVE` | Тийм | Тийм | Тийм | Тийм |
| `PAYMENT_GRACE` | Тийм | Тийм | Тийм | Тийм |
| `SUSPENDED` | Тийм | Үгүй | Үгүй | Тийм |
| `ARCHIVED` | Үгүй | Үгүй | Үгүй | Үгүй |

- Grace default 7 өдөр; нэг failure occurrence дээр fixed deadline, retry болгонд сунгахгүй.
- Request-time gate deadline өнгөрмөгц write/AI-г шууд хориглоно.
- Lifecycle sweeper DB-г `SUSPENDED` болгож audit/email үүсгэнэ.
- `invoice.paid` recovery access-ийг шууд сэргээнэ.
- Stripe outage ACTIVE tenant-ийг mass-suspend хийхгүй.
- Cancel at period end нь current paid-through date хүртэл access хадгална.

---

## 11. Stripe Customer Portal

Company Admin `/admin/billing`-оос backend нэг удаагийн portal session үүсгээд Stripe-hosted
Customer Portal руу redirect хийнэ.

Portal MVP permissions:

- payment method update;
- invoice view/download;
- billing information update;
- cancel at period end;
- subscription resume боломжтой configuration;
- plan change-ийг Phase 4 хүртэл disabled байлгаж болно.

Дүрэм:

- Portal session-ийг зөвхөн `TENANT_BILLING_MANAGE` үүсгэнэ.
- Client Stripe Customer ID илгээхгүй; backend tenant-ийн BillingCustomer-аас авна.
- Return URL allowlist-тай.
- Portal session URL-г DB/log-д удаан хадгалахгүй.
- Popup block-оос сэргийлж same-window redirect эсвэл user-click дээр шууд navigation хэрэглэнэ.
- Portal webhook event-үүд local subscription state-г шинэчилнэ.

---

## 12. Tax, invoice, refund, dispute

Stripe Payments/Billing ашиглах үед BuildWatch-ийн operator entity нь merchant байна. Stripe Tax
идэвхжүүлсэн ч legal/tax registration үүргийг автоматаар бүрэн арилгахгүй.

Phase 0 дээр:

- business seller country;
- customer billing countries;
- tax registration obligation;
- price tax-inclusive/exclusive;
- invoice wording;
- Монгол хэрэглэгчийн НӨАТ/eBarimt requirement;
- refund policy;
- chargeback policy-г accountant/legal-аар батална.

Stripe Tax ашиглавал Checkout Session-д automatic tax болон billing address/tax ID collection
provider/account eligibility-тэй нь тохируулна. Local invoice ledger provider invoice-г хуулж
хадгалах боловч Stripe-ийн event/version-ийг буруу тааж overwrite хийхгүй.

Local ledger-д:

- subtotal;
- discount;
- tax;
- total;
- amount paid;
- amount remaining;
- refunded amount;
- currency;
- hosted invoice URL;
- credit note/refund/dispute adjustment;
- provider object/version timestamp байна.

Full/partial refund, credit note, dispute created/won/lost нь immutable adjustment event үүсгэнэ.
Access policy-г legal decision-ээр explicit map хийх хүртэл automatic full refund/chargeback
suspension-ийг production-д асаахгүй.

---

## 13. Existing tenant ба plan change

Public `/company-signup` нь шинэ tenant-д зориулагдана. Existing tenant:

```http
GET  /v1/billing/plans
POST /v1/billing/checkout
POST /v1/billing/portal
POST /v1/billing/change-plan/preview
POST /v1/billing/change-plan
POST /v1/billing/resume
POST /v1/billing/cancel
```

- No subscription/PENDING_PAYMENT tenant authenticated checkout эхлүүлж чадна.
- Нэвтэрсэн хэрэглэгч marketing pricing CTA дарахад “одоогийн workspace” ба “шинэ company”
  сонголтыг ялгана.
- Upgrade/downgrade preview нь proration, credit, effective date, next invoice-г Stripe-с
  authoritative байдлаар үзүүлнэ.
- Upgrade immediate; downgrade default period end.
- Current usage target limit-ээс их бол downgrade deny.
- Stripe POST бүр stable idempotency key-тай.
- Local command/audit нь provider request ID болон correlation ID хадгална; secret хадгалахгүй.

---

## 14. Reconciliation ба background jobs

| Job | Давтамж | Үүрэг |
|---|---|---|
| Stripe webhook projector | Continuous/1 мин | Event lease, projection, retry, DLQ |
| Lifecycle sweeper | 5–15 мин | Grace/cancel deadline persist, notification |
| Stripe reconciliation | Daily + manual | Customer/subscription/price/period/invoice/entitlement repair |
| Signup cleanup | Daily | Expired/abandoned intent cleanup |
| Email retry | Continuous | Verification/setup/dunning email retry |

Reconciliation:

- cursor/pagination ашиглана;
- `lastReconciledAt`-аар starvation-гүй сонгоно;
- status, price, quantity, currency, period, cancel flag, customer ID, latest invoice,
  entitlement snapshot шалгана;
- provider unavailable бол no access mutation;
- mismatch repair audit үүсгэнэ;
- Stripe webhook resend/event retrieval-ийг operator tooling-оор ашиглаж болно.

---

## 15. Frontend шаардлага

### Public

- MONTH/YEAR selector сонголтоо CTA-д хадгална.
- Plan, exact amount, currency, interval, tax wording order summary дээр харагдана.
- Card-аар төлөх нэг үндсэн CTA байна; QPay/банк сонголт байхгүй.
- Verification deep link auto-resume.
- Resend verification, expired token, canceled checkout, confirming, failed state.
- Checkout success нь backend projection-ийг poll хийнэ.
- Account setup email resend болон `/setup-account` page.

### Company Admin

- Current plan/status/renewal/grace deadline.
- Usage/entitlements; unknown-г zero/unlimited гэж харуулахгүй.
- `Stripe төлбөр удирдах` portal CTA.
- Invoice list/link.
- App-wide grace/suspended banner.
- `TENANT_BILLING_READ` хэрэглэгч manage action харахгүй.
- Cancel/plan change impact preview.

### Platform Super Admin

- Active/grace/suspended/canceled counts.
- Stripe event inbox, retry, DLQ, oldest age.
- Provisioning stuck, reconciliation mismatch.
- Invoice/payment failure/dispute visibility.
- Secret/raw card/raw webhook payload харахгүй.
- Platform admin tenant operational actions хийхгүй.

---

## 16. Security non-negotiables

1. Card/PAN/CVC BuildWatch серверээр дамжихгүй.
2. Stripe secret key зөвхөн backend secret store-д.
3. Client price ID/amount/currency/customer ID-д итгэхгүй.
4. Webhook exact raw bytes + `Stripe-Signature` verify.
5. Test/live keys, webhook endpoint, Price IDs тусдаа.
6. Stripe API version pinned.
7. Stripe POST бүр idempotency key-тай.
8. Checkout metadata opaque internal ID-тай; PII/secret агуулахгүй.
9. Return/cancel/portal URL exact HTTPS allowlist-тай.
10. Paid evidence exact signup/session/customer/subscription/price/invoice binding-тай.
11. Tenant object authorization `(tenantId, id)`; cross-tenant IDOR test.
12. Setup/verification tokens hash-only, single-use, TTL.
13. Logs/audit-д secret, signature, raw payload, token, full billing email, portal URL байхгүй.
14. Paid entitlement corrupt/missing үед premium access fail-closed.
15. Provider outage mass suspension үүсгэхгүй.
16. Refund/plan change/access override high-impact command reason, confirmation, audit-тай.

---

## 17. Phase roadmap

### 17.0 Implementation progress — 2026-08-14

- ✅ SMTP configuration шалгагдсан: connection + authentication амжилттай.
- ✅ 6 оронтой email verification code, 10 минутын TTL, 5 оролдлого, 60 секундийн resend,
  хуучин code invalidation, production-д code response/log-оос нуугдсан.
- ✅ Official Stripe Node SDK, pinned API version, `STRIPE` enum/config/migration, hosted
  subscription Checkout, Customer Portal, raw-body signature verification, outbound
  idempotency key нэмэгдсэн.
- ✅ Stripe webhook sandbox/live boundary, Price + Product allowlist binding, зөвхөн
  exact paid Checkout Session-оос retrieve хийсэн `ACTIVE` subscription tenant provision
  хийх хамгаалалт нэмэгдсэн. Subscription metadata дангаараа tenant нээхгүй.
- ✅ Signup claim болон tenant/customer/subscription/admin/token/entitlement/audit provisioning
  нэг DB transaction болсон.
- ✅ Paid Company Admin-ийн нэг удаагийн account setup API + `/register?setup=...&tenant=...`
  UI нэмэгдсэн; token hash-only, tenant-bound, TTL, replay хамгаалалттай.
- ✅ Stripe Price mapping script нь Stripe API-аас active/currency/amount/recurring interval/product
  шалгасны дараа л local allowlist-д бичдэг болсон; sandbox Starter/Business MONTH/YEAR 4/4
  Price mapping баталгаажиж DB-д орсон.
- ✅ Entitlement snapshot нь in-code catalog руу fallback хийхгүй, яг худалдаж авсан
  `BillingPlan` + `PlanEntitlement` DB rows-оос үүснэ; key дутуу/илүү/эвдэрсэн бол paid
  provisioning transaction fail-closed rollback хийнэ.
- ✅ Sandbox Stripe Checkout endpoint `cs_test_...` session үүсгэж `checkout.stripe.com` руу
  чиглүүлж байна; legacy intent provider cutover болон duplicate checkout reuse засагдсан.
- ✅ Локал migration амжилттай; хамгийн сүүлийн billing security/domain/provider regression
  106/106, backend typecheck амжилттай. Frontend setup/signup regression өмнөх gate дээр 11/11.
- ⏳ User/Stripe Dashboard: test-mode webhook endpoint/Stripe CLI forwarding-оос гарсан
  `whsec_...` утгыг `STRIPE_WEBHOOK_SECRET`-д оруулах үлдсэн. Secret орох хүртэл Checkout
  нээгдэх боловч төлбөр tenant access идэвхжүүлэхгүй.
- ⏳ Дараагийн кодын phase: durable webhook retry worker/lease/DLQ, lifecycle sweeper,
  sandbox payment → webhook → account setup → login browser E2E.

### Phase 0 — Stripe feasibility ба commercial freeze

**Ажил**

- Supported-country legal entity, bank, tax, Stripe live eligibility батлах.
- Starter/Business MNT monthly/yearly price freeze.
- MNT presentment ба settlement/FX behavior батлах.
- Tax-inclusive/exclusive, Stripe Tax, invoice, refund, grace policy review.
- Stripe account security: MFA, least privilege, no shared admin.
- QPay/manual invoice/Lemon Squeezy public copy болон plan-оос хасах.

**Exit gate**

- Live-capable Stripe account approved.
- Commercial/legal decision record signed.
- Terms/Privacy/Refund draft биш.
- MNT эсвэл approved alternate currency exact policy байна.

### Phase 1 — Stripe foundation migration

**Ажил**

- Stripe SDK dependency + API version pin.
- `STRIPE` provider enum/config/schema migration.
- `billing-provider-stripe.ts` adapter.
- Test Product/Price 4 mapping.
- Stripe Checkout Session create/retrieve.
- Stripe Customer Portal session.
- Manual/Lemon runtime wiring салгах.
- Config/secrets release validation.

**Exit gate**

- Test mode checkout үүсэж Stripe-hosted page нээгдэнэ.
- Client amount/Price ID өөрчилж чадахгүй.
- Duplicate click 1 Checkout Session үүсгэнэ.

### Phase 2 — P0 onboarding ба payment integrity

**Ажил**

- Verification link resume.
- Correlated success/cancel URL.
- `/setup-account` API/page.
- `PROVISIONING` state + atomic paid tenant transaction.
- Exact paid-event binding.
- DB PlanEntitlement snapshot.
- Corrupt paid snapshot fail-closed.
- Checkout create lease/idempotency.

**Exit gate**

- New company: signup → verify → pay → webhook → setup password → login бүтэн ажиллана.
- Unpaid/forged/wrong Price event tenant үүсгэхгүй.
- Transaction failure partial tenant үлдээхгүй.

### Phase 3 — Durable Stripe webhooks

**Ажил**

- Raw signature endpoint.
- Normalized/encrypted durable inbox.
- Projector worker, lease, backoff, DLQ.
- Collision detection.
- Out-of-order transition guards.
- Platform webhook health/retry tooling.
- Stripe CLI event tests.

**Exit gate**

- Same event 20x → one local effect.
- Crash recovery exactly once completes.
- Poison event DLQ-д орж бусад event-ийг гацаахгүй.

### Phase 4 — Renewal, dunning, portal

**Ажил**

- `invoice.paid`, `invoice.payment_failed`, subscription update/delete mapping.
- Fixed grace deadline.
- Lifecycle sweeper.
- Stripe Customer Portal.
- Cancel at period end + resume.
- Global grace/suspended UI.
- Email retry/dunning.

**Exit gate**

- Test Clock/Simulation-аар renewal success, failure, recovery, cancellation passed.
- Suspended tenant read/billing access хадгалж write/AI deny.

### Phase 5 — Existing tenant ба plan lifecycle

**Ажил**

- Existing tenant first checkout.
- Upgrade/downgrade preview.
- Proration/credit policy.
- Target-plan limit validation.
- Customer Portal plan management тохируулах эсвэл custom API ашиглах.
- Reconciliation full material fields.

**Exit gate**

- Upgrade/downgrade duplicateгүй, audited.
- Missed webhook reconciliation-аар засагдана.

### Phase 6 — Refund, dispute, tax, quota

**Ажил**

- Credit note/refund/dispute ledger.
- Explicit access policy.
- Stripe Tax/accounting integration.
- Project/user/storage/AI atomic quota reservation.
- Overage-ийг зөвхөн тусдаа commercial decision дараа Stripe meters/invoice руу холбох.

**Exit gate**

- Refund/dispute lifecycle legal policy-тэй таарсан.
- Concurrency plan limit хэтрүүлэхгүй.
- Invoice/tax reconciliation passed.

### Phase 7 — Production rollout

**Ажил**

- Stripe sandbox/test mode E2E.
- Test Clocks lifecycle simulation.
- Internal tenant canary.
- Low-risk live payment/refund.
- 1–3 pilot company.
- Provider outage, webhook delay, backup/restore drills.
- Alerts, runbook, kill switches.

**Exit gate**

- Live purchase → renewal/recovery/cancel бодитоор шалгагдсан.
- No unresolved P0/P1 billing issue.
- Rollback/new-checkout kill switch tested.

---

## 18. API зорилтот contract

### Public

| Method | Endpoint |
|---|---|
| GET | `/public/v1/plans` |
| POST | `/public/v1/company-signups` |
| POST | `/public/v1/company-signups/:id/verify-email` |
| POST | `/public/v1/company-signups/:id/resend-verification` |
| GET | `/public/v1/company-signups/:id/summary` |
| POST | `/public/v1/company-signups/:id/checkout` |
| GET | `/public/v1/company-signups/:id/status` |
| POST | `/public/v1/account-setups/preview` |
| POST | `/public/v1/account-setups/complete` |
| POST | `/public/v1/account-setups/resend` |

### Stripe

| Method | Endpoint |
|---|---|
| POST | `/webhooks/billing/STRIPE` |

### Tenant

| Permission | Endpoint |
|---|---|
| READ | subscription, plans, usage, entitlements, invoices |
| MANAGE | checkout, portal, change preview/commit, cancel, resume |

### Platform

| Permission | Endpoint |
|---|---|
| READ | overview, subscriptions, invoices, events, DLQ, reconciliation |
| MANAGE | replay/reconcile controlled command, temporary access override |

---

## 19. Minimum acceptance tests

### Stripe authenticity

- Missing/forged `Stripe-Signature` → 400, no inbox/tenant.
- Altered raw body → signature fail.
- Test event live runtime-д → reject.
- Wrong account/context/Product/Price/session/intent/customer/subscription/invoice → no activation.
- Unpaid Checkout completed → no activation.
- Browser success URL-г шууд нээх → no activation.

### Idempotency/recovery

- Same event 20 concurrent deliveries → one tenant/subscription/invoice/snapshot/audit.
- Same event ID different hash → security alert.
- Concurrent checkout clicks → one Stripe Session.
- Stripe API timeout → same idempotency operation duplicate үүсгэхгүй.
- Inbox insert дараа crash → lease retry completes.
- Projection transaction failure → partial tenantгүй.

### Lifecycle

- Paid activation.
- Renewal paid.
- Payment failed → grace.
- Grace recovery.
- Grace expiry → persisted suspension.
- Cancel at period end.
- Resume before period end.
- Out-of-order event state regress хийхгүй.
- Stripe unavailable үед ACTIVE tenant ажиллана.

### Account UX

- Verification deep link resume.
- Verification/setup token single-use, expiry, tenant binding.
- Success page exact session/signup poll.
- Password set дараа login.
- SMTP failure transaction rollback хийхгүй; resend works.

### Isolation/permissions

- Tenant A Tenant B invoice/subscription/portal session авч чадахгүй.
- READ-only role manage action/API ашиглахгүй.
- Platform token tenant operational endpoint-д 403.
- Suspended tenant read/billing allowed, write/AI denied.
- Corrupt paid entitlement unlimited болохгүй.

### Currency/tax

- MNT minor unit exact.
- Local plan amount/Stripe Price amount mismatch deploy дээр fail.
- Checkout currency UI-тэй таарна.
- Tax enabled/disabled behavior legal config-тэй таарна.
- Refund/credit/dispute local ledger-д duplicateгүй.

---

## 20. Monitoring ба alert

Metrics:

- checkout created/failed;
- Stripe API latency/error/retry;
- webhook received/invalid/duplicate/processing time;
- webhook failed/DLQ/oldest age;
- provisioning stuck;
- reconciliation mismatch;
- active/grace/suspended subscription;
- invoice paid/failed;
- dispute/refund;
- account setup email failed.

Critical alerts:

- paid invoice боловч tenant provision болоогүй;
- DLQ > 0;
- webhook oldest PROCESSING threshold давсан;
- live Product/Price mapping incomplete;
- paid tenant entitlement missing/corrupt;
- Stripe outage/reconciliation mismatch spike;
- secret/test-live configuration drift.

---

## 21. Production checklist

- [ ] Supported-country legal entity ба bank account verified.
- [ ] Stripe live account payment capability active.
- [ ] Account owners MFA-тай, shared accountгүй.
- [ ] Starter/Business MONTH/YEAR live Product/Price 4/4.
- [ ] Local `BillingProviderPrice` 4/4 exact mapping.
- [ ] MNT presentment live supported; үгүй бол approved alternate currency plan version.
- [ ] Webhook endpoint HTTPS, correct event allowlist, live `whsec_...`.
- [ ] Customer Portal configured.
- [ ] Stripe Tax decision configured.
- [ ] Terms/Privacy/Refund/Tax legal review completed.
- [ ] Secrets production secret store-д.
- [ ] Webhook worker, sweeper, reconciliation scheduler active.
- [ ] Test Clock lifecycle suite green.
- [ ] Browser E2E, backend, Postgres, IDOR, concurrency suite green.
- [ ] Low-risk live purchase/refund passed.
- [ ] Alert/runbook/on-call owner configured.
- [ ] New-checkout kill switch tested.

Production env minimum:

```dotenv
BILLING_PROVIDER=STRIPE
BILLING_ENVIRONMENT=live
BILLING_RETURN_URL_ALLOWLIST=https://<domain>
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_API_VERSION=<pinned-version>
STRIPE_PORTAL_CONFIGURATION_ID=bpc_...
STRIPE_AUTOMATIC_TAX_ENABLED=<true-or-false>
```

---

## 22. Rollout ба rollback

Rollout:

1. Unit/provider fixtures.
2. Stripe sandbox/test mode.
3. Stripe CLI webhook forwarding.
4. Test Clocks subscription lifecycle.
5. Internal tenant.
6. One low-risk live transaction.
7. 1–3 pilot tenant.
8. Public launch.

Kill switches:

- new signup;
- checkout create;
- existing tenant first purchase;
- plan change;
- overage;
- automatic refund access action.

Kill switch webhook intake, reconciliation, billing portal, existing ACTIVE tenant access-ийг
хамт хаахгүй.

Rollback:

- provider/API issue үед шинэ checkout pause;
- local ACTIVE tenant access хэвээр;
- durable event intake/worker боломжтой бол үргэлжилнэ;
- financial rows hard-delete хийхгүй;
- forward-fix migration ба reconciliation ашиглана;
- Lemon/manual provider руу автомат fallback хийхгүй, учир нь энэ roadmap Stripe-only.

---

## 23. Definition of Done

- [ ] Stripe legal/account eligibility gate passed.
- [ ] QPay/manual/Lemon public billing path байхгүй.
- [ ] Signup → Stripe payment → webhook → tenant → setup → login E2E green.
- [ ] Browser redirect access grant хийхгүй.
- [ ] Exact paid object binding implemented.
- [ ] Stripe POST idempotency + local concurrency lease implemented.
- [ ] Webhook raw signature, inbox, retry, lease, DLQ implemented.
- [ ] Atomic provisioning partial state үлдээхгүй.
- [ ] Verification/setup token single-use.
- [ ] Renewal/failure/grace/recovery/cancel/resume tested.
- [ ] Customer Portal tenant-scoped.
- [ ] Entitlement snapshot purchased DB plan-аас.
- [ ] Paid corrupt snapshot fail-closed.
- [ ] Reconciliation material fields repair хийдэг.
- [ ] Tax/refund/dispute policy reviewed and reflected.
- [ ] Tenant/platform permission and IDOR tests green.
- [ ] Provider outage mass suspension үүсгэдэггүй.
- [ ] Metrics, alerts, runbook, backup/restore drill ready.

---

## 24. Яг одоо хийх дараалал

1. Stripe-supported legal entity/live account боломжоо нотлох.
2. `BillingProviderKind.STRIPE` schema migration хийх.
3. Stripe SDK, pinned API version, config validation нэмэх.
4. Test Product/Price 4-ийг үүсгэж local mapping хийх.
5. `billing-provider-stripe.ts` Checkout/Portal/subscription adapter хийх.
6. Verification deep link болон `/setup-account` тасарсан урсгал засах.
7. Checkout success/cancel correlation хийх.
8. Atomic `PROVISIONING` state machine хийх.
9. Paid-only exact Stripe binding хийх.
10. Durable webhook inbox/worker/retry/DLQ хийх.
11. DB entitlement snapshot ба corrupt-state хамгаалалт хийх.
12. Renewal/grace/suspension sweeper хийх.
13. Customer Portal ба tenant billing UX хийх.
14. Stripe CLI + Test Clock E2E ногоон болгох.
15. Existing tenant checkout/plan lifecycle хийх.
16. Refund/dispute/tax/quota-г дараагийн phase-д хийх.

Эхний 10 алхам нь “мөнгө төлөөгүй tenant ACTIVE болох” болон “мөнгө төлсөн ч tenant/login
үүсэхгүй” гэсэн хамгийн өндөр эрсдэлийг түрүүлж хаана.

---

## 25. Official Stripe sources

- [Stripe global availability](https://stripe.com/global)
- [Stripe Checkout](https://docs.stripe.com/payments/checkout)
- [Build subscriptions with Stripe](https://docs.stripe.com/billing/subscriptions/build-subscriptions)
- [Stripe webhooks](https://docs.stripe.com/webhooks)
- [Stripe subscription webhook events](https://docs.stripe.com/billing/subscriptions/webhooks)
- [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- [Stripe supported currencies](https://docs.stripe.com/currencies)
- [Stripe Customer Portal](https://docs.stripe.com/customer-management)
- [Stripe cancellation](https://docs.stripe.com/billing/subscriptions/cancel)
- [Stripe prorations](https://docs.stripe.com/billing/subscriptions/prorations)
- [Stripe Tax with Checkout](https://docs.stripe.com/tax/checkout)
- [Stripe testing](https://docs.stripe.com/testing)
- [Stripe Billing simulations/Test Clocks](https://docs.stripe.com/billing/testing/test-clocks)

Provider availability, API version, events, currency болон tax behavior өөрчлөгдөж болно.
Implementation эхлэх, sandbox release, live launch бүрийн өмнө official docs ба Stripe Dashboard
capability-г дахин шалгана.
