# BuildWatch v2.2 — Одоогийн төсөлд нэгтгэн хэрэгжүүлэх roadmap

**Эх requirement:** `../buildwatch.md`  
**Одоогийн суурь:** `agents` A1–A4 core + deterministic analysis + local `agent-console`  
**Зорилго:** зураг төсөл/Excel-ээс baseline draft үүсгэх A0 болон өдөр тутмын төлөвлөлт, гүйцэтгэл баталгаажуулалт, rolling forecast хийх A5-ийг одоогийн системийг эвдэхгүйгээр нэмэх  
**Статус:** хэрэгжүүлэх дарааллын эх баримт

---

## 1. Гол шийдвэр

`buildwatch.md`-ийг одоогийн v2.0 requirement болон
`PRODUCTION-ROADMAP.md`-ийг шууд орлуулах баримт гэж үзэхгүй.

Дараах байдлаар ашиглана:

1. v2.0 нь auth, tenant, baseline, execution, dashboard, report, security,
   deployment-ийн үндсэн requirement хэвээр.
2. `buildwatch.md` v2.2 нь A0, A5, зураг төсөл, quantity, estimate,
   daily planning, progress verification, rolling forecast-ийн өргөтгөл байна.
3. Одоогийн A1–A4 contract болон deterministic analysis-ийг эвдэхгүй.
4. Шинэ domain contract бүр version-тэй, тусдаа bounded context байна.
5. Тоо хэмжээ, материал, төсөв, хугацаа, daily target, forecast-ийг LLM
   бодохгүй.
6. Agent зөвхөн ангилал, candidate, тодруулга, тайлбар, recommendation draft
   гаргана.
7. Албан ёсны өгөгдөл зөвхөн хүний approval болон backend transaction-аар
   өөрчлөгдөнө.

---

## 2. Одоогийн төслөөс шууд дахин ашиглах хэсэг

| Одоогийн чадвар                 | Шинэ requirement-д ашиглах нь                    |
| ------------------------------- | ------------------------------------------------ |
| `ProjectAnalysisSnapshotV1`     | A5 planning/verification/forecast-ийн read model |
| Calendar-aware CPM              | A0 schedule draft болон A5 projected finish      |
| Actual-pace forecast            | Rolling forecast-ийн суурь                       |
| Recovery scenarios              | A2/A5 recovery option-ийн суурь                  |
| 11 deterministic rule           | Daily variance болон forecast alert              |
| A1 daily-report extraction      | Оройн actual text/image intake                   |
| A1 human review/apply           | Approved actual л forecast-д орох gate           |
| Image inspection/preprocessing  | Design document preview болон photo evidence     |
| Artifact store/malware ports    | Drawing, photo, PDF artifact хадгалалт           |
| A2 observation/recommendation   | A5-ийн deterministic үр дүнг тайлбарлах          |
| A3 report/PDF                   | Daily/weekly/monthly planning ба forecast report |
| A4 read-only tools              | A0/A5-ийн шинэ өгөгдлийг лавлах                  |
| pg-boss/runtime guard           | A0/A5 async jobs, retry, budget, dead-letter     |
| Langfuse/Sentry adapters        | A0/A5 agent run observability                    |
| Simulation/evaluation framework | Шинэ golden dataset, metric, release gate        |

---

## 3. Одоогийн contract-ийг эвдэхгүй байх дүрэм

### 3.1 Freeze хийх contract

Дараах contract-ийг breaking change хийхгүй:

- `ProjectAnalysisSnapshotV1`
- `DailyReportDraftV1`
- `ApprovedDailyReportCommandV1`
- `DeterministicAnalysisV1`
- A2 recommendation output
- A3 document output
- A4 answer/source output
- production tool authorization context

### 3.2 Шинээр нэмэх тусдаа contract

```text
DesignIntakeManifestV1
DrawingRevisionV1
VerifiedDrawingScaleV1
DesignElementCandidateV1
QuantityTakeoffDraftV1
ApprovedQuantityTakeoffCommandV1
EstimateDraftV1
ApprovedBaselineCommandV1

OperationalPlanningSnapshotV1
DailyWorkPlanDraftV1
ApprovedDailyWorkPlanCommandV1
ProgressVerificationDraftV1
ApprovedProgressVerificationCommandV1
RollingProductivitySnapshotV1
OperationalForecastSnapshotV1
RecoveryProposalDraftV1
```

### 3.3 Snapshot хоорондын хил

```text
A0 input artifacts
      ↓
Design/quantity/estimate drafts
      ↓ human approval
ApprovedBaselineCommandV1
      ↓ backend projector
ProjectAnalysisSnapshotV1
      ↓
OperationalPlanningSnapshotV1
      ↓
A5 daily plan / verification / forecast
```

`ProjectAnalysisSnapshotV1`-ийг зураг төслийн бүх raw geometry болон UI state-аар
томруулахгүй. A0-ийн detailed data тусдаа aggregate-д хадгалагдана.

---

## 4. Agent ба deterministic service-ийн хариуцлага

### A0 — зураг төсөл ба baseline

**AI хийж болно:**

- document type, discipline, revision candidate ангилах;
- drawing element candidate санал болгох;
- dimension/source text candidate ялгах;
- norm, price, productivity catalog mapping санал болгох;
- дутуу мэдээллийн асуулт гаргах;
- baseline draft-ийн тайлбар бэлтгэх.

**AI хийхгүй:**

