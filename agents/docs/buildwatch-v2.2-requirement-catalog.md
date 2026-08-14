# BuildWatch v2.2 — Requirement ID ба priority catalog

- Хувилбар: 1.0
- Төлөв: Accepted
- Баталсан огноо: 2026-07-31
- Product requirement: `../../buildwatch.md`
- Implementation roadmap: `../BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md`
- Architecture freeze: `phase-0-buildwatch-v2.2-architecture-freeze.md`

## 1. Энэ catalog-ийг ашиглах дүрэм

- `../../buildwatch.md` нь бүтээгдэхүүний requirement-ийн үндсэн эх сурвалж хэвээр байна.
- Энэ файл requirement бүрийг implementation, test, evaluation болон demo evidence-тэй
  холбоход ашиглах тогтвортой ID, priority, owner, target phase-ийг тогтооно.
- ID-г дахин ашиглах, өөр утгатай болгох, устгахгүй. Requirement хүчингүй болбол
  `SUPERSEDED` төлөв өгч, шинэ ID үүсгэнэ.
- ADR нь requirement-ийг багасгахгүй. Зөвхөн ambiguity, ownership, version boundary,
  source priority болон MVP sequencing-ийг шийднэ.
- `MUST` requirement биелээгүй бол BuildWatch v2.2 production MVP release хийхгүй.

Priority:

| Priority | Утга                                                                  |
| -------- | --------------------------------------------------------------------- |
| `MUST`   | v2.2 production MVP-ийн release blocker                               |
| `SHOULD` | MVP-д өндөр ач холбогдолтой боловч үндсэн safety/correctness gate биш |
| `LATER`  | Баталгаатайгаар post-MVP advanced release-д шилжүүлсэн                |

Target phase нь `../BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md`-ийн `PHASE 0–11`
дугаарыг заана.

## 2. Product ба architecture requirement

| ID          | Requirement                                                                                                                                    | Priority | Owner              | Phase | Source          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------ | ----: | --------------- |
| BW-CORE-001 | Зураг төсөл/Excel → quantity/material/cost/WBS/CPM baseline → daily plan → approved actual → rolling forecast гэсэн end-to-end урсгалтай байна | MUST     | Product owner      |  1–11 | §1, §22         |
| BW-CORE-002 | AI нь candidate/draft/тайлбар гаргах ба албан ёсны тоо, төлөв, baseline-ийг зөвхөн deterministic service болон хүний approval өөрчилнө         | MUST     | AI lead            |  0–11 | §2              |
| BW-CORE-003 | A0–A5 агентын ownership давхцахгүй, agent хооронд version-тэй contract ашиглана                                                                | MUST     | Architecture owner |   0–8 | §3              |
| BW-CORE-004 | Quantity, norm, price, productivity, schedule, forecast болон approval бүр source/version/as-of/audit metadata-тэй байна                       | MUST     | Data owner         |  1–11 | §2, §10–12, §15 |
| BW-CORE-005 | Tenant болон project isolation prompt-д бус code/query/tool/API boundary-д хэрэгжинэ                                                           | MUST     | Security owner     |  8–11 | §2, §15         |
| BW-CORE-006 | Шаардлагатай source/data хүрэлцэхгүй үед тоо зохиохгүй, typed `INSUFFICIENT_INFORMATION` эсвэл `INSUFFICIENT_DATA` төлөв гаргана               | MUST     | Domain owner       |   1–8 | §2, §8, §15     |
| BW-CORE-007 | LLM/API unavailable үед deterministic planning, comparison, forecast, alert үргэлжилнэ                                                         | MUST     | Platform owner     |  3–11 | §15             |
| BW-CORE-008 | Shared contract, prompt, model, tool, rule, catalog, calendar болон policy version persisted байна                                             | MUST     | Platform owner     |  1–11 | §2, §10–12, §15 |

## 3. Эх requirement-д аль хэдийн ID-тай үндсэн зарчим

| ID   | Requirement                                                                  | Priority | Owner                    | Phase | Source |
| ---- | ---------------------------------------------------------------------------- | -------- | ------------------------ | ----: | ------ |
| P-01 | AI бэлдэж, эрх бүхий хүн батална                                             | MUST     | Product owner            |  0–11 | §2     |
| P-02 | Quantity, cost, schedule, forecast тоог LLM бодохгүй                         | MUST     | Deterministic core owner |   1–8 | §2     |
| P-03 | Фото нь нотолгооны нэг хэсэг бөгөөд дангаараа official actual биш            | MUST     | Verification owner       |     4 | §2     |
| P-04 | Verified scale-гүй зураг төслөөс metric quantity гаргахгүй                   | MUST     | A0 owner                 |   6–7 | §2     |
| P-05 | Үнэ, норм, бүтээмж source/version/effective date/approver-тэй байна          | MUST     | Catalog owner            |   6–9 | §2     |
| P-06 | Daily plan нь approved baseline-ийн operational view байна                   | MUST     | A5 owner                 |     3 | §2     |
| P-07 | Forecast/recovery нь baseline-ийг автоматаар өөрчлөхгүй                      | MUST     | Schedule owner           |     5 | §2     |
| P-08 | Мэдээлэл хүрэлцэхгүй үед таамаглахгүй                                        | MUST     | Domain owner             |   1–8 | §2     |
| P-09 | Upload, edit, approval, rejection, override, apply бүр audit trail-тэй байна | MUST     | Backend owner            |     9 | §2     |
| P-10 | Tenant/project/role isolation кодод хэрэгжинэ                                | MUST     | Security owner           |  8–11 | §2     |

