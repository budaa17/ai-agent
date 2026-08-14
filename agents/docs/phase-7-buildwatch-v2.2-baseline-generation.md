# BuildWatch v2.2 — Phase 7 quantity, estimate, schedule ба baseline

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase7:v22:gate`

## 1. Зорилго ба authoritative урсгал

Phase 7 нь Phase 6-ийн инженерээр баталсан element geometry-г дараах бүрэн
deterministic урсгалаар approved baseline болгоно:

```text
accepted element + exact verified scale
→ deterministic quantity draft
→ engineer review/adjustment
→ estimator approval
→ immutable approved quantity version
→ approved material norm × waste
→ effective approved price + productivity
→ deterministic estimate draft
→ project-manager approval
→ work template + productivity + calendar + dependency
→ deterministic WBS/schedule/CPM draft
→ project-manager approval
→ ApprovedBaselineCommandV1
→ immutable ApprovedBaselineVersionV1
```

LLM нь quantity, material, cost, tax, duration, CPM эсвэл baseline тоог бодохгүй.
Энэ phase-ийн бүх тоо exact decimal болон version-тэй authoritative input-аас гарна.

## 2. Geometry ба quantity formula registry

`phase7QuantityFormulaRegistry` дараах таван version-тэй formula-г агуулна:

| Formula                     | Expression                    | Unit  | Precision |
| --------------------------- | ----------------------------- | ----- | --------: |
| `qty-length-v1`             | `length`                      | `m`   |     0.001 |
| `qty-area-rectangle-v1`     | `side_1 × side_2`             | `m2`  |      0.01 |
| `qty-area-net-openings-v1`  | `gross area − Σ opening area` | `m2`  |      0.01 |
| `qty-volume-rectangular-v1` | `side_1 × side_2 × side_3`    | `m3`  |     0.001 |
| `qty-count-v1`              | `count`                       | `pcs` |   integer |

Formula trace бүр formula ID, semantic version, expression, ordered dimension IDs,
unrounded/rounded result, unit, `ROUND_HALF_UP`, conversion policy, source refs,
engineer reviewer болон review time-тай.

`convertMeasurement` нь `mm/cm/m`, `mm2/cm2/m2`, `mm3/cm3/m3`, `pcs`
conversion-ийг binary floating point ашиглахгүйгээр exact decimal-аар хийнэ.
Length, area, volume, count-ийн output rounding нь ADR-0013-тай таарна.

## 3. Quantity source, scale ба review guard

`generateQuantityTakeoffDraft` дараах нөхцөл хангаагүй input-ээс final row
үүсгэхгүй:

- candidate нь `ACCEPTED` бөгөөд ENGINEER approval-тай;
- candidate tenant/project нь request scope-той яг таарна;
- revision, page, `scaleId` нь яг тухайн `VERIFIED` scale-тай таарна;
- dimension бүр source-backed;
- source бүр tenant/project scope дотор;
- quantity-г блоклосон missing information байхгүй;
- formula input kind/unit/count зөв;
- opening deduction gross area-аас их биш;
- input болон adjustment negative final quantity үүсгэхгүй.

Engineer adjustment нь `ADD`, `SUBTRACT`, `OVERRIDE`, quantity source, reason,
ENGINEER decision, actor/time-тай. Geometry takeoff-ийн `wasteFactor = 0`; material
waste-г quantity дотор нуухгүй, зөвхөн approved material norm дээр бодно.

`reviewQuantityDraft` content SHA-256-г инженерийн decision-тэй холбоно.
`approveQuantityTakeoff` нь hash таарах ENGINEER approval болон ESTIMATOR approval
хоёуланг шаардаж, formula бүрийг дахин бодож reproducibility-г шалгана. Approved
version runtime дээр deep-frozen, source hash, version, supersedes relation-тэй.
`compareQuantityVersions` нь added/removed/changed/unchanged item болон adjustment
reason-г гаргана.

## 4. Material requirement

`calculateMaterialRequirements`:

```text
approved final quantity
× effective approved norm quantity per work unit
× (1 + approved waste factor)
```

гэсэн formula-г exact decimal-аар бодно. Norm бүр `MATERIAL_NORM` version,
effective date, approver, work/material unit, source refs-тэй. Ижил precedence-тэй
хоёр өөр version байвал нэгийг нь таахгүй, ambiguous error гаргана.

Approved norm байхгүй item-ийн material row `0`; тухайн item-ийг issue-тэй орхиж,
estimate final approval-г блоклоно. `pcs` output integer, `kg/m2/m3` output нь
ADR-0013 precision болон `ROUND_HALF_UP`-г дагана.

## 5. Price, labor/equipment ба estimate

`generateEstimateDraft` дараах effective approved input хэрэглэнэ:

- material requirement + supplier quotation price;
- productivity version-оос labor hours;
- productivity version-оос equipment hours/count;
- effective `PRICE` catalog version;
- effective `POLICY` version;
- MNT currency;
- VAT/tax rate;
- contingency rate.

Estimate line бүр `MATERIAL`, `LABOR`, `EQUIPMENT` category, priced item code,
quantity/unit, unit price, line cost, price/norm/productivity version, supplier
quotation, source refs-тэй. Material price-д supplier quotation заавал байна.

```text
line cost = exact quantity × approved unit price
tax = subtotal × approved tax rate
contingency = subtotal × approved contingency rate
total = subtotal + tax + contingency
```

Money output хоёр decimal `ROUND_HALF_UP`. Missing/expired/ambiguous price-г `0.00`
гэж оруулахгүй; line үүсгэхгүй, `NEEDS_CORRECTION` issue үүсгэнэ. Material, labor,
equipment breakdown нь line totals-той schema түвшинд заавал таарна.

`approveEstimate` зөвхөн error-гүй, дор хаяж нэг бодит priced line бүхий draft болон
PROJECT_MANAGER approval-г хүлээн авч, line/subtotal/breakdown/total-ийг дахин бодно.
Approved estimate version deep-frozen, source hash/version/supersession metadata-тай.

## 6. WBS, schedule ба CPM

`generateScheduleDraft` approved quantity item бүрийг effective approved
`WORK_TEMPLATE` болон `PRODUCTIVITY` version-тэй холбоно.

- WBS code/parent WBS;
- activity/work-item deterministic ID;
- `duration = ceil(quantity / quantityPerWorkingDay)`;
- crew class/count;
- equipment class/count;
- FS/SS/FF/SF dependency + working-day lag;
- explicit `Asia/Ulaanbaatar` calendar, weekdays, holidays;
- earliest/latest start/finish;
- total float;
- critical path;
- planned working-day start/end;

гаргана.

CPM нь topological order-оо stable ID tie-break-ээр бодно. Dependency cycle,
unknown predecessor, missing/ambiguous work template, missing/ambiguous productivity,
scope/effective-date mismatch нь approval-г блоклоно. Zero quantity-г нэг өдрийн ажил
гэж зохиохгүй; schedule row үүсгэхгүй.

`approveSchedule` PROJECT_MANAGER decision шаарддаг бөгөөд approved schedule content
deep-frozen, source hash болон immutable version metadata-тай.

## 7. Baseline compose, review ба versioning

`composeBaselineDraft` дараах lineage бүгд яг таарсны дараа л baseline draft үүсгэнэ:

- approved quantity version ID;
- approved estimate-ийн quantity version ID;
- approved schedule-ийн quantity/estimate/schedule version IDs;
- tenant/project scope;
- schedule budget ба approved estimate total.

`createCommercialReviewTransition` нь quantity, estimate, schedule, baseline-ийн
`DRAFT`, `REVIEW_REQUIRED`, `REJECTED`, `APPROVED`, `APPLIED`, `SUPERSEDED`,
`CANCELLED` lifecycle transition-ийг actor/role/reason/time-тай шалгана.

`approveBaseline` зөвхөн PROJECT_MANAGER approval-аар
`ApprovedBaselineCommandV1` үүсгэнэ. Эхний version `changeReason = null`. Өмнөх
baseline-г солих үед:

- content заавал бодитоор өөрчлөгдсөн;
- version нэгээр нэмэгдсэн;
- `supersedesVersionId` өмнөх ID-г заасан;
- non-empty `changeReason` заавал хадгалагдсан;
- шинэ source hash үүссэн;

байна. Ижил content-оор хиймэл шинэ version үүсгэхгүй.

## 8. Golden ба adversarial evaluation

Golden bundle:

- accepted geometry: 5 item;
- formula family: 5/5;
- material requirement: 5 row;
- estimate: 11 row;
- cost category: material/labor/equipment;
- schedule: 5 activity, 4 dependency;
- calendar holiday: 1;
- approved total: `7,078,825.00 MNT`;
- approved finish: `2026-08-13`.

Evaluation үр дүн:

- Formula accuracy: `100.00%`;
- Quantity source coverage: `100.00%`;
- Material source coverage: `100.00%`;
- Estimate source coverage: `100.00%`;
- Source-less final rows: `0`;
- Unverified-scale final rows: `0`;
- Missing-norm final rows: `0`;
- Missing-price final rows: `0`;
- Zero-price final rows: `0`;
- CPM: `PASS`;
- Baseline mutations: `0`;
- Deterministic replay: `PASS`;
- Reviewer chain: `PASS`;
- Adversarial cases: `7/7 PASS`.

Adversarial matrix нь negative dimension, excessive opening, stale engineer review,
missing price approval, cyclic dependency, missing work template, unchanged baseline
supersession-ийг блоклосон.

## 9. Code ба test evidence

- `src/baseline-generation/contracts.ts`;
- `src/baseline-generation/decimal.ts`;
- `src/baseline-generation/quantity.ts`;
- `src/baseline-generation/estimate.ts`;
- `src/baseline-generation/schedule.ts`;
- `src/baseline-generation/pipeline.ts`;
- `src/baseline-generation/evaluation.ts`;
- `tests/baseline-generation/`;
- `data/evaluations/buildwatch-v22-baseline-generation.json`;
- `data/buildwatch-v22/phase7-baseline-bundle.json`.

Requirement evidence: `A0-010`–`A0-016`, `DET-GEO-002`–`DET-GEO-007`,
`BE-DESIGN-004`–`BE-DESIGN-007`, `BE-DESIGN-009`, `QA-V22-003`,
`QA-V22-007`–`QA-V22-009`, `G-02`–`G-04`, `P-01`, `P-02`, `P-04`,
`P-05`, `P-08`.

## 10. Команд

```powershell
pnpm.cmd run baseline:v22
pnpm.cmd run test:baseline-generation:v22
pnpm.cmd run eval:baseline-generation:v22
pnpm.cmd run phase7:v22:gate
```

`baseline:v22` нь inspect хийх approved bundle-г
`data/buildwatch-v22/phase7-baseline-bundle.json` файлд гаргана.

## 11. Phase boundary

Phase 7 deterministic domain core бүрэн. Phase 8-д энэ service-үүд A0/A5-ийн
tenant/project permission-тэй read tools болон orchestration-д холбогдоно. Phase 9-д
canonical PostgreSQL transaction, outbox, idempotency persistence, API/auth нэмэгдэнэ.
Эдгээр дараагийн phase-ийн ажлыг Phase 7 дотор хуурамчаар production-ready гэж
тооцоогүй.

## 12. Exit gate

- [x] Length formula ID/version/source/unit/precision/reviewer-тэй.
- [x] Area formula deterministic.
- [x] Opening deduction deterministic бөгөөд gross-аас их deduction reject болно.
- [x] Volume formula deterministic.
- [x] Count formula integer output-той.
- [x] Unit conversion exact decimal.
- [x] `ROUND_HALF_UP` positive/negative/boundary tests pass.
- [x] Wrong/unverified scale-аас final quantity row `0`.
- [x] Source-гүй candidate-аас final quantity row `0`.
- [x] Engineer adjustment source/reason/decision-тэй.
- [x] Engineer review hash болон estimator approval chain ажиллана.
- [x] Approved quantity immutable version-тэй.
- [x] Quantity version comparison ажиллана.
- [x] Material нь approved norm × waste-аар бодогдоно.
- [x] Missing norm final row `0` бөгөөд estimate approval блоклогдоно.
- [x] Effective price selection ажиллана.
- [x] Ambiguous/expired/missing price final row `0`.
- [x] Missing price `0.00 MNT` болж хувирахгүй.
- [x] Material/labor/equipment тусдаа breakdown-тэй.
- [x] VAT болон contingency exact decimal.
- [x] Approved estimate immutable version-тэй.
- [x] Work template → WBS mapping ажиллана.
- [x] Productivity → duration/crew/equipment ажиллана.
- [x] FS/SS/FF/SF calendar-aware CPM tests pass.
- [x] Holiday/weekend schedule calculation pass.
- [x] Dependency cycle approval-г блоклоно.
- [x] Schedule review/approval immutable version-тэй.
- [x] Baseline lineage ба budget consistency шалгагдана.
- [x] Baseline initial approval command ажиллана.
- [x] Baseline change шинэ version/supersession/reason үүсгэнэ.
- [x] Ижил baseline content хиймэл version үүсгэхгүй.
- [x] Formula/source coverage `100.00%`.
- [x] Adversarial evaluation `7/7 PASS`.
- [x] Targeted tests `29/29 PASS`.

**PHASE 7 EXIT GATE: PASS**
