# BuildWatch v2.2 — Phase 5 rolling forecast ба recovery

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase5:v22:gate`

## 1. Зорилго

Phase 4-өөр батлагдаж apply хийгдсэн progress verification, approved baseline,
operational planning snapshot, productivity norm болон versioned policy-г ашиглан
rolling productivity, remaining duration, projected critical path, project finish,
confidence, delay driver, recovery proposal-г deterministic тооцно. LLM нь хугацаа,
productivity, зардал эсвэл recovery impact бодохгүй.

## 2. Authoritative урсгал

```text
ApprovedBaselineVersionV1
  + OperationalPlanningSnapshotV1
  + AppliedProgressVerificationV1[]
  + ApprovedProductivityNormV1[]
  + OperationalForecastPolicyV1
  + human-reviewed outlier decisions
  + versioned recovery catalog
      ↓
calculateOperationalForecast
      ↓
RollingProductivitySnapshotV1
  + OperationalForecastSnapshotV1
  + RecoveryProposalDraftV1[]
  + A2ForecastNarrativeInputV1
```

Зөвхөн `APPLIED_PROGRESS_VERIFICATION` output productivity history-д орно.
Unapproved A1 draft, unapproved verification draft болон LLM-ийн тоо forecast-д
орох замгүй.

## 3. Input contract ба policy

`OperationalForecastRequestV1` дараах boundary-г calculation-аас өмнө шалгана:

- tenant/project scope бүх input, source reference дээр ижил;
- approved baseline version болон operational schedule version таарсан;
- as-of boundary-оос хойших policy, norm, actual, review, source орохгүй;
- applied verification, productivity sample ID давхардахгүй;
- progress/variance/productivity/forecast input бүр snapshot-ийн work item-д хамаарна;
- norm нь approved, positive, canonical unit болон work class-тай;
- outlier decision нь бодит sample болон human-decision lineage-тай;
- recovery catalog option нь deterministic multiplier эсвэл fixed-day impact-тай;
- negative planned/remaining quantity reject болно.

Policy нь minimum sample, `MAD_REVIEW_ONLY`, blocked-day handling,
approved-norm/baseline fallback, 3/7/14 window weight, weather/equipment/material/
blocker factor, productivity clamp, warning/critical threshold, confidence weight,
recovery scenario limit-ийг version-оор тогтооно.

## 4. Rolling productivity

Work item бүрээр сүүлийн 3, 7, 14 working-day window тусдаа бодогдоно.

- Зөв sample нь approved verification quantity болон labor hour lineage-тай.
- Quantity нь approved norm-ийн reference crew × shift hour руу normalized болно.
- Window minimum sample хангавал `ROLLING_ACTUAL` average хэрэглэнэ.
- Sample хүрэхгүй бол `COLD_START_NORM`, зөвшөөрсөн тохиолдолд
  `BASELINE_RATE_FALLBACK` хэрэглэнэ.
- Ямар ч authoritative fallback байхгүй бол `INSUFFICIENT_DATA` гарна.
- 3/7/14 productivity нь versioned weight-аар нэг current productivity болно.
- Cold-start confidence `≤ 0.60`, baseline fallback confidence `≤ 0.50`.

Rejected, unverifiable, missing quantity, zero quantity, wrong unit, duplicate
evidence болон policy-оор excluded blocked day rolling average-д орохгүй.

## 5. Outlier ба blocked day

Median absolute deviation нь outlier candidate-г зөвхөн flag хийнэ. Candidate-г
автоматаар устгахгүй. Зөвхөн `PROJECT_MANAGER` эсвэл `SITE_ENGINEER`-ийн
`INCLUDE`/`EXCLUDE` human decision эцсийн inclusion-г өөрчилнө.

Blocked day policy:

- `EXCLUDE`: approved active blocker-той тухайн өдрийн sample хасагдана;
- `INCLUDE_AS_ZERO`: sample lineage хадгалагдаж normalized quantity 0 болно.

## 6. Adjusted productivity ба remaining duration

Work item бүр яг есөн source-backed factor trace-тэй:

1. recent pace;
2. crew size;
3. shift length;
4. weather restriction;
5. approved learning adjustment;
6. equipment availability/capacity;
7. material availability;
8. approved open blocker;
9. working calendar hours.

Adjusted productivity нь versioned min/max factor-аар clamp хийгдэнэ. Remaining
duration:

```text
ceil(approved remaining quantity / adjusted daily productivity)
```

гэсэн deterministic working-day томьёотой. Тоо бодох үед OpenAI эсвэл өөр LLM
дуудахгүй (`llmRequired = false`).

## 7. Dependency, critical path, projected finish

Operational predecessor graph topological sort хийнэ; cycle болон unknown reference
reject болно. Approved baseline-ийн FS/SS/FF/SF dependency type, lag болон project
calendar ашиглан successor start/finish тархана.

Projected remaining durations дээр longest-chain path дахин бодогдож
`projectedCriticalPathWorkItemIds`-д хадгалагдана. Project finish нь approved
baseline finish дээр projected critical-path/milestone delay-г working calendar-аар
тархаана. Approved baseline content-д write хийхгүй.

Versioned threshold:

| Delay                               | Status              |
| ----------------------------------- | ------------------- |
| `≤ 0`                               | `ON_TRACK`          |
| `1..warning`                        | `AT_RISK`           |
| `warning+1..critical`               | `LIKELY_LATE`       |
| `> critical`                        | `CRITICAL_LATE`     |
| authoritative pace/dependency дутуу | `INSUFFICIENT_DATA` |

## 8. Confidence ба delay driver

Confidence нь дараах найман versioned weighted score-ийн нийлбэр:

- approved report coverage;
- valid quantity coverage;
- photo evidence coverage;
- productivity history length;
- unresolved blocker score;
- norm/catalog completeness;
- dependency completeness;
- resource data quality.

Score, factor, project/work-item driver бүр source reference, as-of болон
`SYSTEM_CALCULATION` lineage-тай. Neutral factor ч calculation source-той тул
тайлбарлах боломжтой.

## 9. Recovery proposal

Late forecast дээр versioned catalog-аас extra crew, second shift, equipment,
resource move, parallelization, material expedite, zone resequence,
subcontractor capacity option ажиллана.

Proposal бүр:

- estimated working-day impact;
- additional MNT cost;
- required resource IDs;
- dependency/zone conflict IDs;
- risks;
- source references;
- `requiresHumanReview = true`;
- `baselineChanged = false`;

агуулна. Zone concurrency болон sequence dependency conflict байвал `DRAFT`,
conflictгүй бол `REVIEW_REQUIRED`; аль аль нь human approval-гүй apply хийхгүй.

## 10. A2 integration boundary

`A2ForecastNarrativeInputV1` нь forecast status, projected finish, delay, driver ID,
recovery proposal ID болон source-г A2-д өгнө.

- `numericAuthority = A5_DETERMINISTIC_ONLY`;
- `a2MayCreateNumericFacts = false`.

A2 зөвхөн source-backed тоонуудыг тайлбарлаж narrative/recommendation draft
үүсгэнэ; шинэ хугацаа, cost, impact зохиохгүй.

## 11. Determinism, idempotency, isolation

- Semantically unordered input canonical sort-той.
- Request SHA-256 hash болон output ID byte-stable.
- Gateway ижил idempotency key + ижил request-д cached object буцаана.
- Ижил key + өөр content reject болно.
- Cross-tenant, future source, unknown work item calculation-аас өмнө reject болно.
- Forecast/recovery output baseline-г автоматаар өөрчлөхгүй.

## 12. Test ба evaluation нотолгоо

Targeted unit/integration suite:

- Test files: `2/2 PASS`;
- Tests: `17/17 PASS`;
- rolling 3/7/14, crew/shift normalization, norm/baseline fallback;
- MAD candidate + human exclusion, blocked day policy;
- all nine factors, dependency propagation, projected critical path;
- insufficient data, five statuses, confidence, drivers;
- recovery conflict/review, A2 numeric boundary;
- deterministic reorder/replay, idempotency, cycle, tenant/as-of isolation.

32-case answer-key release evaluation:

- Cases: `32/32 PASS`;
- Finish MAE: `0.00 working days`;
- Critical-delay recall: `100.00%`;
- Average early warning: `14.52 working days`;
- False-alert rate: `0.00%`;
- Source coverage: `100.00%`;
- Deterministic replay: `100.00%`;
- Recovery coverage: `100.00%`;
- Baseline mutations: `0`.

Evidence:

- `src/contracts/forecast/index.ts`;
- `src/forecasting/operational-forecast-contracts.ts`;
- `src/forecasting/operational-forecast.ts`;
- `src/forecasting/operational-forecast-evaluation.ts`;
- `src/scripts/evaluate-buildwatch-v22-operational-forecast.ts`;
- `tests/forecasting/operational-forecast.test.ts`;
- `tests/forecasting/operational-forecast-evaluation.test.ts`;
- `data/evaluations/buildwatch-v22-operational-forecast-latest.json`.

Requirement evidence: `DET-FORECAST-001`–`DET-FORECAST-012`, `A5-010`–`A5-013`,
`BE-PLAN-005`, `BE-PLAN-008`, `QA-V22-016`, `G-06`, `G-09`, `P-02`, `P-04`.

## 13. Команд

```powershell
pnpm.cmd run test:forecasting:v22
pnpm.cmd run eval:forecasting:v22
pnpm.cmd run phase5:v22:gate
```

## 14. Exit gate

- [x] 3/7/14 working-day rolling productivity боддог.
- [x] Approved norm cold-start болон explicit baseline fallback-тэй.
- [x] Rejected/unverifiable/zero/wrong-unit/duplicate sample хасагддаг.
- [x] Outlier автоматаар устахгүй, human review шаарддаг.
- [x] Blocked day exclude/include-zero policy versioned.
- [x] Crew болон shift normalization source-backed.
- [x] Есөн adjusted-productivity factor trace гардаг.
- [x] Remaining duration approved quantity/productivity-аар ceil бодогддог.
- [x] FS/SS/FF/SF dependency болон lag calendar-аар тархдаг.
- [x] Cycle, unknown dependency reject болдог.
- [x] Projected critical path дахин бодогддог.
- [x] Project finish approved baseline finish-ээс deterministic тархдаг.
- [x] Таван forecast status versioned threshold-той.
- [x] Confidence найман deterministic factor-той.
- [x] Delay driver бүр source/as-of lineage-тэй.
- [x] Recovery impact/cost/resource/conflict/risk/source бүрэн.
- [x] Recovery draft human review-гүй apply хийхгүй.
- [x] A2 шинэ numeric fact үүсгэх эрхгүй.
- [x] Tenant/as-of/source isolation calculation-аас өмнө шалгагддаг.
- [x] Canonical replay болон gateway idempotency conflict-safe.
- [x] Baseline автоматаар өөрчлөгдөхгүй.
- [x] Finish MAE `0.00 ≤ 7 working days`.
- [x] Critical-delay recall `100.00% ≥ 90%`.
- [x] Average early warning `14.52 ≥ 5 working days`.
- [x] False-alert rate `0.00%`.
- [x] 32-case evaluation болон 17 targeted test pass.

**PHASE 5 EXIT GATE: PASS**