## 4. A0 — Зураг төсөл, quantity, estimate, baseline

| ID     | Requirement                                                                                                        | Priority | Owner          |    Phase | Source        |
| ------ | ------------------------------------------------------------------------------------------------------------------ | -------- | -------------- | -------: | ------------- |
| A0-001 | Vector architectural PDF болон инженерийн XLSX workbook-ийг MVP input болгон хүлээн авна                           | MUST     | A0 owner       |        6 | §3.1, §4, §19 |
| A0-002 | PNG/JPEG/WEBP drawing-ийг classification/review-д ашиглаж болох ч verified metric geometry source гэж үзэхгүй      | SHOULD   | A0 owner       |        6 | §4.1, §15     |
| A0-003 | CSV catalog import болон DOCX/PDF technical description extraction дэмжинэ                                         | SHOULD   | A0 owner       |      6–7 | §4.1          |
| A0-004 | Upload бүр checksum, malware result, duplicate result, tenant/project, original filename, media metadata-тэй байна | MUST     | Platform owner |     6, 9 | §5, §11, §15  |
| A0-005 | Drawing discipline, page, revision, effective status болон supersession-ийг бүртгэнэ                               | MUST     | A0 owner       |      6–7 | §3.1, §5, §11 |
| A0-006 | Scale-ийг эх сурвалжтай candidate болгон гаргаж, инженер verify хийхээс өмнө metric quantity-г блоклоно            | MUST     | A0 owner       |        6 | §2, §3.1, §5  |
| A0-007 | Architecture plan-аас floor/zone/room/wall/door/window candidate болон source bounding reference гаргана           | MUST     | A0 owner       |        6 | §3.1, §19     |
| A0-008 | Candidate field бүр confidence, evidence/source, extraction method, model/rule version-тэй байна                   | MUST     | A0 owner       |     6, 8 | §3.1, §13.2   |
| A0-009 | Missing/ambiguous engineering information-ийг explicit issue болон clarification question болгоно                  | MUST     | A0 owner       |        6 | §3.1, §5      |
| A0-010 | Engineer-reviewed element-ээс version-тэй quantity takeoff draft, formula, unit, adjustment, source үүсгэнэ        | MUST     | Quantity owner |        7 | §3.1, §5, §11 |
| A0-011 | Approved norm-оор material requirement болон waste-ийг deterministic тооцно                                        | MUST     | Quantity owner |        7 | §5, §10, §15  |
| A0-012 | Effective approved price-оор cost/tax/contingency бүхий estimate draft үүсгэнэ; missing price-г 0₮ гэж үзэхгүй     | MUST     | Estimate owner |        7 | §5, §10, §15  |
| A0-013 | Approved productivity, dependency, calendar, resource input-аар WBS, schedule draft, CPM гаргана                   | MUST     | Schedule owner |        7 | §5, §10, §19  |
| A0-014 | Quantity, estimate, schedule, baseline тус бүр review/edit/reject/approve state machine-тэй байна                  | MUST     | Product owner  |      6–9 | §4.8, §5, §20 |
| A0-015 | Approved baseline immutable; өөрчлөлт нь шинэ version болон supersession relation үүсгэнэ                          | MUST     | Backend owner  |     7, 9 | §2, §20       |
| A0-016 | A0 байхгүй geometry, quantity, norm, material, price, productivity үүсгэхгүй                                       | MUST     | A0 owner       |      6–8 | §3.1, §15     |
| A0-017 | IFC, structural element, MEP, automated revision impact нь post-MVP advanced scope байна                           | LATER    | A0 owner       | Advanced | §4.1, §19     |

## 5. A5 — Өдрийн төлөвлөлт, verification, forecast

