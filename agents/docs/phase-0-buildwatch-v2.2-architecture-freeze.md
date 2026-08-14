# BuildWatch v2.2 — Phase 0 architecture freeze

- Төлөв: Accepted
- Огноо: 2026-07-31
- Requirement source: `../../buildwatch.md`
- Requirement catalog: `buildwatch-v2.2-requirement-catalog.md`
- Roadmap: `../BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md`

`PHASE 0 EXIT GATE: PASS`

## 1. MVP boundary

### MVP-д заавал орох

- A5 daily planning deterministic core;
- A5 evening progress verification;
- A5 rolling productivity, projected finish, confidence, driver, recovery;
- A0 инженерийн Excel workbook import;
- A0 vector architectural PDF;
- floor/zone/room/wall/door/window candidate;
- verified scale gate;
- quantity/material/estimate/WBS/schedule/baseline draft;
- хүний review/edit/reject/approve;
- tenant/project-safe tool, API, database, event, audit;
- React + TypeScript review UI болон field PWA;
- simulation, golden dataset, regression, security, production release gate.

### MVP-д орохгүй

- IFC/BIM import;
- structural болон MEP extraction;
- cross-discipline clash detection;
- automated revision impact;
- external live weather provider;
- supplier quotation integration;
- video evidence;
- advanced resource leveling болон schedule optimization.

Advanced scope нь устсан requirement биш. Catalog-д `LATER` priority-тай хадгалагдана.

## 2. Existing contract freeze

Дараах contract-ийг v2.2 implementation хийхдээ in-place breaking change хийхгүй:

- `ProjectAnalysisSnapshotV1`;
- `DailyReportDraftV1`;
- `ApprovedDailyReportCommandV1`;
- `DeterministicAnalysisV1`;
- одоогийн A2/A3/A4 output;
- одоогийн production tool authorization context.

Шинэ A0/A5 capability нь тусдаа version-тэй contract болон adapter-аар холбогдоно.
Existing v1 хэрэглэгч шинэ field шаардахгүй хэвээр байна.

Шинээр төлөвлөсөн contract:

- `DesignIntakeManifestV1`;
- `DrawingRevisionV1`;
- `VerifiedDrawingScaleV1`;
- `DesignElementCandidateV1`;
- `QuantityTakeoffDraftV1`;
- `ApprovedQuantityTakeoffCommandV1`;
- `EstimateDraftV1`;
- `ApprovedBaselineCommandV1`;
- `OperationalPlanningSnapshotV1`;
- `DailyWorkPlanDraftV1`;
- `ApprovedDailyWorkPlanCommandV1`;
- `ProgressVerificationDraftV1`;
- `ApprovedProgressVerificationCommandV1`;
- `RollingProductivitySnapshotV1`;
- `OperationalForecastSnapshotV1`;
- `RecoveryProposalDraftV1`.

## 3. Agent ownership

| Owner | Хийнэ                                                                                       | Хийхгүй                                                                           |
| ----- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| A0    | Drawing/Excel classification, candidate, clarification, baseline draft orchestration        | Official quantity/estimate/baseline approve хийхгүй; тоо зохиохгүй                |
| A1    | Text/photo daily actual intake, normalization, evidence, duplicate suspicion, clarification | Daily plan, verified status, forecast бодохгүй                                    |
| A5    | Approved source-оос feasible plan, verification, rolling forecast, recovery orchestration   | Raw report extraction хийхгүй; LLM-ээр тоо бодохгүй; baseline auto-update хийхгүй |
| A2    | A5/deterministic output дээр trend, root cause, recommendation тайлбарлана                  | Duration/cost/quantity-г дахин бодохгүй                                           |
| A3    | Approved facts-аар document/PDF draft үүсгэнэ                                               | Unapproved candidate-г official fact болгохгүй                                    |
| A4    | Authorized read-only tool-оор source-backed answer өгнө                                     | Write, approve, cross-tenant access хийхгүй                                       |

Ownership-ийн дэлгэрэнгүй шийдвэр: ADR-0011.