- scale баталгаагүй metric quantity;
- geometry formula;
- material requirement;
- cost formula;
- schedule duration;
- critical path;
- албан ёсны estimate approval.

### A1 — талбайн actual intake

A1-ийн одоогийн үүргийг хэвээр хадгална:

- text/image → structured daily-report draft;
- quantity, attendance, material, blocker;
- duplicate/logic/confidence;
- human edit/approve/reject.

A1 daily plan үүсгэхгүй, completion status эцэслэхгүй.

### A5 — operational planning orchestrator

A5-ийн үндсэн тооцоо deterministic байна:

- eligible work;
- priority;
- daily target;
- resource/material/weather feasibility;
- double-booking;
- planned-vs-actual variance;
- completion status;
- rolling productivity;
- forecast confidence;
- projected finish;
- recovery scenario impact.

LLM нь зөвхөн:

- plan-ийн тайлбар;
- дутуу мэдээллийн асуулт;
- review note;
- recovery option-ийн хүний унших тайлбар;

гаргаж болно.

### A2 ба A5-ийн зааг

| A5                                    | A2                                                     |
| ------------------------------------- | ------------------------------------------------------ |
| Тухайн өдөр юу хийх боломжтойг тооцно | Олон өдөр/долоо хоногийн хэв маяг олно                 |
| Planned-vs-actual variance бодно      | Root cause болон alert холбоо тайлбарлана              |
| Rolling productivity/forecast бодно   | Forecast-ийн эрсдэлийн narrative гаргана               |
| Recovery scenario impact бодно        | Хүний сонголтод зориулсан recommendation draft гаргана |

A2 хугацаа, зардлын тоо дахин бодохгүй. A5 deterministic service-ийн үр дүнг
эх сурвалжтайгаар ашиглана.

---

# PHASE 0 — Requirement hardening ба architecture freeze

**Төлөв:** `COMPLETE` — 2026-07-31  
**Requirement catalog:** `docs/buildwatch-v2.2-requirement-catalog.md`  
**Architecture freeze:** `docs/phase-0-buildwatch-v2.2-architecture-freeze.md`  
**Decision records:** `docs/adr/0009`–`0015`

## 0.1 Хийх ажил

- `buildwatch.md` requirement бүрд тогтвортой ID өгөх:
  - `A0-*`
  - `A5-*`
  - `DET-GEO-*`
  - `DET-PLAN-*`
  - `DET-VERIFY-*`
  - `DET-FORECAST-*`
  - `UI-DESIGN-*`
  - `UI-PLAN-*`
  - `BE-DESIGN-*`
  - `BE-PLAN-*`
- Requirement бүрийг `MUST / SHOULD / LATER` гэж ангилах.
- IFC-ийн зөрчлийг шийдэх:
  - MVP: Excel + vector architectural PDF;
  - later: IFC, structural, MEP.
- A1/A5 болон A2/A5 ownership-ийг энэ roadmap-ийн дагуу батлах.
- Unit, currency, timezone, working calendar-ийн canonical дүрэм батлах.
- Quantity source-ийн priority батлах:
  1. approved engineer quantity;
  2. verified vector geometry;
  3. approved Excel;
  4. image/photo нь exact quantity source биш.
- Forecast warning threshold, cold-start, outlier policy батлах.
- Approval role болон state transition батлах.

## 0.2 Нэмэх ADR

```text
0009-buildwatch-v22-extension-boundary.md
0010-a0-candidate-not-authoritative.md
0011-a5-deterministic-orchestrator.md
0012-vector-pdf-before-ifc.md
0013-quantity-unit-and-rounding-policy.md
0014-operational-snapshot-boundary.md
0015-photo-duplicate-and-privacy-policy.md
```

## 0.3 Exit gate

- [x] Requirement ID давхцахгүй.
- [x] A0/A1/A2/A5 ownership давхцахгүй.
- [x] MVP болон advanced scope тодорхой.
- [x] Quantity/cost/forecast-ийн эх сурвалж ба rounding policy батлагдсан.
- [x] Existing v1 contract breaking change шаардахгүй.

---

# PHASE 1 — Shared contracts ба deterministic boundaries

**Төлөв:** `COMPLETE` — 2026-07-31  
**Evidence:** `docs/phase-1-buildwatch-v2.2-contracts.md`  
**Gate:** `pnpm.cmd run phase1:v22:gate`

## 1.1 Санал болгох бүтэц

```text
src/contracts/design/
src/contracts/quantity/
src/contracts/estimate/
src/contracts/schedule/
src/contracts/planning/
src/contracts/verification/
src/contracts/forecast/
```

## 1.2 Design contract

- design document manifest;
- drawing revision;
- page/discipline;
- scale status;
- source region;
- element candidate;
- engineer review decision;
- missing information issue.

## 1.3 Quantity/estimate contract

- quantity formula;
- dimension input;
- unit;
- waste factor;
- source reference;
- norm/price/productivity version;
- manual adjustment;
- reviewer/approval;
- immutable approved version.

## 1.4 Daily planning contract

- DailyWorkPlan state machine;
- DailyWorkPlanItem;
- resource/material/precondition;
- conflict;
- feasibility result;
- manager decision;
- idempotency key.

## 1.5 Verification contract

- actual quantity;
- declared/verified quantity;
- evidence coverage;
- photo checks;
- completion status;
- variance;
- clarification/review issue;
- approved command.

## 1.6 Forecast contract