| ID     | Requirement                                                                                                                      | Priority | Owner              |    Phase | Source          |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------ | -------: | --------------- |
| A5-001 | A5 зөвхөн approved baseline/schedule болон version-тэй operational snapshot ашиглана                                             | MUST     | A5 owner           |     1, 3 | §3.6, §6.1      |
| A5-002 | Daily plan-ийг project timezone-аар 05:00-д scheduled job эсвэл manager request-ээр үүсгэнэ                                      | MUST     | A5 owner           |     3, 9 | §6.2            |
| A5-003 | Plan item нь date/work/zone/quantity/unit/time/crew/equipment/material/precondition/evidence/criticality/source activity агуулна | MUST     | A5 owner           |     1, 3 | §6.2            |
| A5-004 | Plan нь predecessor, inspection, material, crew, equipment, zone, weather, blocker, safety нөхцөлөөр feasible байна              | MUST     | A5 owner           |        3 | §6.1, §6.3      |
| A5-005 | A5 plan үргэлж draft; site engineer edit/review, project manager approve хийнэ                                                   | MUST     | Product owner      |  3, 9–10 | §4.8, §6.3      |
| A5-006 | Оройн actual нь A1-approved report-оос quantity, attendance, material, equipment, blocker, note, photo, checklist хэлбэрээр орно | MUST     | A1/A5 owners       |        4 | §7.1            |
| A5-007 | A5 plan, approved actual, photo rule, checklist, material movement-ийг нэгтгэн progress verification draft гаргана               | MUST     | A5 owner           |        4 | §3.6, §7        |
| A5-008 | Verification нь `COMPLETED`, `PARTIALLY_COMPLETED`, `NOT_COMPLETED`, `NOT_STARTED`, `BLOCKED`, `UNVERIFIABLE` төлөвийг ялгана    | MUST     | Verification owner |        4 | §3.6, §7.3      |
| A5-009 | Planned/actual/verified quantity, variance quantity/percent, completion rate-ийг deterministic тооцно                            | MUST     | Verification owner |        4 | §7.4            |
| A5-010 | Зөвхөн approved verification/actual rolling productivity болон forecast-д орно                                                   | MUST     | Forecast owner     |      4–5 | §8, §15         |
| A5-011 | 3/7/14 өдрийн rolling productivity, remaining duration, projected finish, delay status, confidence, driver гаргана               | MUST     | Forecast owner     |        5 | §8              |
| A5-012 | Late forecast үед source-backed recovery option гаргаж, хугацаа/зардал/resource impact-ийг deterministic simulation-аар бодно    | MUST     | A5/A2 owners       |        5 | §9              |
| A5-013 | Plan, verification, forecast, recovery бүр review queue, source catalog, audit metadata-тэй байна                                | MUST     | A5 owner           |      3–9 | §3.6, §4.8, §11 |
| A5-014 | Forecast болон recovery proposal approved baseline-ийг автоматаар өөрчлөхгүй                                                     | MUST     | Schedule owner     |        5 | §2, §15         |
| A5-015 | External live weather integration, video evidence, advanced resource optimization нь post-MVP scope байна                        | LATER    | A5 owner           | Advanced | §7.1, §19       |

## 6. Deterministic geometry, quantity, estimate

| ID          | Requirement                                                                                       | Priority | Owner          | Phase | Source       |
| ----------- | ------------------------------------------------------------------------------------------------- | -------- | -------------- | ----: | ------------ |
| DET-GEO-001 | Metric geometry хийхийн өмнө drawing revision болон verified scale шаардана                       | MUST     | Geometry owner |     6 | §5, §10, §15 |
| DET-GEO-002 | Length/area/volume geometry нь explicit formula, input source, unit, precision metadata-тэй байна | MUST     | Geometry owner |   6–7 | §10, §13.2   |
| DET-GEO-003 | Quantity takeoff нь reviewed element geometry болон approved adjustment-аас reproducible байна    | MUST     | Quantity owner |     7 | §5, §10      |
| DET-GEO-004 | Material requirement болон waste нь approved versioned norm-оор бодогдоно                         | MUST     | Quantity owner |     7 | §5, §10      |
| DET-GEO-005 | Cost, tax, contingency нь decimal arithmetic болон approved effective price-оор бодогдоно         | MUST     | Estimate owner |     7 | §10, §15     |
| DET-GEO-006 | Labor/equipment hours болон schedule duration approved productivity-аас гарна                     | MUST     | Schedule owner |     7 | §10          |
| DET-GEO-007 | Formula бүр positive/negative/boundary/unit-conversion/rounding test-тэй байна                    | MUST     | QA owner       |   6–7 | §16–17, §20  |

## 7. Deterministic daily planning

