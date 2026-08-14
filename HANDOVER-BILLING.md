# BuildWatch billing — таны хийх ёстой зүйлс

**Огноо:** 2026-08-12
**Хамрах хүрээ:** `landing-page-roadmap.md` Phase 0–10-ийн хэрэгжилтийн дараах үлдэгдэл
**Товч:** Кодын тал дууссан. Үлдсэн бүх зүйл нь **гадны бүртгэл, гэрээ, хуулийн хяналт** — кодоор шийдэгдэхгүй.

> Өмнөх хувилбарт "SMTP холбох" гэсэн блоклогч техникийн ажил байсан. Энэ нь одоо
> хийгдсэн — та зөвхөн серверийн мэдээллээ өгнө.

---

## 1. Заавал — үүнгүйгээр төлбөр авах боломжгүй

### 1.1 Lemon Squeezy дэлгүүр

Картын суваг бүхэлдээ энэ дээр тогтоно.

1. lemonsqueezy.com дээр бүртгүүлж, KYC/payout мэдээллээ бөглөнө (Монголын банкны данс).
2. Дэлгүүр дотор **1 product** үүсгээд **4 variant** нэмнэ:

   | Variant | Үнэ | Давтамж |
   |---|---|---|
   | Starter сар | ≈$111 (390,000₮) | Monthly |
   | Starter жил | ≈$1,110 | Yearly |
   | Business сар | ≈$369 (1,290,000₮) | Monthly |
   | Business жил | ≈$3,690 | Yearly |

3. Webhook: `https://<таны домэйн>/webhooks/billing/LEMON_SQUEEZY`, дараах event-үүдтэй:
   `subscription_created`, `subscription_updated`, `subscription_cancelled`,
   `subscription_expired`, `subscription_paused`, `subscription_unpaused`,
   `subscription_payment_success`, `subscription_payment_failed`,
   `subscription_payment_recovered`.
4. API key, Store ID, Webhook signing secret авна.

### 1.2 Variant ID-г системд оруулах

```sql
-- <PRODUCT_ID>, <VARIANT_ID>-г LS-ээс авсан утгаар солино. 4 багц бүрд давтана.
INSERT INTO "BillingProviderPrice"
  (id, "planId", provider, "externalProductId", "externalPriceId", environment)
SELECT gen_random_uuid()::text, p.id, 'LEMON_SQUEEZY', '<PRODUCT_ID>', '<VARIANT_ID>', 'live'
FROM "BillingPlan" p
WHERE p.code = 'starter' AND p.interval = 'MONTH' AND p.version = 1;
```

> Эдгээр ID нь таны бодит дэлгүүрт л үүсдэг. Зохиосон ID оруулбал checkout чимээгүйгээр
> буруу зүйл рүү заана.

### 1.3 Орчны хувьсагч

`.env.production` дотор (загвар нь `.env.production.example`-д):

```
BILLING_PROVIDER=LEMON_SQUEEZY
BILLING_ENVIRONMENT=live
BILLING_MANUAL_INVOICE_ENABLED=true
BILLING_RETURN_URL_ALLOWLIST=https://<таны домэйн>
LEMON_SQUEEZY_API_KEY=...
LEMON_SQUEEZY_STORE_ID=...
LEMON_SQUEEZY_WEBHOOK_SECRET=...

SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=no-reply@<таны домэйн>
```

**Дүрмүүд:**
- Webhook secret нь API key болон бусад signing secret-үүдээс **өөр** байх ёстой —
  `pnpm run ops:config:v22` шалгаж, зөрчилтэй бол release зогсоно.
- Production дээр `BILLING_ENVIRONMENT=sandbox` тавьбал сервер **асахгүй**. Санаатай.
- SMTP байхгүй бол сервер асна, гэхдээ шинэ компанийн админ нууц үг тохируулах
  холбоосоо авахгүй.

### 1.4 Хуульчийн хяналт

`/terms`, `/privacy` хуудсанд бодлого бичигдсэн (grace 7 хоног, цуцлалт хугацааны эцэст,
жилийн багцад 14 хоногийн буцаалт, 90 хоногийн экспорт). Хуудсан дээр "ноорог"
анхааруулга байгаа. Бодит төлбөр авахаас өмнө хуульчаар хянуулна.

**Phase 0-ийн 11 шийдвэрээс энэ ганцхан нь нээлттэй хэвээр.**

### 1.5 Домэйн орлуулах

`agent-console/public/robots.txt` болон `sitemap.xml` дотор
`REPLACE-WITH-YOUR-DOMAIN` гэсэн орлуулагч байгаа — бодит домэйнээр солино.

Мөн `/contact` хуудасны `sales@buildwatch.mn` нь загварын хаяг.

---

## 2. Заавал — үйл ажиллагааны

### 2.1 Plan catalog-ийг production DB-д seed хийх

```
pnpm run seed:billing:plans -- --environment live
```

Idempotent. Subscriber-тэй plan version-ыг дахин үнэлэхээс татгалзана.

### 2.2 Хуваарьт ажил (cron)