- 3/7/14-day productivity;
- sample coverage;
- confidence factors;
- remaining duration;
- projected finish;
- delay;
- driver/source;
- recovery scenario.

## 1.7 Заавал баримтлах дүрэм

- мөнгө decimal string;
- quantity decimal string;
- unit canonical code;
- бүх aggregate `tenantId`, `projectId`-тай;
- бүх approved command idempotency key-тэй;
- бүх тоон талбар source reference-тэй;
- AI draft албан ёсны status үүсгэхгүй;
- state transition schema validation-тай.

## 1.8 Тест

- schema positive/negative;
- version compatibility;
- unknown field reject;
- cross-tenant source reject;
- duplicate ID reject;
- invalid state transition reject;
- money/unit rounding;
- source-less quantity reject.

## 1.9 Exit gate

- [x] Бүх шинэ contract strict Zod schema-тай.
- [x] Golden fixture бүр schema pass.
- [x] Invalid source/scale/state fixture reject.
- Existing A1–A4 tests contract changeгүй.

---

# PHASE 2 — Simulation болон answer-key foundation

**Төлөв:** `COMPLETE` — 2026-07-31  
**Gate:** `pnpm.cmd run phase2:v22:gate`

Энэ phase нь A0/A5 logic-ийг frontend/backend-ээс өмнө шалгах canonical dataset
үүсгэнэ.

## 2.1 Existing simulation өргөтгөх

Одоогийн 48 work item, 12-week simulation дээр:

- zone;
- planned quantity/unit;
- crew;
- equipment;
- resource availability;
- material coverage;
- inspection precondition;
- weather restriction;
- daily planning rule;
- evidence rule;
- daily plan;
- approved actual;
- photo metadata;
- verification label;
- rolling forecast;

нэмнэ.

## 2.2 Шигтгэх scenario

- predecessor дуусаагүй;
- material shortage;
- crew unavailable;
- equipment double-booking;
- zone conflict;
- heavy rain restriction;
- inspection pending;
- critical work omitted;
- planned target partial;
- approved blocker;
- missing report;
- blurry/dark photo;
- duplicate photo;
- previous-day reused photo;
- report/photo mismatch;
- false `COMPLETED`;
- insufficient data forecast;
- critical delay;
- recovery option conflict.

## 2.3 Answer key

Case бүр:

```text
expectedEligible
expectedPriority
expectedDailyTarget
expectedConflicts
expectedCompletionStatus
expectedVariance
expectedForecastStatus
expectedDrivers
expectedSourceIds
```

агуулна.

## 2.4 Exit gate

- [x] 48 work item бүхий backward-compatible operational extension.
- [x] 40 planning day.
- [x] 120 plan item decision.
- [x] 117 synthetic photo metadata.
- [x] 39 progress verification draft.
- [x] 10 rolling forecast snapshot.
- [x] 20 hidden answer-key case.
- [x] Positive/negative/boundary scenario бүртэй.
- [x] Cross-tenant private fixture тусдаа.
- [x] Public agent dataset-д answer key/private marker байхгүй.
- [x] Replay monotonic, aggregate бүр strict schema pass.
- [x] LLM/OpenAI унтарсан үед бүх expected deterministic result гардаг.

Implementation evidence:

- `src/simulation/buildwatch-v22-contracts.ts`;
- `src/simulation/buildwatch-v22-operational-simulation.ts`;
- `src/scripts/generate-buildwatch-v22-simulation.ts`;
- `tests/simulation/buildwatch-v22-operational-simulation.test.ts`;
- `docs/phase-2-buildwatch-v2.2-simulation.md`.

---

# PHASE 3 — A5 daily planning deterministic core

**Төлөв:** `COMPLETE` — 2026-08-02  
**Gate:** `pnpm.cmd run phase3:v22:gate`  
**Нотолгоо:** `docs/phase-3-buildwatch-v2.2-daily-planning.md`

Энэ phase-ийг A0-оос өмнө хийнэ. Учир нь одоогийн simulation, baseline, CPM,
material, blocker, forecast data-г шууд ашиглаж дипломын гол daily control loop-ийг
түрүүлж ажиллуулж чадна.

## 3.1 Санал болгох бүтэц

```text
src/planning/eligibility.ts
src/planning/priority.ts
src/planning/daily-target.ts
src/planning/resource-conflicts.ts
src/planning/feasibility.ts
src/planning/plan.ts
src/planning/review.ts
src/planning/jobs.ts
```

## 3.2 Eligible work

Дараахыг deterministic шалгана:

- dependency/predecessor;
- inspection;
- material coverage;
- crew availability;
- equipment availability;
- zone conflict;
- weather;
- open blocker;
- safety restriction;
- activity date window.

## 3.3 Priority

Stable tie-breaker ашиглана:

1. critical path;
2. total float;
3. milestone dependency;
4. downstream unlock count;
5. booked resource/material;
6. baseline sequence;
7. work-item ID.

Ижил input үргэлж ижил plan гаргана.

## 3.4 Daily target

```text
min(
  remaining quantity,
  approved productivity × crew factor × shift factor,
  material capacity,
  equipment capacity,
  zone capacity
)
```

Input бүр source/version-тэй байна. Missing input үед тоо зохиохгүй,
`INSUFFICIENT_INFORMATION` гаргана.

## 3.5 Conflict

- crew double-booking;
- equipment double-booking;
- zone overlap;
- predecessor conflict;
- material shortage;
- calendar conflict;
- invalid shift;
- required inspection missing.