| ID           | Requirement                                                                                                                   | Priority | Owner          | Phase | Source    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ----: | --------- |
| DET-PLAN-001 | Eligible work нь predecessor complete эсэхийг шалгана                                                                         | MUST     | Planning owner |     3 | §6.3      |
| DET-PLAN-002 | Eligible work нь inspection, blocker, safety болон weather restriction шалгана                                                | MUST     | Planning owner |     3 | §6.3      |
| DET-PLAN-003 | Eligible work нь material, crew, equipment, zone capacity/availability шалгана                                                | MUST     | Planning owner |     3 | §6.3      |
| DET-PLAN-004 | Priority нь critical path → float → booking → downstream unlock → milestone → non-critical гэсэн тогтвортой дараалалтай байна | MUST     | Planning owner |     3 | §6.3      |
| DET-PLAN-005 | Ижил priority үед deterministic tie-break хэрэглэнэ                                                                           | MUST     | Planning owner |     3 | §6.3      |
| DET-PLAN-006 | Daily target нь remaining, crew productivity, material, equipment, zone capacity-ийн minimum байна                            | MUST     | Planning owner |     3 | §6.3      |
| DET-PLAN-007 | Crew/equipment/zone давхар booking илэрвэл plan invalid байна                                                                 | MUST     | Planning owner |     3 | §6.3, §17 |
| DET-PLAN-008 | Daily plan calculation LLM-гүй ажиллаж, ижил input/version-д ижил output өгнө                                                 | MUST     | Planning owner |     3 | §10, §15  |

## 8. Deterministic photo ба progress verification

| ID             | Requirement                                                                                                 | Priority | Owner              | Phase | Source     |
| -------------- | ----------------------------------------------------------------------------------------------------------- | -------- | ------------------ | ----: | ---------- |
| DET-VERIFY-001 | Required evidence count/angle/timestamp/location/reference/before-after rule-ийг version-тэйгээр шалгана    | MUST     | Verification owner |     4 | §4.5, §7.2 |
| DET-VERIFY-002 | Exact checksum duplicate болон previous-day reuse-ийг deterministic шалгана                                 | MUST     | Verification owner |     4 | §7.2       |
| DET-VERIFY-003 | Near-duplicate, blur, darkness, metadata anomaly нь review signal байна                                     | MUST     | Verification owner |     4 | §7.2       |
| DET-VERIFY-004 | Photo project/work item/report date холбоос болон privacy signal-ийг шалгана                                | MUST     | Verification owner |     4 | §7.2       |
| DET-VERIFY-005 | Photo-оос exact quantity зохиохгүй; зөвхөн evidence/advisory signal гаргана                                 | MUST     | Verification owner |     4 | §7.2, §15  |
| DET-VERIFY-006 | Completion status нь quantity, evidence, checklist, blocker, engineer rejection-ийн explicit rule-ээр гарна | MUST     | Verification owner |     4 | §7.3       |
| DET-VERIFY-007 | Completion rate болон variance нь canonical decimal/rounding policy хэрэглэнэ                               | MUST     | Verification owner |     4 | §7.4       |
| DET-VERIFY-008 | Quantity unit байхгүй ажил approved checklist эсвэл weighted milestone-аар хэмжигдэнэ                       | MUST     | Verification owner |     4 | §7.4       |
| DET-VERIFY-009 | Actual/material/attendance/photo зөрүү нь автоматаар approval биш review queue үүсгэнэ                      | MUST     | Verification owner |     4 | §15        |
| DET-VERIFY-010 | Approved, idempotent command л canonical actual болон forecast input-д apply хийнэ                          | MUST     | Backend owner      |  4, 9 | §4.8, §15  |

## 9. Deterministic forecast ба recovery

| ID               | Requirement                                                                                                           | Priority | Owner          | Phase | Source         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ----: | -------------- |
| DET-FORECAST-001 | Approved valid actual-аар 3/7/14 working-day rolling productivity тооцно                                              | MUST     | Forecast owner |     5 | §8.1           |
| DET-FORECAST-002 | Гурав хүрэхгүй valid observation үед approved productivity norm ашиглаж cold-start flag гаргана                       | MUST     | Forecast owner |     5 | §8.1           |
| DET-FORECAST-003 | Rejected/unverifiable actual-ийг хасаж, outlier-ийг автоматаар устгалгүй review flag болгоно                          | MUST     | Forecast owner |     5 | §8.1, ADR-0013 |
| DET-FORECAST-004 | Adjusted productivity нь crew/shift/recent pace/weather/learning/equipment/material/blocker/calendar factor-тэй байна | MUST     | Forecast owner |     5 | §8.2           |
| DET-FORECAST-005 | Remaining duration нь `ceil(remainingQty / adjustedDailyProductivity)` working day байна                              | MUST     | Forecast owner |     5 | §8.2           |
| DET-FORECAST-006 | Dependency graph болон project calendar дээр CPM дахин бодож projected finish гаргана                                 | MUST     | Forecast owner |     5 | §8.3           |
| DET-FORECAST-007 | `ON_TRACK`, `AT_RISK`, `LIKELY_LATE`, `CRITICAL_LATE`, `INSUFFICIENT_DATA` төлөвийг versioned threshold-оор ангилна   | MUST     | Forecast owner |     5 | §8.4           |
| DET-FORECAST-008 | Confidence нь coverage/history/blocker/catalog/dependency/resource data quality-аас deterministic бодогдоно           | MUST     | Forecast owner |     5 | §8.5           |
| DET-FORECAST-009 | Delay driver бүр source reference болон as-of огноотой байна                                                          | MUST     | Forecast owner |     5 | §8.4–8.5       |
| DET-FORECAST-010 | Recovery option бүр schedule impact, additional cost, resource, conflict, risk, source агуулна                        | MUST     | Recovery owner |     5 | §9             |
| DET-FORECAST-011 | Recovery impact-ийг existing deterministic scenario engine бодно                                                      | MUST     | Recovery owner |     5 | §9–10          |
| DET-FORECAST-012 | Forecast/recovery output baseline-г write хийхгүй; approved baseline change тусдаа version үүсгэнэ                    | MUST     | Schedule owner |  5, 9 | §2, §15        |

