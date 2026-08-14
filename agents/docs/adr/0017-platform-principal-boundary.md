# ADR 0017: Platform principal-ийг tenant identity-ээс салгах

**Status:** Accepted  
**Date:** 2026-08-11  
**Scope:** BuildWatch Super Admin Control Tower

## Context

Одоогийн BuildWatch identity нь `User.tenantId` болон `tenantRole`-д суурилдаг. `SUPER_ADMIN` болон `COMPANY_ADMIN` ижил tenant/project operational permission-тэй бөгөөд хоёулаа tenant-ийн project-д membership-гүйгээр effective access авдаг.

Control Tower-ийн Platform Admin нь бүх tenant-ийн техникийн aggregate мэдээлэл хардаг боловч BOQ, schedule, daily report, inventory, engineering review зэрэг business operation өөрчлөх ёсгүй. Tenant role-ийг cross-tenant wildcard болгон ашиглавал tenant isolation, audit болон least-privilege зарчим зөрчинө.

## Decision

### 1. Тусдаа platform identity

Platform operator-уудыг tenant-scoped `User` model-д хадгалахгүй. Дараах тусдаа model ашиглана:

- `PlatformPrincipal`
- `PlatformCredential`
- `PlatformRefreshSession`
- `PlatformAuditLog`

Platform principal-д `tenantId` байхгүй.

### 2. Тусдаа authentication boundary

Platform authentication:

```text
POST /platform/v1/auth/login
POST /platform/v1/auth/refresh
POST /platform/v1/auth/logout
GET  /platform/v1/session
```

Platform token:

- `principalKind = PLATFORM`
- platform role болон token version агуулна
- tenant token-оос тусдаа audience ашиглана
- tenant operational endpoint-д хүлээн зөвшөөрөгдөхгүй

Tenant token `/platform/v1/*` endpoint-д хүлээн зөвшөөрөгдөхгүй.

### 3. Тусдаа permission namespace

Platform permission `PLATFORM_*` prefix-тэй байна. Platform principal-д tenant operational permission олгохгүй.

### 4. Cross-tenant access зөвхөн platform read service-д

Ерөнхий tenant repository/service дээр `if superAdmin then skip tenant filter` нөхцөл хийхгүй. Cross-tenant aggregate query зөвхөн platform authorization-аар хамгаалагдсан platform read-model/service-д байна.

### 5. Additive migration

Эхний rollout дээр legacy tenant `SUPER_ADMIN` enum/value-г устгахгүй.

Дараалал:

1. Platform schema/auth нэмэх
2. Platform Admin bootstrap хийх
3. `/platform` frontend нэвтрүүлэх
4. Legacy tenant `SUPER_ADMIN` account болон seed reference-үүдийг `COMPANY_ADMIN` руу шилжүүлэх
5. Regression test хийсний дараа tenant role-оос `SUPER_ADMIN`-ийг хасах

## Consequences

### Positive

- Platform болон business operation privilege бодитоор сална.
- Tenant wildcard access хэрэггүй болно.
- Platform action тусдаа audit trail-тай болно.
- Company Admin platform role олгох боломжгүй болно.
- Existing tenant/project flow-г additive rollout-аар хадгална.

### Cost

- Тусдаа token/session lifecycle шаардана.
- Platform login/session frontend flow нэмэгдэнэ.
- Legacy `SUPER_ADMIN` data migration шаардана.
- OpenAPI болон test matrix өргөжинө.

## Security invariants

- Tenant principal platform endpoint ашиглахгүй.
- Platform principal tenant operational endpoint ашиглахгүй.
- Client-ийн `tenantId` authorization-ийн нотолгоо биш.
- Platform read response raw prompt, output, file content болон secret агуулахгүй.
- Critical platform mutation reason, idempotency, correlation ID болон audit шаарддаг.

## Verification

- Company Admin `/platform/v1/*` → `403`
- Platform token project mutation → `401/403`
- Tenant A identity Tenant B resource ID ашиглах → `404/403`
- Company Admin platform role grant хийх → `403`
- Expired/revoked platform session → `401`