```
pnpm run billing:maintenance
```

Өдөрт нэг удаа ажиллуулна. Гурван зүйл хийнэ:
- Захиалгыг provider-тэй тулгаж, алдагдсан webhook-ийг нөхнө;
- Хугацаа дууссан access override-ыг хаана;
- Баталгаажаагүй signup intent-ийг цэвэрлэнэ.

Provider холбогдохгүй бол **юу ч өөрчлөхгүй** — `UNKNOWN` гэж мэдээлнэ. Provider-ийн
доголдол олон tenant-ыг хаах шалтгаан болохгүй.

### 2.3 Дотоодын нэхэмжлэх

Дансаар төлөх суваг бүрэн ажиллана. Платформ админ `/platform/billing` дээрээс
гүйлгээний дугаар, дүн, НӨАТ, хугацаа, шалтгаан оруулж баталгаажуулна. Систем
нэхэмжлэх үүсгэж, захиалгыг идэвхжүүлж, `PlatformAuditLog`-д бичнэ.

Картын захиалгыг гараар баталгаажуулах боломжгүй — зөвхөн `MANUAL_INVOICE`.

---

## 3. Хийгээгүй үлдээсэн зүйлс

| Юу | Яагаад | Эрсдэл |
|---|---|---|
| **Refund урсгал** | Бодлого тодорхой, LS-ийн refund API-тай холбогдоогүй | Буцаалтыг LS дээрээс гараар хийнэ |
| **Overage автомат нэхэмжлэх** | Дүн тооцоологдож дэлгэц дээр харагдана; provider руу нэмэлт төлбөр илгээх нь LS-ийн API-аас хамаарна | Business tenant-ийн overage-ыг гараар нэхэмжилнэ |
| **Plan publish/archive UI** | Seed script-ээр удирдагдана | Үнэ өөрчлөхөд deploy шаардана |
| **Хэрэглэгч/AI-ийн concurrent reservation** | Төсөл ба хадгалалтынх хийгдсэн | Хэрэглэгчийг хүн нэг нэгээр урьдаг, AI-д micro-USD backstop бий тул эрсдэл бага |
| **Analytics** | Consent bodlogo батлагдаагүй (§15.3) | Funnel хэмжигдэхгүй |
| **Provider outage drill** | Гараар хийх дасгал | — |
| **Backup/restore reconciliation** | Одоогийн backup процесстой уялдуулах шаардлагатай | — |

---

## 4. Баталгаажуулах тушаалууд

```bash
cd agents
pnpm exec vitest run                 # 901 тест
pnpm run smoke:billing:postgres      # 18 DB invariant
pnpm run smoke:billing:lifecycle     # 13 бүтэн мөчлөгийн шалгалт
pnpm run security:secrets:v22        # нууц түлхүүрийн скан
pnpm run billing:maintenance         # reconciliation + cleanup
pnpm run ops:config:v22 -- --env .env.production   # release gate

cd ../agent-console
pnpm run test:components             # 131 тест
pnpm exec tsc --noEmit
```

Одоогийн байдлаар бүгд ногоон (`ops:config:v22` нь таны `.env.production` бэлдсэний дараа).

---

## 5. Дараалал

1. **Хуульчид Terms/Privacy өгөх** — хамгийн урт хүлээлт, эхэлж эхлүүл.
2. **Lemon Squeezy бүртгэл + KYC** — мөн адил гадны хүлээлт.
3. **SMTP серверийн мэдээлэл авах** — Google Workspace, Zoho, Postmark, эсвэл дотоодын
   хостинг ч болно. Зөвхөн `SMTP_*` хувьсагчид бөглөнө.
4. Домэйн орлуулах (robots, sitemap, contact хаяг).
5. Variant ID оруулж, `live` орчинд эхний бодит худалдан авалтыг туршина.
6. Cron дээр `billing:maintenance` тавих.

---

## 6. Имэйл хэрхэн ажилладаг вэ

| Захидал | Хэзээ |
|---|---|
| Имэйл баталгаажуулах | Компани бүртгүүлэх маягт илгээхэд |
| Нууц үг тохируулах | Төлбөр баталгаажиж ажлын талбар үүссэний дараа |
| Төлбөр амжилтгүй | Захиалга `PAST_DUE` болж grace эхлэхэд |
| Захиалга хаагдсан | Grace дуусч `SUSPENDED` болоход |

**Хоёр зарчим кодод суулгасан:**
- Имэйл илгээх нь **төлөвийг шийддэггүй**. Transaction commit хийсний дараа илгээгддэг,
  алдаа гарвал log-д бичээд өнгөрнө. Мэйл серверийн доголдол төлбөрийг унагаахгүй.
- Токен **production-ийн log-д хэзээ ч орохгүй**. SMTP тохируулаагүй үед хөгжүүлэлтийн
  орчинд л токен харагдана.

**Холбоотой:** `landing-page-roadmap.md` (бүрэн roadmap, phase бүрийн төлөв) ·
`agents/data/evaluations/billing-*.json` (сүүлийн smoke-ийн нотолгоо)