## 10. Design ба baseline UI

| ID            | Requirement                                                                                                      | Priority | Owner          | Phase | Source        |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ----: | ------------- |
| UI-DESIGN-001 | Project metadata, file upload, Excel import, revision register, scale verification, missing-info workspace байна | MUST     | Frontend owner |    10 | §13.1         |
| UI-DESIGN-002 | Excel sheet/column validation болон mapping error-ийг хэрэглэгч засах боломжтой харуулна                         | MUST     | Frontend owner |    10 | §4.2, §13.1   |
| UI-DESIGN-003 | PDF viewer болон element/quantity/formula/source/confidence/review status зэрэгцээ харагдана                     | MUST     | Frontend owner |    10 | §13.2         |
| UI-DESIGN-004 | Low-confidence болон source/scale missing мөрийг ялгаж, approve хийхээс өмнө блоклоно                            | MUST     | Frontend owner |    10 | §13.2, §15    |
| UI-DESIGN-005 | Quantity/estimate/schedule/baseline draft-д edit/reject/approve/diff/version UI байна                            | MUST     | Frontend owner |    10 | §4.8, §5, §20 |
| UI-DESIGN-006 | Gantt дээр baseline/forecast, critical path, source schedule version харагдана                                   | MUST     | Frontend owner |    10 | §5, §13       |

## 11. Daily plan, verification, forecast UI

| ID          | Requirement                                                                                                                          | Priority | Owner          | Phase | Source             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------- | ----: | ------------------ |
| UI-PLAN-001 | Daily board нь Planned/In progress/Completed/Partial/Blocked/Unverified баганатай байна                                              | MUST     | Frontend owner |    10 | §13.3              |
| UI-PLAN-002 | Plan card нь work/zone/target/crew/material/equipment/evidence/criticality/forecast impact харуулна                                  | MUST     | Frontend owner |    10 | §13.3              |
| UI-PLAN-003 | Site engineer plan item засаж, manager approve/reject хийж, diff/audit харагдана                                                     | MUST     | Frontend owner |    10 | §6.3, §13.3        |
| UI-PLAN-004 | Mobile evening submission нь work item, quantity, labor, blocker, 1–5 photo-г 2 минутын дотор оруулах урсгалтай байна                | MUST     | Frontend owner |    10 | §13.4              |
| UI-PLAN-005 | Offline submission queue нь no-data-loss, retry/idempotency төлөвтэй байна                                                           | MUST     | Frontend owner | 10–11 | Production roadmap |
| UI-PLAN-006 | Verification screen нь өмнөх/өнөөдрийн фото/source болон planned/declared/verified/variance/evidence/AI note/review action харуулна  | MUST     | Frontend owner |    10 | §13.5              |
| UI-PLAN-007 | Forecast dashboard baseline/projected finish, delay, status, confidence, drivers, recovery харуулна                                  | MUST     | Frontend owner |    10 | §13.6              |
| UI-PLAN-008 | Notification inbox нь approval, shortage, missing report, evidence, missed target, forecast, critical risk, duplicate event харуулна | MUST     | Frontend owner |    10 | §14                |
| UI-PLAN-009 | Role-based responsive/loading/empty/error/permission state-тай байна                                                                 | MUST     | Frontend owner |    10 | Production roadmap |

## 12. Design ба baseline backend