## 3.6 Review

```text
DRAFT
→ REVIEW_REQUIRED
→ APPROVED
→ IN_PROGRESS
→ CLOSED
```

Reject/correction reason audit-тэй байна.

## 3.7 Job

- 05:00 timezone-aware schedule;
- manager requested run;
- stable idempotency key;
- retry/dead-letter;
- replay;
- same date/project duplicate plan үүсгэхгүй.

## 3.8 Тест

- eligibility matrix;
- all priority tie-breakers;
- daily-target boundary;
- double-booking;
- material shortage;
- weather;
- missing data;
- idempotent generation;
- approval state machine;
- 50-work-item deterministic benchmark.

## 3.9 Exit gate

- Eligible selection precision/recall target pass.
- Critical omission `0`.
- Undetected resource conflict `0`.
- Shortage-той ажлыг feasible гэж гаргасан тоо `0`.
- Same input → byte-stable deterministic output.
- LLM шаардлагагүй.

---

# PHASE 4 — Evening actual ба progress verification

**Төлөв:** `COMPLETE` — Phase 4.1–4.7 `COMPLETE` (2026-08-03)  
**Phase 4.1 gate:** `pnpm.cmd run phase4.1:v22:gate`  
**Phase 4.1 нотолгоо:** `docs/phase-4.1-buildwatch-v2.2-a1-integration.md`  
**Phase 4.2 gate:** `pnpm.cmd run phase4.2:v22:gate`  
**Phase 4.2 нотолгоо:** `docs/phase-4.2-buildwatch-v2.2-photo-evidence.md`  
**Gate:** `pnpm.cmd run phase4:v22:gate`  
**Нотолгоо:** `docs/phase-4-buildwatch-v2.2-progress-verification.md`

## 4.1 A1 integration

A1 approved command-оос:

- actual quantity;
- cumulative quantity;
- attendance;
- hours;
- material usage;
- equipment usage;
- blocker;
- source artifacts;

авна.

Draft A1 data шууд verification/forecast-д орохгүй.

**Хэрэгжсэн:** `ApprovedDailyReportCommandV1`-ийг strict parse хийж,
`ApprovedA1ActualBundleV1` болгон deterministic хөрвүүлдэг approved-only adapter,
tenant/project scope, source lineage, idempotency болон no-invention хамгаалалттай.
Bundle нь verification-д eligible боловч approved progress verification гарахаас өмнө
forecast-д eligible биш.

## 4.2 Photo evidence pipeline

Existing inspection/preprocessing дээр:

- blur score;
- darkness/exposure;
- perceptual duplicate hash;
- previous-day reuse;
- capture/report date;
- evidence angle coverage;
- reference marker;
- work-item link;
- privacy status;

нэмнэ.

Exact quantity-г photo-оос гаргахгүй.

**Хэрэгжсэн:** normalized image bytes дээр deterministic decode/media validation,
SHA-256, edge-based sharpness, brightness, 64-bit dHash; versioned policy дээр
PE-01–PE-10 canonical checks; exact/near duplicate, previous-day reuse, date/link,
angle, marker, contradiction, privacy evaluation; idempotency болон 117-photo
release evaluation бэлэн. Near-duplicate нь warning/review бөгөөд official actual
үүсгэхгүй.

## 4.3 Progress verification

Deterministic input:

- approved daily plan;
- approved A1 actual;
- photo evidence checks;
- mandatory checklist;
- material movement;
- attendance;
- engineer decision.

Output:

```text
COMPLETED
PARTIALLY_COMPLETED
NOT_COMPLETED
NOT_STARTED
BLOCKED
UNVERIFIABLE
```

## 4.4 Гол дүрэм

- `COMPLETED` зөвхөн quantity/evidence/checklist хангагдсан үед;
- mismatch үед `UNVERIFIABLE`;
- duplicate image автоматаар approve болохгүй;
- missing quantity-г photo-оос нөхөхгүй;
- approved blocker л `BLOCKED`;
- verified actual нь declared actual-аас тусдаа;
- human override reason шаардлагатай.

## 4.5 Apply

Зөвхөн `ApprovedProgressVerificationCommandV1`:

- progress history;
- daily variance;
- productivity sample;
- material ledger;
- forecast input;

үүсгэнэ.

## 4.6 Тест

- status decision table;
- false completed negative cases;
- duplicate image;
- reused image;
- incomplete evidence;
- report/photo/material mismatch;
- approved blocker;
- idempotent apply;
- unapproved draft exclusion;
- tenant isolation.

## 4.7 Exit gate

- Completion classification accuracy ≥ 90%.
- False `COMPLETED` < 3%.
- Duplicate precision ≥ 90%.
- Unverifiable case таамаглалгүй review-д орно.
- Unapproved actual forecast-д нөлөөлөхгүй.

---

