# BuildWatch v2.2 — Phase 1 shared contracts

- Төлөв: COMPLETE
- Огноо: 2026-07-31
- Requirement catalog: `buildwatch-v2.2-requirement-catalog.md`
- Architecture freeze: `phase-0-buildwatch-v2.2-architecture-freeze.md`
- Roadmap: `../BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md`

`PHASE 1 EXIT GATE: PASS`

## 1. Хэрэгжүүлсэн бүтэц

```text
src/contracts/
├── buildwatch-v2-common.ts
├── design/index.ts
├── quantity/index.ts
├── estimate/index.ts
├── schedule/index.ts
├── planning/index.ts
├── verification/index.ts
└── forecast/index.ts
```

Root export: `src/contracts/index.ts`.

## 2. Shared boundary

`buildwatch-v2-common.ts` дараах canonical primitive-ийг тогтоосон:

- canonical unit: `m`, `m2`, `m3`, `kg`, `pcs`, `h`, `working_day`, `percent`;
- plain decimal, positive/nonnegative/ratio/signed-percentage validation;
- source reference нь `tenantId`, `projectId`, source type/version/as-of/region-тэй;
- catalog version нь effective range, approver, source-тэй;
- human review decision болон approval matrix role;
- immutable approved version metadata;
- generic review lifecycle:
  `DRAFT → REVIEW_REQUIRED → APPROVED/REJECTED → APPLIED/SUPERSEDED`;
- invalid transition болон буруу approver role schema дээр reject болно.

## 3. A0 contract

### Design

- `DesignDocumentManifestV1`;
- `DrawingRevisionV1`;
- `VerifiedDrawingScaleV1`;
- `DesignElementCandidateV1`;
- missing-information issue;
- engineer review decision;
- vector/raster/tabular extraction mode;
- checksum duplicate lineage;
- scale/source cross-scope validation.

### Quantity/estimate/baseline

- `QuantityTakeoffDraftV1`;
- `ApprovedQuantityTakeoffVersionV1`;
- `ApprovedQuantityTakeoffCommandV1`;
- dimension input, formula, unit, waste, manual adjustment, source;
- `EstimateDraftV1`;
- `ApprovedEstimateVersionV1`;
- `ApprovedEstimateCommandV1`;
- norm/price/productivity version;
- exact MNT subtotal/tax/contingency/total consistency;
- `BaselineDraftV1`;
- `ApprovedBaselineVersionV1`;
- `ApprovedBaselineCommandV1`;
- calendar, activity, dependency, resource requirement;
- immutable approved version болон idempotency key.

## 4. A5 contract

### Operational snapshot

- `OperationalPlanningSnapshotV1`;
- approved baseline/schedule reference;
- remaining quantity;
- crew/equipment/material/zone availability;
- inspection, blocker, weather;
- approved actual lineage;
- dangling reference, duplicate ID, cross-tenant source validation;
- raw PDF/UI/unapproved candidate contract-д орохгүй.

### Daily planning

- `DailyWorkPlanDraftV1`;
- `ApprovedDailyWorkPlanVersionV1`;
- `ApprovedDailyWorkPlanCommandV1`;
- work item, target, resource, material, precondition;
- conflict, feasibility, limiting factor;
- project-manager approval;
- `DailyWorkPlanStateTransitionV1`.

### Verification

- `ProgressVerificationDraftV1`;
- `ApprovedProgressVerificationVersionV1`;
- `ApprovedProgressVerificationCommandV1`;
- planned/declared/verified/cumulative quantity;
- `PE-01`–`PE-10` photo check;
- evidence coverage;
- variance;
- `COMPLETED`, `PARTIALLY_COMPLETED`, `NOT_COMPLETED`, `NOT_STARTED`,
  `BLOCKED`, `UNVERIFIABLE`;
- photo-only verified quantity reject;
- blocking issue-тэй draft approval-д орохгүй.

### Forecast/recovery

- `RollingProductivitySnapshotV1`;
- 3/7/14-day window;
- cold-start confidence cap `0.60`;
- included/excluded/outlier sample lineage;
- `OperationalForecastSnapshotV1`;
- threshold-consistent on-time status;
- confidence factor, driver, source;
- `RecoveryProposalDraftV1`;
- deterministic schedule/cost impact;
- baseline auto-change үргэлж `false`.

## 5. Contract invariant

- Aggregate бүр `schemaVersion: 1`, `tenantId`, `projectId`-тай.
- Aggregate schema бүр `.strict()` тул unknown field reject болно.
- Шинэ version нь existing `V1` contract-ийг in-place өөрчлөхгүй.
- Quantity/money/unit/source хоосон эсвэл malformed бол reject болно.
- Source aggregate-ийн tenant/project scope-тэй заавал таарна.
- Collection ID болон internal reference duplicate/dangling байж болохгүй.
- AI draft schema нь `APPROVED/APPLIED` official status гаргахгүй.
- Approved command бүр `idempotencyKey`, immutable version, approval decision-тэй.
- Invalid scale, state transition, approver role болон forecast threshold/status reject
  болно.

## 6. Test evidence

```text
tests/contracts/buildwatch-v22-fixtures.ts
tests/contracts/buildwatch-v22-design.test.ts
tests/contracts/buildwatch-v22-commercial.test.ts
tests/contracts/buildwatch-v22-operations.test.ts
tests/contracts/buildwatch-v22-versioning.test.ts
```

Covered boundary:

- positive golden fixture;
- JSON round-trip;
- unknown version/field;
- cross-tenant/project source;
- duplicate ID;
- dangling reference;
- unverified scale;
- source-less quantity;
- inconsistent unit;
- malformed money/aggregate total;
- invalid review/plan transition;
- infeasible plan approval;
- photo-only quantity;
- incomplete evidence;
- cold-start confidence;
- forecast status/threshold;
- recovery source isolation.

## 7. Ажиллуулах

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd run phase1:v22:gate
```

Тусад нь:

```powershell
pnpm.cmd run docs:check:v22
pnpm.cmd run check
pnpm.cmd run test:contracts:v22
```

## 8. Exit gate

- [x] Бүх шинэ aggregate strict Zod schema-тай.
- [x] Golden fixture бүр schema pass.
- [x] Invalid source/scale/state fixture reject.
- [x] Unknown field/version reject.
- [x] Cross-tenant/project source reject.
- [x] Duplicate ID болон dangling reference reject.
- [x] Money/unit/source boundary test-тэй.
- [x] Approved command бүр idempotency key-тэй.
- [x] Existing v1 contract өөрчлөгдөөгүй.
- [x] TypeScript check pass.
- [x] Phase 1 targeted tests pass.

## 9. Энэ phase-д зориуд хийгээгүй

- eligible/priority/target/conflict algorithm;
- progress verification calculator;
- rolling productivity/CPM forecast calculator;
- database migration;
- API;
- frontend.

Эдгээр нь contract-ийг хэрэглэн Phase 2–10-д хэрэгжинэ.