## 4. Canonical unit, currency, time

### Тоон хадгалалт

- Contract numeric утга plain base-10 decimal string байна.
- Database quantity/cost нь `Decimal`; binary floating point canonical storage биш.
- Intermediate calculation нь input-аас өндөр precision хадгална.
- Boundary/display rounding нь `ROUND_HALF_UP`.
- `NaN`, `Infinity`, scientific notation болон locale separator canonical contract-д
  зөвшөөрөхгүй.

### Unit

| Dimension  | Canonical unit                         |
| ---------- | -------------------------------------- |
| Length     | `m`                                    |
| Area       | `m2`                                   |
| Volume     | `m3`                                   |
| Mass       | `kg`                                   |
| Count      | `pcs`                                  |
| Time       | `h`, schedule duration-д `working_day` |
| Percentage | `percent` буюу 0–100                   |
| Currency   | `MNT`                                  |

- Source unit болон conversion factor persisted байна.
- Unit dimension таарахгүй conversion-ийг reject хийнэ.
- Unit тодорхойгүй quantity нь `INSUFFICIENT_INFORMATION`.

### Precision

| Value                | Storage/calculation                          | Display/default approval rounding           |
| -------------------- | -------------------------------------------- | ------------------------------------------- |
| Length               | 6 decimal хүртэл                             | 0.001 m                                     |
| Area                 | 6 decimal хүртэл                             | 0.01 m2                                     |
| Volume               | 6 decimal хүртэл                             | 0.001 m3                                    |
| Mass                 | 6 decimal хүртэл                             | 0.01 kg                                     |
| Count                | integer, fractional бол source rule шаардана | 1 pcs                                       |
| Labor/equipment hour | 4 decimal хүртэл                             | 0.01 h                                      |
| Percent/confidence   | 4 decimal хүртэл                             | 0.01 percentage point                       |
| Money                | `Decimal(18,2)`-оос багагүй                  | 0.01 MNT; UI бүхэл MNT болгон харуулж болно |

Aggregate нь rounded line-уудын нийлбэр биш; high-precision line result-ийг нийлүүлээд
aggregate boundary дээр нэг удаа round хийнэ.

### Date/time

- Instant timestamp UTC-аар хадгална.
- Operational date, 05:00 job, shift, report cut-off нь versioned project timezone-аар
  бодогдоно.
- `Asia/Ulaanbaatar` нь simulation/demo default; production project timezone заавал
  explicit байна.
- Calendar нь version, working weekdays, holiday, work hours/day, effective range-тэй.
- Calendar байхгүй үед schedule/forecast нь implicit Monday–Friday таамаглахгүй,
  `INSUFFICIENT_INFORMATION` гаргана.

## 5. Source priority

### Quantity

1. approved engineer quantity;
2. engineer-verified vector geometry;
3. approved Excel quantity;
4. raster drawing/photo нь exact quantity source биш.

Ижил priority дотор:

1. active approved revision;
2. as-of date-д хүчинтэй version;
3. хамгийн сүүлд approved болсон version;
4. tie хэвээр бол auto-select хийхгүй, review шаардана.

### Norm/productivity

1. project-specific approved version;
2. company approved version;
3. approved standard catalog;
4. source байхгүй бол final estimate/schedule block.

### Price

1. project-specific approved supplier quotation;
2. project approved price catalog;
3. company approved catalog;
4. source/effective date байхгүй бол 0₮ бус `PRICE_MISSING`.

## 6. Forecast policy

### Threshold

- `warningThresholdWorkingDays`: project setting; default `5`.
- `criticalThresholdWorkingDays`: project setting; default `10`.
- `ON_TRACK`: delay ≤ 0.
- `AT_RISK`: 0 < delay ≤ warning threshold.
- `LIKELY_LATE`: warning threshold < delay ≤ critical threshold.
- `CRITICAL_LATE`: delay > critical threshold эсвэл approved critical contractual
  milestone projected late.