# PHASE 5 — Rolling productivity, forecast ба recovery

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase5:v22:gate`  
**Нотолгоо:** `docs/phase-5-buildwatch-v2.2-forecast-recovery.md`

## 5.1 Rolling productivity

Дараахыг тусад нь тооцно:

- 3-day;
- 7-day;
- 14-day;
- approved norm;
- weighted current productivity.

Policy-д:

- minimum sample;
- outlier handling;
- blocked day exclusion/inclusion;
- weather factor;
- crew-size normalization;
- shift normalization;
- insufficient-data fallback;

тодорхой байна.

## 5.2 Remaining duration

- remaining approved quantity;
- normalized productivity;
- calendar;
- blockers;
- material/resource capacity;

дээр үндэслэнэ.

## 5.3 Projected finish

Existing calendar-aware forecast/CPM-ийг reuse хийнэ.

- approved baseline finish;
- current schedule version;
- remaining duration;
- dependency propagation;
- critical path;
- working calendar.

## 5.4 Confidence

Дурын AI score биш. Дараах factor-ийн deterministic weighted score:

- report coverage;
- quantity coverage;
- evidence coverage;
- sample length;
- dependency completeness;
- resource completeness;
- unresolved blocker rate;
- norm/price completeness.

Weight/version нь configuration contract-той байна.

## 5.5 Recovery

Existing scenario engine-ийг өргөтгөнө:

- extra crew;
- second shift;
- extra equipment;
- parallelization;
- resequence;
- material order acceleration;
- subcontractor capacity.

Scenario бүр:

- schedule impact;
- additional cost;
- resource requirement;
- dependency/zone conflict;
- risk;
- sources;

агуулна.

## 5.6 A2 integration

A5 deterministic forecast/recovery output → A2 root-cause/trend/recommendation
narrative.

A2 шинэ тоо үүсгэхгүй.

## 5.7 Exit gate

- [x] Project finish MAE `0.00 ≤ 7 working day`.
- [x] Critical delay recall `100.00% ≥ 90%`.
- [x] Average early warning `14.52 ≥ 5 working day`.
- [x] False alert rate `0.00%`.
- [x] Forecast driver source coverage `100.00%`.
- [x] Baseline mutation count `0`.

**PHASE 5 EXIT GATE: PASS**

---

# PHASE 6 — A0 narrow MVP: Excel + vector architectural PDF

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase6:v22:gate`  
**Evidence:** `docs/phase-6-buildwatch-v2.2-design-intake.md`

IFC, structural, MEP-ийг энэ phase-д хийхгүй.

## 6.1 File intake

- checksum;
- duplicate;
- media/file validation;
- malware scan port;
- size/page limit;
- document classification;
- vector/raster determination;
- revision register;
- page discipline.

## 6.2 Excel workbook

Эхний MVP:

- project;
- drawing register;
- floors/zones;
- material catalog;
- work norms;
- prices;
- productivity;
- dependencies;
- calendar;
- daily planning rules;
- crews/shifts;
- evidence rules;
- approval matrix.

Sheet бүр:

- strict schema;
- column mapping;
- row-level error report;
- checksum;
- import version;
- source artifact;

хадгална.

## 6.3 Scale verification

Scale source:

1. vector dimension;
2. drawing title block;
3. engineer-entered known distance;
4. approved manual calibration.

Scale статус:

```text
UNKNOWN
CANDIDATE
VERIFIED
REJECTED
```

`VERIFIED` биш үед metric quantity блоклогдоно.

## 6.4 Element candidate

Эхний architecture scope:

- floor;
- zone;
- room;
- wall;
- door;
- window.

Candidate бүр:

- type;
- geometry;
- source page;
- bounding region;
- confidence;
- extraction method;
- review status;

агуулна.

## 6.5 Human review

- viewer дээр source highlight;
- accept/edit/reject;
- dimension correction;
- element merge/split;
- scale correction;
- audit reason.

## 6.6 Тест/evaluation

- vector PDF fixtures;
- rotated pages;
- mixed scale;
- duplicate revision;
- missing dimension;
- source-less element;
- scale reject;
- engineer-labeled element precision/recall.

## 6.7 Exit gate

- [x] Scale баталгаагүй metric dimension/quantity `0`.
- [x] Source-гүй accepted element/quantity `0`.
- [x] Revision conflict review-д орно.
- [x] Rotated page болон mixed-scale adversarial gate pass.
- [x] 18-sheet workbook strict schema/error report pass.
- [x] Accept/edit/reject/merge/split/scale-correction audit pass.
- [x] Vector architecture precision/recall `100.00% / 100.00%`.

**PHASE 6 EXIT GATE: PASS**

---