| ID            | Requirement                                                                                                      | Priority | Owner         | Phase | Source        |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | -------- | ------------- | ----: | ------------- |
| BE-DESIGN-001 | File intake нь tenant/project scope, checksum, duplicate, malware, immutable artifact metadata-тэй байна         | MUST     | Backend owner |  6, 9 | §4–5, §11     |
| BE-DESIGN-002 | `01_Project`–`18_Approval_Matrix` workbook schema, row-level validation, import manifest, error report-тэй байна | MUST     | Backend owner |  6, 9 | §4.2–4.8      |
| BE-DESIGN-003 | DesignDocument/Revision/Page/Scale/Element/Geometry/Property/SourceRef equivalent canonical models байна         | MUST     | Data owner    |     9 | §11           |
| BE-DESIGN-004 | QuantityTakeoffVersion/Item/Adjustment equivalent versioned models байна                                         | MUST     | Data owner    |     9 | §11           |
| BE-DESIGN-005 | Material/Norm/Productivity catalog болон version/effective-date/approval models байна                            | MUST     | Data owner    |     9 | §11           |
| BE-DESIGN-006 | Price/quotation, EstimateVersion/Line/Assumption/Scenario equivalent models байна                                | MUST     | Data owner    |     9 | §11           |
| BE-DESIGN-007 | ScheduleVersion/Activity/Dependency/Resource/Crew/Equipment/Availability equivalent models байна                 | MUST     | Data owner    |     9 | §11           |
| BE-DESIGN-008 | A0-ийн 11 read-only tool tenant/project/version/as-of/source limit-тай байна                                     | MUST     | Tool owner    |   8–9 | §12           |
| BE-DESIGN-009 | Geometry/quantity/material/cost/schedule deterministic service strict input/output contract-тэй байна            | MUST     | Domain owner  |   6–9 | §10, §12      |
| BE-DESIGN-010 | Approved quantity/estimate/baseline command transaction + outbox + idempotency boundary-гаар apply хийнэ         | MUST     | Backend owner |     9 | §2, §4.8, §11 |
| BE-DESIGN-011 | Approved versions immutable, supersession болон full audit trail-тэй байна                                       | MUST     | Backend owner |     9 | §2, §20       |

## 13. Daily planning ба forecast backend

| ID          | Requirement                                                                                                                 | Priority | Owner          | Phase | Source        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- | -------- | -------------- | ----: | ------------- |
| BE-PLAN-001 | DailyWorkPlan/Item/Resource/Material/Precondition equivalent models байна                                                   | MUST     | Data owner     |     9 | §11           |
| BE-PLAN-002 | Daily actual labor/material/equipment/blocker/checklist нь approved DailyReport lineage-тэй байна                           | MUST     | Data owner     |  4, 9 | §7, §11       |
| BE-PLAN-003 | PhotoEvidence/Link/QualityCheck/DuplicateCheck equivalent models байна                                                      | MUST     | Data owner     |  4, 9 | §7, §11       |
| BE-PLAN-004 | ProgressVerification/Issue/DailyVariance equivalent models байна                                                            | MUST     | Data owner     |  4, 9 | §7, §11       |
| BE-PLAN-005 | ForecastSnapshot/WorkItem/Driver/RecoveryScenario equivalent immutable models байна                                         | MUST     | Data owner     |  5, 9 | §8–9, §11     |
| BE-PLAN-006 | ReviewTask/Decision/Correction/ApprovalMatrix equivalent generic approval models байна                                      | MUST     | Data owner     |     9 | §4.8, §11     |
| BE-PLAN-007 | A5-ийн 15 read-only tool tenant/project/version/as-of/source limit-тай байна                                                | MUST     | Tool owner     |   8–9 | §12           |
| BE-PLAN-008 | Daily target/plan validation/progress verification/productivity/forecast/recovery deterministic services contract-тэй байна | MUST     | Domain owner   |   3–9 | §10, §12      |
| BE-PLAN-009 | 05:00 project-timezone job, manual trigger, event trigger, catch-up, retry, dead-letter, replay ажиллана                    | MUST     | Platform owner |  3, 9 | §6, roadmap   |
| BE-PLAN-010 | Approved plan/actual/verification apply нь transaction, outbox, idempotency key ашиглана                                    | MUST     | Backend owner  |     9 | §2, §4.8, §15 |
| BE-PLAN-011 | Auth/RBAC/project assignment API boundary бүрд enforced байна                                                               | MUST     | Security owner |  9–11 | §2, §15       |
| BE-PLAN-012 | Approval/shortage/report/evidence/target/forecast/risk/duplicate domain event notification үүсгэнэ                          | MUST     | Backend owner  |  9–10 | §14           |
| BE-PLAN-013 | API болон worker structured error, correlation ID, audit actor, source version metadata буцаана                             | MUST     | Platform owner |  9–11 | §2, §15       |

## 14. Photo evidence control

Эдгээр ID нь `../../buildwatch.md`-д аль хэдийн тогтоогдсон тул өөрчлөхгүй.