- `INSUFFICIENT_DATA`: projected finish бодох approved quantity/productivity/calendar/
  dependency coverage хүрэлцэхгүй.

Threshold version нь forecast snapshot-д persisted байна.

### Cold start

- Work item-д 3-аас цөөн approved, valid actual working-day observation байвал
  approved productivity norm ашиглана.
- Cold-start forecast `COLD_START_NORM` method flag-тай, confidence `0.60`-аас
  ихгүй байна.
- Approved productivity norm ч байхгүй бол duration/finish зохиохгүй,
  `INSUFFICIENT_DATA` гаргана.

### Outlier

- Rejected, `UNVERIFIABLE`, wrong-unit, duplicate-evidence-only actual observation
  productivity sample-д орохгүй.
- 7-оос доош valid sample үед automatic statistical outlier classification хийхгүй.
- 7 ба түүнээс олон sample үед median absolute deviation-ийн `3 × MAD` босгоор
  outlier candidate flag гаргана.
- Outlier candidate-г автоматаар устгахгүй. Reviewer `INCLUDE` эсвэл `EXCLUDE`
  шийдвэр гаргана.
- Forecast нь зөвхөн approved inclusion decision ашиглана.

## 7. Approval role ба state transition

| Target               | Draft     | Review       | Approve        |
| -------------------- | --------- | ------------ | -------------- |
| QuantityTakeoff      | A0/System | Engineer     | Estimator      |
| Estimate             | System    | Estimator    | ProjectManager |
| DailyPlan            | A5/System | SiteEngineer | ProjectManager |
| DailyReport          | A1/System | SiteEngineer | ProjectManager |
| ProgressVerification | A5/System | SiteEngineer | ProjectManager |
| BaselineChange       | System    | Engineer     | ProjectManager |

Canonical state:

```text
DRAFT
  ├─ submit → REVIEW_REQUIRED
  ├─ reject → REJECTED
  └─ cancel → CANCELLED

REVIEW_REQUIRED
  ├─ edit → DRAFT (new revision)
  ├─ reject → REJECTED
  └─ approve → APPROVED

APPROVED
  ├─ apply → APPLIED
  └─ replace by newer approved version → SUPERSEDED
```

- `APPROVED`, `APPLIED`, `SUPERSEDED` record immutable.
- Edit нь existing approved record mutate хийхгүй, шинэ draft revision үүсгэнэ.
- Apply command idempotency key, source hash, reviewer/approver, reason, timestamp-тэй.
- Production-д өөрийн үүсгэсэн draft-ийг өөрөө approve хийхийг default-аар хориглоно;
  explicit emergency override нь reason болон audit шаардана.

## 8. Snapshot boundary

`ProjectAnalysisSnapshotV1` нь одоогийн analysis/A1–A4 compatibility read model хэвээр.

`OperationalPlanningSnapshotV1` нь:

- approved baseline/schedule version reference;
- remaining quantities;
- crew/equipment/material availability;
- approved actual;
- blockers/inspection/weather/calendar;
- source catalog;
- as-of болон policy version;

агуулна.

Raw PDF geometry, UI state, unapproved candidate, unrestricted tenant data-г operational
snapshot-д хийхгүй. A0 approved command canonical data-д apply болсны дараа adapter
operational snapshot үүсгэнэ.

## 9. Phase 0 exit gate

- [x] Requirement ID давхцахгүй.
- [x] Requirement бүр `MUST / SHOULD / LATER` priority-тай.
- [x] A0/A1/A2/A5 ownership давхцахгүй.
- [x] MVP болон advanced scope тусгаарлагдсан.
- [x] Quantity/norm/price source priority батлагдсан.
- [x] Unit/currency/timezone/calendar/rounding policy батлагдсан.
- [x] Forecast threshold/cold-start/outlier policy батлагдсан.
- [x] Approval role/state transition батлагдсан.
- [x] Existing v1 contract breaking change шаардахгүй.
- [x] Architecture decision ADR-0009–0015-д бүртгэгдсэн.
- [x] Documentation gate автоматаар шалгах боломжтой.
