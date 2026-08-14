# BuildWatch v2.2 — Phase 4 deterministic progress verification

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase4:v22:gate`

## 1. Зорилго

Approved daily plan, approved A1 actual, photo evidence, checklist, material,
attendance, equipment болон site engineer decision-ийг нэг deterministic урсгалд
нэгтгэж оройн verified progress гаргана. LLM нь completion status, quantity,
variance болон forecast eligibility шийдэхгүй.

## 2. Authoritative урсгал

```text
ApprovedDailyWorkPlanVersionV1
  + ApprovedA1ActualBundleV1
  + PhotoEvidenceEvaluationV1
  + approved checklist
  + ProgressVerificationPolicyV1
  + SITE_ENGINEER decision
      ↓
generateProgressVerification
      ↓
ProgressVerificationDraftV1
      ↓ PROJECT_MANAGER review
ApprovedProgressVerificationCommandV1
      ↓ approved-command-only apply
progress history + daily variance + productivity sample
+ material ledger + forecast input + audit
```

Draft өөрөө canonical actual эсвэл forecast-г өөрчилдөггүй. Project manager-ийн
approved immutable command үүссэний дараа л apply projection гарна.

## 3. Deterministic input contract

`ProgressVerificationRequestV1` дараах бүх input-ийг нэг tenant/project/report date
scope-д шаардана:

- approved, feasible daily plan version;
- human-reviewed `ApprovedA1ActualBundleV1`;
- plan item бүрийн `PhotoEvidenceEvaluationV1`;
- quantity/checklist/weighted-milestone measurement configuration;
- mandatory checklist result;
- site engineer accept/override/reject/clarification decision;
- versioned progress-verification policy;
- material movement, attendance, equipment usage lineage.

Missing item coverage, future source, policy/version/date mismatch, cross-tenant
source болон work-item mapping зөрвөл calculation эхлэхээс өмнө schema reject
хийнэ.

## 4. Explicit status decision table

| Нөхцөл                                                           | Status                |
| ---------------------------------------------------------------- | --------------------- |
| Blocking evidence/input mismatch эсвэл шийдэгдээгүй quantity     | `UNVERIFIABLE`        |
| Approved operational blocker                                     | `BLOCKED`             |
| Verified quantity target-тэй тэнцүү/их, evidence/checklist бүрэн | `COMPLETED`           |
| Verified quantity 0-ээс их, target-аас бага                      | `PARTIALLY_COMPLETED` |
| Ажил эхэлсэн signal байгаа ч verified quantity 0                 | `NOT_COMPLETED`       |
| Эхэлсэн signal болон verified progress байхгүй                   | `NOT_STARTED`         |

`COMPLETED` status нь зөвхөн non-photo quantity/checklist measurement, photo
evidence coverage, mandatory checklist, resource/material consistency болон engineer
acceptance хамт хангагдсан үед гарна.

## 5. No-guess ба mismatch policy

- Photo evidence exact quantity гаргахгүй.
- Declared quantity байхгүй бол photo-оос нөхөхгүй, `UNVERIFIABLE` болгоно.
- Exact/near duplicate болон previous-day reuse automatic approval авахгүй.
- Report/photo, material/progress, attendance/progress, equipment/progress,
  checklist зөрүү бүр blocking review issue үүсгэнэ.
- `BLOCKED` зөвхөн approved operational blocker ID-тай үед гарна.
- Site engineer `OVERRIDE_QUANTITY` хийхэд reason болон human-decision lineage
  заавал байна.
- PE-09 warning-г зөвхөн reason-тэй engineer quantity override шийдвэрлэж болно;
  intrinsic photo failure болон duplicate/reuse-г override тойрохгүй.
- Declared quantity, verified quantity, cumulative quantity тусдаа хадгалагдана.

## 6. Measurement mode

- `QUANTITY`: approved declared quantity эсвэл reason-тэй engineer override.
- `CHECKLIST`: percent unit, approved passed checklist нь target-ийг батална.
- `WEIGHTED_MILESTONE`: percent unit, approved checklist completion percent-ээр
  deterministic progress гаргана.

Decimal calculation нь integer-scaled `ROUND_HALF_UP` helper ашиглана. Planned
quantity тэг/сөрөг бол division хийхгүй, `INVALID_PLANNED_QUANTITY` issue-тэй
`UNVERIFIABLE` болгоно.

## 7. Human review ба immutable approval

Бүх deterministic output `requiresHumanReview = true`. Blocking issue байхгүй draft
`REVIEW_REQUIRED`, бусад нь `DRAFT` байна. Зөвхөн `PROJECT_MANAGER` review-ready
draft-ийг approve хийнэ.

Human edit хийсэн approved content нь:

- corrected field path;
- override reason;
- reviewer identity/role/time;
- immutable content source hash;

шаардана. Content tampering болон approval metadata mismatch apply хийхээс өмнө
reject болно.

## 8. Approved-command-only apply

`applyApprovedProgressVerification` дараах таван projection-ийг нэг logical
transaction boundary-д гаргана:

1. progress history;
2. daily variance;
3. productivity sample;
4. append-only material ledger entry;
5. forecast input.

`UNVERIFIABLE` item forecast-д `included = false` байна. Draft/result түвшинд эдгээр
projection огт үүсэхгүй. Apply output нь command hash, approved source hash,
reviewer, actor, timestamp болон source lineage бүхий audit record-той.

## 9. Idempotency ба isolation

- Generate gateway: ижил key + ижил canonical request-д cached result буцаана.
- Approval gateway: ижил key + өөр command content reject хийнэ.
- Apply gateway: ижил key + өөр approved command hash reject хийнэ.
- Input order canonical sort-той тул replay byte-stable.
- Tenant/project/source scope зөрвөл request reject болно.
- Approved content tampering source-hash check дээр reject болно.

## 10. Test ба evaluation нотолгоо

Unit/contract suite нь status table, false completed, missing quantity,
duplicate/reuse/incomplete image, report/photo/material/attendance/equipment mismatch,
checklist failure, engineer rejection/override, blocker, measurement mode, tenant
isolation, idempotency, tamper болон approved-only apply-г шалгана.

Operational simulation-ийн 52 feasible item дээр 12 adversarial case нэмсэн release
evaluation:

- Cases: `64/64 PASS`;
- Completion classification accuracy: `100.00%`;
- False `COMPLETED` rate: `0.00%`;
- Duplicate precision: `100.00%`;
- Duplicate recall: `100.00%`;
- `UNVERIFIABLE` no-guess rate: `100.00%`;
- Deterministic replay rate: `100.00%`;
- Unapproved forecast violation: `0`;
- Approved five-projection apply: `PASS`.

Evidence:

- `src/contracts/verification/index.ts`;
- `src/verification/progress-verification-contracts.ts`;
- `src/verification/progress-verification.ts`;
- `src/verification/progress-verification-evaluation.ts`;
- `src/scripts/evaluate-buildwatch-v22-progress-verification.ts`;
- `tests/verification/progress-verification.test.ts`;
- `tests/verification/progress-verification-evaluation.test.ts`;
- `data/evaluations/buildwatch-v22-progress-verification-latest.json`.

Requirement evidence: `DET-VERIFY-001`–`DET-VERIFY-010`, `A5-006`, `A5-007`,
`BE-PLAN-003`, `QA-V22-005`, `QA-V22-013`, `P-03`, `P-04`, `P-08`.

## 11. Команд

```powershell
pnpm.cmd run test:progress-verification:v22
pnpm.cmd run eval:verification:v22
pnpm.cmd run phase4:v22:gate
```

## 12. Exit gate

- [x] Approved daily plan input заавал хэрэглэдэг.
- [x] Approved A1 actual input заавал хэрэглэдэг.
- [x] Photo evidence evaluation plan item бүрийг хамардаг.
- [x] Mandatory checklist deterministic decision-д ордог.
- [x] Material movement progress-тэй тулгагддаг.
- [x] Attendance positive progress-тэй тулгагддаг.
- [x] Required equipment usage progress-тэй тулгагддаг.
- [x] Site engineer decision human lineage-тэй.
- [x] Зургаан completion status explicit decision table-тэй.
- [x] False `COMPLETED` target-аар няцаагддаг.
- [x] Duplicate болон reused image auto-approve болдоггүй.
- [x] Missing quantity-г photo-оос зохиодоггүй.
- [x] Incomplete evidence `UNVERIFIABLE` болдог.
- [x] Report/photo mismatch `UNVERIFIABLE` болдог.
- [x] Material mismatch `UNVERIFIABLE` болдог.
- [x] Approved blocker л `BLOCKED` болдог.
- [x] Quantity, checklist, weighted-milestone mode ажилладаг.
- [x] Completion rate/variance exact decimal policy ашигладаг.
- [x] Human override reason болон corrected path шаарддаг.
- [x] Generate/approve/apply idempotency conflict-safe.
- [x] Tenant/project isolation calculation-аас өмнө шалгагддаг.
- [x] Unapproved draft canonical actual/forecast-д нөлөөлдөггүй.
- [x] Approved command таван downstream projection үүсгэдэг.
- [x] Approved content tampering apply-аас өмнө reject болдог.
- [x] 64-case classification/duplicate/no-guess release evaluation pass.

**PHASE 4 EXIT GATE: PASS**