# PHASE 7 — Quantity, material, estimate, WBS ба baseline

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase7:v22:gate`  
**Evidence:** `docs/phase-7-buildwatch-v2.2-baseline-generation.md`

## 7.1 Geometry/quantity

Deterministic formula registry:

- length;
- area;
- opening deduction;
- volume;
- count;
- rounding;
- unit conversion.

Formula бүр:

- formula ID/version;
- input dimensions;
- source references;
- result;
- unit;
- adjustment;
- reviewer;

агуулна.

## 7.2 Quantity review

- candidate;
- engineer edit;
- adjustment reason;
- accepted quantity;
- immutable approved takeoff version;
- version comparison.

## 7.3 Material requirement

```text
approved quantity
× approved norm version
× waste factor
```

Missing norm үед final estimate блоклогдоно.

## 7.4 Price/cost

- effective date;
- currency;
- VAT/tax policy;
- supplier quotation;
- labor;
- equipment;
- material;
- waste;
- contingency;
- rounding.

Missing price-г `0` гэж үзэхгүй.

## 7.5 WBS/schedule

- quantity item → work template;
- productivity → duration;
- crew/resource requirement;
- dependency;
- calendar;
- CPM;
- schedule draft.

## 7.6 Approval

```text
Quantity draft
→ engineer review
→ estimator approval
→ estimate draft
→ manager approval
→ ApprovedBaselineCommandV1
→ immutable BaselineVersion
```

## 7.7 Exit gate

- [x] Approved quantity дээр formula `100.00%` deterministic.
- [x] Quantity/material/estimate source coverage `100.00%`.
- [x] Source-less болон unverified-scale final quantity row `0`.
- [x] Missing material norm final row `0` бөгөөд estimate approval блоклогдоно.
- [x] Missing/expired/ambiguous price final row `0`; `0.00 MNT` гэж зохиохгүй.
- [x] Estimate version runtime immutable.
- [x] Material/labor/equipment, VAT, contingency exact decimal.
- [x] Work template/productivity/resource/calendar mapping pass.
- [x] FS/SS/FF/SF CPM болон cycle tests pass.
- [x] Schedule review/approval immutable version-тэй.
- [x] Approved baseline lineage/budget consistency pass.
- [x] Baseline change шинэ version, supersession болон reason үүсгэнэ.
- [x] Deterministic replay pass, baseline mutation `0`.
- [x] Adversarial evaluation `7/7 PASS`.

**PHASE 7 EXIT GATE: PASS**

---

# PHASE 8 — A0/A5 tool layer, orchestration ба evaluation

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase8:v22:gate`  
**Evidence:** `docs/phase-8-buildwatch-v2.2-orchestration.md`

## 8.1 A0 read tools

```text
getDesignDocuments
getDrawingRevisions
getDrawingPages
getVerifiedScale
getExtractedElements
getQuantityTakeoff
getMaterialNorms
getMaterialPrices
getProductivityRates
getScheduleDependencies
getEstimateAssumptions
```

## 8.2 A5 read tools

```text
getCurrentSchedule
getEligibleWorkItems
getRemainingQuantities
getCrewAvailability
getEquipmentAvailability
getMaterialAvailability
getWeatherConstraints
getOpenBlockers
getDailyPlan
getDailyActuals
getPhotoEvidence
getProgressVerification
getRollingProductivity
getLatestForecast
getRecoveryScenarios
```

## 8.3 Authorization

- tenant scope;
- project assignment;
- role permission;
- report-text permission;
- cost permission;
- design-document permission;
- artifact signed-read;
- source catalog scope.

Tool нь unauthorized object байгаа эсэхийг ч задруулахгүй.

## 8.4 A0 orchestration

```text
classify
→ inspect metadata
→ request scale review
→ propose elements
→ deterministic quantity
→ propose catalog mappings
→ deterministic estimate/schedule
→ validate sources
→ human review queue
```

## 8.5 A5 orchestration

```text
load approved operational snapshot
→ deterministic plan/verification/forecast
→ optional AI explanation
→ validate sources/numbers
→ human review queue
```

## 8.6 Evaluation

Тусдаа golden suite:

- A0 document classification;
- A0 element candidate;
- scale safety;
- quantity source grounding;
- A5 planning;
- A5 photo/verification;
- A5 forecast;
- A5 recovery;
- tenant isolation;
- LLM-off fallback.

## 8.7 Exit gate

- [x] Тоон hallucination `0`.
- [x] Unauthorized source `0`.
- [x] Unauthorized object disclosure `0`.
- [x] Tenant-isolation violation `0`.
- [x] Signed artifact болон catalog-scope leak `0`.
- [x] Tool coverage `100.00%` (`26/26`).
- [x] A0/A5 tool coverage `11/11`, `15/15`.
- [x] A0 design-to-baseline draft orchestration pass.
- [x] Verified scale байхгүй үед metric quantity `0`.
- [x] A5 plan/verification/forecast/recovery orchestration pass.
- [x] Recovery baseline mutation `0`.
- [x] Golden suite `10/10 PASS`.
- [x] Adversarial suite `10/10 PASS`.
- [x] Deterministic replay pass.
- [x] LLM-off core flow pass.
- [x] A0/A5 prompt, model, tool, schema version persisted.

**PHASE 8 EXIT GATE: PASS**

---