| ID    | Requirement                                 | Priority | Owner              | Phase | Source |
| ----- | ------------------------------------------- | -------- | ------------------ | ----: | ------ |
| PE-01 | Файл decode/open validation                 | MUST     | Verification owner |     4 | §7.2   |
| PE-02 | Blur/darkness quality signal                | MUST     | Verification owner |     4 | §7.2   |
| PE-03 | Exact/near duplicate signal                 | MUST     | Verification owner |     4 | §7.2   |
| PE-04 | Previous-day reuse signal                   | MUST     | Verification owner |     4 | §7.2   |
| PE-05 | Capture/report date consistency             | MUST     | Verification owner |     4 | §7.2   |
| PE-06 | Project/work-item linkage                   | MUST     | Verification owner |     4 | §7.2   |
| PE-07 | Required angle completeness                 | MUST     | Verification owner |     4 | §7.2   |
| PE-08 | Measurement/reference marker signal         | MUST     | Verification owner |     4 | §7.2   |
| PE-09 | Text declaration/photo contradiction signal | MUST     | Verification owner |     4 | §7.2   |
| PE-10 | Face/plate/document privacy signal          | MUST     | Security owner     | 4, 11 | §7.2   |

## 15. Safety ба reliability control

Эдгээр ID нь `../../buildwatch.md`-д аль хэдийн тогтоогдсон тул өөрчлөхгүй.

| ID   | Requirement                                                    | Priority | Owner              | Phase | Source |
| ---- | -------------------------------------------------------------- | -------- | ------------------ | ----: | ------ |
| G-01 | Unverified scale-ээс metric quantity гаргахгүй                 | MUST     | A0 owner           |     6 | §15    |
| G-02 | Source reference-гүй quantity татгалзана                       | MUST     | Quantity owner     |     7 | §15    |
| G-03 | Approved norm-гүй material estimate final болохгүй             | MUST     | Estimate owner     |     7 | §15    |
| G-04 | Missing price-г 0₮ гэж үзэхгүй                                 | MUST     | Estimate owner     |     7 | §15    |
| G-05 | Фотоноос exact quantity зохиохгүй                              | MUST     | Verification owner |     4 | §15    |
| G-06 | Approved report/verification л forecast-д орно                 | MUST     | Forecast owner     |   4–5 | §15    |
| G-07 | Duplicate зурагтай report auto-approve болохгүй                | MUST     | Verification owner |     4 | §15    |
| G-08 | Cross-domain evidence mismatch review queue-д орно             | MUST     | Verification owner |     4 | §15    |
| G-09 | Unapproved forecast baseline-ийг өөрчлөхгүй                    | MUST     | Schedule owner     |     5 | §15    |
| G-10 | LLM-off үед deterministic core үргэлжилнэ                      | MUST     | Platform owner     |  3–11 | §15    |
| G-11 | AI budget хэтэрвэл AI draft зогсож core calculation үргэлжилнэ | MUST     | Platform owner     |  8–11 | §15    |
| G-12 | Tenant/project isolation integration test-тэй байна            | MUST     | Security owner     |  8–11 | §15    |

## 16. Evaluation, simulation ба release target

| ID         | Requirement                                                                                                        | Priority | Owner    | Phase | Source |
| ---------- | ------------------------------------------------------------------------------------------------------------------ | -------- | -------- | ----: | ------ |
| QA-V22-001 | 40–60 work item, dependency, critical path, 12-week plan/actual бүхий deterministic simulation байна               | MUST     | QA owner |     2 | §18    |
| QA-V22-002 | Material, crew, equipment, weather, missing report, duplicate, mismatch, delay, cost scenario answer key-тэй байна | MUST     | QA owner |     2 | §18    |
| QA-V22-003 | A0 element/dimension/quantity/material/cost/schedule/source metric-тэй golden dataset байна                        | MUST     | QA owner |   6–8 | §16.1  |
| QA-V22-004 | A5 eligible/conflict/target/criticality/material feasibility metric-тэй golden dataset байна                       | MUST     | QA owner |  3, 8 | §16.2  |
| QA-V22-005 | Photo duplicate/evidence/status/false-completed/unverifiable metric-тэй golden dataset байна                       | MUST     | QA owner |  4, 8 | §16.3  |
| QA-V22-006 | Forecast MAE/risk/early-warning/recovery/false-alert metric-тэй temporal dataset байна                             | MUST     | QA owner |  5, 8 | §16.4  |
| QA-V22-007 | Source-гүй quantity = 0                                                                                            | MUST     | QA owner |  6–11 | §17    |
| QA-V22-008 | Unverified-scale metric quantity = 0                                                                               | MUST     | QA owner |  6–11 | §17    |
| QA-V22-009 | Fabricated material/norm/price = 0                                                                                 | MUST     | QA owner |  7–11 | §17    |
| QA-V22-010 | Approved quantity cost formula = 100% correct                                                                      | MUST     | QA owner |  7–11 | §17    |
| QA-V22-011 | CPM deterministic unit tests = 100% pass                                                                           | MUST     | QA owner |  5–11 | §17    |
| QA-V22-012 | Resource double-booking undetected = 0                                                                             | MUST     | QA owner |  3–11 | §17    |
| QA-V22-013 | Photo duplicate precision ≥ 90%                                                                                    | MUST     | QA owner |  4–11 | §17    |
| QA-V22-014 | Daily completion classification accuracy ≥ 90%                                                                     | MUST     | QA owner |  4–11 | §17    |
| QA-V22-015 | False `COMPLETED` < 3%                                                                                             | MUST     | QA owner |  4–11 | §17    |
| QA-V22-016 | Project finish forecast MAE ≤ 7 working days                                                                       | MUST     | QA owner |  5–11 | §17    |
| QA-V22-017 | Critical delay recall ≥ 90%                                                                                        | MUST     | QA owner |  5–11 | §17    |
| QA-V22-018 | Mean early warning ≥ 5 days                                                                                        | MUST     | QA owner |  5–11 | §17    |
| QA-V22-019 | Tenant/project isolation violation = 0                                                                             | MUST     | QA owner |  8–11 | §17    |
| QA-V22-020 | Unsupported numeric claim = 0                                                                                      | MUST     | QA owner |  6–11 | §17    |