# PHASE 9 — Canonical backend, database, auth ба event integration

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase9:v22:gate`  
**Evidence:** `docs/phase-9-buildwatch-v2.2-backend.md`

Энэ phase хүртэл in-memory/file/simulation adapter ашиглаж болно. Эндээс production
system-of-record үүснэ.

## 9.1 Backend module

```text
identity
tenants
projects
artifacts
design
quantity
catalogs
estimates
baselines
resources
planning
execution
verification
forecast
recommendations
reports
notifications
audit
agents
```

## 9.2 Prisma migration wave

### Wave A — design intake

- DesignDocument
- DrawingRevision
- DrawingPage
- DrawingScale
- DesignElement
- ElementGeometry
- ElementSourceRef

### Wave B — quantity/catalog/estimate

- QuantityTakeoffVersion
- QuantityTakeoffItem
- TakeoffAdjustment
- MaterialCatalog/Alias
- NormCatalog/Version
- WorkNorm
- ProductivityRate
- PriceCatalog/Entry
- EstimateVersion/Line/Assumption/Scenario

### Wave C — schedule/resource

- ScheduleVersion
- ScheduleActivity
- ScheduleDependency
- ResourceRequirement
- Crew/Availability
- Equipment/Availability

### Wave D — daily planning/execution

- DailyWorkPlan/Item
- DailyPlanResource/Material/Precondition
- DailyReport entries
- PhotoEvidence/Link/Quality/Duplicate

### Wave E — verification/forecast/review

- ProgressVerification/Issue
- DailyVariance
- ForecastSnapshot/WorkItem/Driver
- RecoveryScenario
- ReviewTask/Decision/Correction
- ApprovalMatrix
- AuditLog
- OutboxEvent

## 9.3 DB дүрэм

- tenant/project composite index;
- project ownership foreign key;
- immutable approved version;
- append-only ledger;
- reversal entry;
- idempotency unique key;
- optimistic version;
- audit actor/time/reason;
- transaction + outbox;
- soft delete/retention policy;
- artifact object-store reference;
- raw binary-г үндсэн relational row-д хадгалахгүй.

## 9.4 Auth

- email/password;
- invite;
- seven-role RBAC;
- JWT access;
- refresh rotation;
- project assignment;
- design/estimate approval permission;
- IDOR tests.

## 9.5 API

- OpenAPI contract;
- generated client;
- stable error codes;
- cursor pagination;
- idempotency header;
- signed artifact URL;
- approval endpoints;
- version comparison;
- forecast query;
- audit query.

## 9.6 Event/job

pg-boss:

- A0 parse/extract;
- quantity recalculation;
- daily plan generation;
- evening reminder;
- verification;
- rolling forecast;
- A2 observation;
- A3 report.

RabbitMQ/outbox:

- notification;
- external integration;
- fan-out side effects.

## 9.7 Exit gate

- Two-tenant API IDOR pass.
- Approved command atomic transaction.
- Duplicate event no duplicate result.
- Queue restart/replay pass.
- Signed artifact access.
- Audit coverage.
- A1–A5 production adapters pass.

Implementation evidence, command sequence, RBAC matrix, API contract, migration
wave болон 64-item exit checklist:

- `docs/phase-9-buildwatch-v2.2-backend.md`
- `data/evaluations/buildwatch-v22-phase9-backend.json`
- `data/evaluations/buildwatch-v22-phase9-postgres.json`
- `pnpm.cmd run phase9:v22:gate`

---

# PHASE 10 — Production frontend ба PWA

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase10:v22:gate`  
**Evidence:** `docs/phase-10-buildwatch-v2.2-frontend-pwa.md`

## 10.1 Stack

- React;
- TypeScript strict;
- Tailwind;
- generated API client;
- router;
- query/cache layer;
- form/schema validation;
- accessible component primitives;
- PWA service worker;
- IndexedDB outbox.

## 10.2 A0 screens

- project setup;
- file upload;
- drawing/revision register;
- PDF viewer;
- scale calibration;
- element/source highlight;
- quantity review;
- norm/price mapping;
- estimate review;
- WBS/dependency;
- schedule/Gantt;
- baseline approval.

## 10.3 A5 screens

- daily plan board;
- crew/equipment/material conflicts;
- plan edit/approve;
- mobile today view;
- evening submission;
- photo capture/upload;
- progress verification;
- before/after/source comparison;
- forecast dashboard;
- recovery decision.

## 10.4 Existing screens

- A1 review UI-г production component руу шилжүүлэх;
- A2 recommendation approval;
- A3 review/PDF;
- A4 source-backed chat;
- alerts;
- admin/auth.

## 10.5 Offline

- today plan local cache;
- draft report local store;
- photo upload queue;
- idempotency key;
- retry;
- conflict UX;
- no-data-loss test.

## 10.6 Exit gate

- Daily submission ≤ 2 minute.
- Core flow ≤ 10 tap target.
- Offline no-data-loss.
- Desktop/mobile responsive.
- Loading/error/empty/conflict states.
- Role-based route guard.
- Component tests + backend E2E.

Implementation evidence, route/RBAC matrix, offline sync sequence, API contract,
PostgreSQL smoke болон 78-item exit checklist:

- `docs/phase-10-buildwatch-v2.2-frontend-pwa.md`
- `data/evaluations/buildwatch-v22-phase10-postgres.json`
- `pnpm.cmd run phase10:v22:gate`

---

# PHASE 11 — Production hardening, deployment ба release

**Төлөв:** `TECHNICAL_COMPLETE / RELEASE_EVIDENCE_PENDING`

**Technical gate:** `pnpm.cmd run phase11:fast:v22:gate`

**Full regression gate:** `pnpm.cmd run phase11:technical:v22:gate`

**Баримт:** `docs/phase-11-buildwatch-v2.2-production-release.md`

## 11.1 Performance

- API p95 target;
- 50-work-item daily planning benchmark;
- PDF parsing benchmark;
- quantity calculation benchmark;
- dashboard target;
- nightly batch target;
- artifact upload limit.

## 11.2 Security

- OWASP;
- rate limit;
- file malware scan;
- content-type verification;
- zip bomb protection;
- signed URL expiry;
- tenant/project IDOR;
- secret scanning;
- prompt injection isolation;
- privacy/redaction;
- audit.

## 11.3 Observability

- structured logs;
- trace ID;
- tenant/project tags;
- Sentry;
- Langfuse;
- queue metrics;
- token/cost budget;
- forecast drift metric;
- image/quantity failure category.

## 11.4 Operations

- Docker build;
- migrations;
- backup/restore;
- object-store lifecycle;
- dead-letter replay;
- deployment;
- health/readiness;
- rollback;
- incident runbook.

## 11.5 Full release gate

- A0 narrow MVP acceptance target pass.
- A5 planning/verification/forecast target pass.
- Existing A1–A4 regression хэвээр pass.
- Real engineer-reviewed drawing/BOQ dataset.
- Real human-reviewed photo dataset.
- Two-tenant API/UI/chat isolation.
- Auth/RBAC/JWT.
- Offline PWA.
- Performance/security targets.
- Backup restore.
- Live observability.

---

# ХАВСРАЛТ A — MVP-д оруулахгүй advanced scope

Дараахыг core gate дуусахаас өмнө эхлэхгүй:

- IFC parsing;
- structural element full takeoff;
- MEP takeoff;
- raster drawing-аас general-purpose exact geometry;
- automatic official estimate approval;
- resource-leveling optimizer;
- external weather API;
- supplier quotation integration;
- video evidence analysis;
- schedule optimization solver;
- full BIM revision impact;
- RAG standards/contracts.

Эдгээр нь `buildwatch.md` Phase 5 буюу дараагийн release-ийн ажил байна.

---

# ХАВСРАЛТ B — Phase dependency

```text
Phase 0 Requirement freeze
        ↓
Phase 1 Contracts
        ↓
Phase 2 Simulation
        ↓
Phase 3 A5 Daily Planning
        ↓
Phase 4 Verification
        ↓
Phase 5 Rolling Forecast
        ↓
Phase 6 A0 Narrow Intake
        ↓
Phase 7 Quantity/Estimate/Baseline
        ↓
Phase 8 Agent/Tool/Evaluation
        ↓
Phase 9 Backend/Auth/DB
        ↓
Phase 10 Frontend/PWA
        ↓
Phase 11 Production Release
```

Phase 3–5 нь existing baseline simulation ашиглаж A0-оос тусдаа урагшилж болно.
Phase 6–7 батлагдсан baseline command гарсны дараа A5-д шинэ baseline source
болж холбогдоно.

---

# ХАВСРАЛТ C — Нэн түрүүнд хийх эхний багц

Одоогийн төслөөс дараагийн coding batch:

1. [x] `buildwatch.md` requirement ID/priority нэмэх.
2. [x] A0/A5 ownership ADR бичих.
3. [x] `DailyWorkPlanDraftV1` contract.
4. [x] `ProgressVerificationDraftV1` contract.
5. [x] `OperationalForecastSnapshotV1` contract.
6. [ ] Existing simulation-д crew/equipment/zone/planned quantity нэмэх.
7. [ ] Eligible-work deterministic function.
8. [ ] Priority/tie-break deterministic function.
9. [ ] Daily-target deterministic function.
10. [ ] Resource-conflict deterministic function.
11. [ ] Positive/negative/boundary tests.
12. [ ] Phase 3 exit-gate report.

Энэ багц дууссаны дараа UI/backend хийхгүйгээр A5-ийн эхний бодит үр дүнг CLI,
test болон `agent-console`-ийн local demo-оор шалгаж болно.

---

# ХАВСРАЛТ D — Төслийн эзэмшигчээс шаардагдах бодит өгөгдөл

## A0

- ашиглах эрхтэй vector PDF drawing;
- drawing revision;
- engineer-verified scale;
- engineer BOQ/quantity;
- material norm;
- price catalog;
- productivity norm;
- estimator/engineer label.

## A5

- crew/shift;
- equipment capacity;
- material availability;
- zone conflict;
- weather restriction;
- daily plan rule;
- actual quantity;
- approved blocker;
- engineer completion label;
- photo usage consent.

Эдгээр бодит өгөгдөлгүй үед technical simulation gate хийж болно. Харин full
release accuracy-г зөвхөн synthetic data-аар зарлахгүй.

---

# ХАВСРАЛТ E — Нэгдсэн Definition of Done

BuildWatch v2.2 нэмэлт бүрэн дууссан гэж дараах үед үзнэ:

- одоогийн A1–A4 regression буураагүй;
- A0 scale/source guard ажилладаг;
- approved quantity/estimate/baseline version ажилладаг;
- A5 daily plan deterministic;
- resource/material/weather conflict илэрдэг;
- оройн actual/photo verification ажилладаг;
- false completed target хангадаг;
- approved actual л rolling forecast-д ордог;
- projected finish, confidence, driver source-тэй;
- recovery scenario хугацаа/зардлын deterministic impact-тэй;
- A0/A5 tools tenant/project permission-тэй;
- backend transaction/outbox/idempotency ажилладаг;
- auth/RBAC/JWT/project assignment ажилладаг;
- frontend/PWA review flow ажилладаг;
- offline no-data-loss;
- acceptance metric болон real-data evidence бэлэн;
- security/performance/observability/deployment gate pass.

---

# ХАВСРАЛТ F — Амжилтын гол шалгуур

Энэ roadmap-ийн зорилго нь хамгийн олон AI capability нэмэх биш.

Амжилт гэдэг нь:

1. зураг төсөл эсвэл Excel-ээс source-backed baseline draft гаргах;
2. scale/source байхгүй үед тоо зохиохгүй байх;
3. approved baseline-ээс feasible daily plan гаргах;
4. actual болон photo evidence-ийг баталгаатай нэгтгэх;
5. approved actual-аар rolling forecast бодох;
6. амжих эсэх болон delay driver-ийг эх сурвалжтай харуулах;
7. AI санал болгож, хүн баталдаг хяналттай урсгалтай байх;
8. tenant, project, cost, artifact мэдээлэл алдагдахгүй байх;

юм.