## 17. Advanced scope

| ID     | Requirement                                   | Priority | Owner          |    Phase | Source    |
| ------ | --------------------------------------------- | -------- | -------------- | -------: | --------- |
| A0-101 | IFC/BIM geometry/property import              | LATER    | A0 owner       | Advanced | §4.1, §19 |
| A0-102 | Structural element extraction                 | LATER    | A0 owner       | Advanced | §19       |
| A0-103 | MEP extraction болон cross-discipline clash   | LATER    | A0 owner       | Advanced | §19       |
| A0-104 | Automated drawing revision impact analysis    | LATER    | A0 owner       | Advanced | §19       |
| A5-101 | Advanced multi-resource leveling/optimization | LATER    | A5 owner       | Advanced | §19       |
| A5-102 | External weather provider integration         | LATER    | A5 owner       | Advanced | §19       |
| A5-103 | Supplier quotation workflow integration       | LATER    | Estimate owner | Advanced | §19       |
| A5-104 | Schedule scenario optimization                | LATER    | Schedule owner | Advanced | §19       |

## 18. Source section coverage

| Source section            | Catalog coverage                                                      |
| ------------------------- | --------------------------------------------------------------------- |
| §1 Зорилго                | BW-CORE                                                               |
| §2 Үндсэн зарчим          | P, BW-CORE                                                            |
| §3 Агентууд               | A0, A5, BW-CORE; existing A1–A4 нь `../REQUIREMENT-TRACEABILITY.md`-д |
| §4 Оролт/workbook         | A0, BE-DESIGN, BE-PLAN                                                |
| §5 Baseline урсгал        | A0, DET-GEO, BE-DESIGN                                                |
| §6 Daily planning         | A5, DET-PLAN                                                          |
| §7 Evening verification   | A5, DET-VERIFY, PE                                                    |
| §8 Forecast               | A5, DET-FORECAST                                                      |
| §9 Recovery               | A5, DET-FORECAST                                                      |
| §10 Deterministic engine  | DET-GEO, DET-PLAN, DET-VERIFY, DET-FORECAST                           |
| §11 Data model            | BE-DESIGN, BE-PLAN                                                    |
| §12 Tool layer            | BE-DESIGN, BE-PLAN                                                    |
| §13 UI                    | UI-DESIGN, UI-PLAN                                                    |
| §14 Notification          | UI-PLAN, BE-PLAN                                                      |
| §15 Guard                 | G                                                                     |
| §16 Evaluation            | QA-V22                                                                |
| §17 Acceptance            | QA-V22                                                                |
| §18 Simulation            | QA-V22                                                                |
| §19 Implementation phases | Priority болон target phase                                           |
| §20 Definition of Done    | MUST requirement болон release gate                                   |
| §21 Нэмсэн requirement    | A5, DET-PLAN, DET-VERIFY, DET-FORECAST, BE-PLAN                       |
| §22 Product definition    | BW-CORE                                                               |

## 19. Change control

- Priority өөрчлөх бол Product owner + Architecture owner шийдвэр, ADR эсвэл dated
  decision record шаардана.
- `MUST → SHOULD/LATER` бууруулалт нь requirement source-ийн шинэ version шаардана.
- Target phase өөрчлөгдөж болно, ID болон requirement meaning өөрчлөгдөхгүй.
- Implementation status, code/test/demo evidence-ийг
  `../REQUIREMENT-TRACEABILITY.md`-д шинэчилнэ.
