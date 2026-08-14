# `final-req.md` ↔ Одоогийн төсөл — нийцлийн шинжилгээ

**Огноо:** 2026-08-07
**Харьцуулсан зүйл:** `final-req.md` (2,215 мөр, 74 бүлэг) ↔ бодит эх код
**Арга:** Шаардлагын бүлэг бүрийг Prisma схем (88 model), backend service, агентын
модуль, frontend хуудас, 644 тесттэй тулгаж шалгасан. Баримт бичгээс баримт
бичиг рүү хуулаагүй — код уншсан.

---

## 0. Нэг догол мөрөөр

Таны төсөл `final-req.md`-ийн **цөм гинжийг (design → quantity → cost → schedule
→ daily plan → actual → forecast) маш өндөр чанартай, шаардлагаас илүү
хатуу баталгаатай** хэрэгжүүлсэн. Гэхдээ шаардлагын **өргөн** — QA/QC, NCR,
RFI, Risk, Change Management, Procurement, орон зайн задаргаа — бараг бүрэн
хөндөгдөөгүй. Өөрөөр хэлбэл систем **гүн боловч нарийн**: нэг гинжийг
production түвшинд, бусад 6 модулийг огт хийгээгүй.

> **Гол дүгнэлт:** Энэ бол сул тал биш, **сонголт**. Хамгаалалт дээр үүнийг
> "хамрах хүрээгээ явцуулж, гүнзгийрүүлсэн" гэж байрлуулах нь зөв.
> Дэлгэрэнгүйг [§8](#8-давуу-тал--яагаад-энэ-нь-сул-биш-сонголт-вэ) үзнэ үү.

| Хэмжүүр | Оноо |
| --- | --- |
| **Acceptance Criteria (AC-01…AC-18)** | **14 бүрэн + 4 хэсэгчлэн + 0 байхгүй** |
| **MVP-1 (Data + Planning Core), 13 зүйл** | **10 бүрэн + 3 хэсэгчлэн** |
| **MVP-2 (Site Progress), 7 зүйл** | **6 бүрэн + 1 хэсэгчлэн** |
| **MVP-3 (Project Control), 10 зүйл** | **2 бүрэн + 2 хэсэгчлэн + 6 байхгүй** |
| **MVP-4 (Advanced Intelligence), 6 зүйл** | **0 бүрэн + 4 хэсэгчлэн + 2 байхгүй** |
| **Core entity (§63), 49 ширхэг** | **32 бүрэн + 4 хэсэгчлэн + 13 байхгүй** |
| **Шаардлагад огт байхгүй ч танайд байгаа** | **14 чадвар** |

---

## 1. Acceptance Criteria — 18 шалгуур

Энэ бол хамгийн чухал хэсэг. `final-req.md` §71 өөрөө "эдгээрийг хангаж байвал
core workflow ажиллаж байна" гэж хэлсэн.

| # | Шалгуур | Төлөв | Нотолгоо |
| --- | --- | :-: | --- |
| **AC-01** | Project үүсгээд зураг/BOQ импортолж чадна | ⚠️ | `POST /v1/projects` ✅, файл хуулах ✅, XLSX parser ✅ (`design-intake/workbook.ts`) — **гэхдээ BOQ импортын API endpoint байхгүй** |
| **AC-02** | Work Item + quantity source-тойгоо хадгалагдана | ✅ | `QuantityTakeoffItem.sourceRefs`, `ElementSourceRef` |
| **AC-03** | Approved quantity + norm → material requirement | ✅ | `calculateMaterialRequirements` tool, `WorkNorm.quantityPerOutput` |
| **AC-04** | Waste factor өөрчилбөл дахин зөв бодогдоно | ✅ | `WorkNorm.wastePercent` → `materialFactor()` |
| **AC-05** | Unit price → cost estimate | ✅ | `PriceCatalogEntry` → `EstimateLine.amount` |
| **AC-06** | Labor norm + crew capacity → duration | ✅ | `ProductivityRate.outputPerCrewHour` × `crewSize` |
| **AC-07** | Cycle-гүй үед CPM зөв ажиллана | ✅ | `src/analysis/graph.ts` — `Dependency cycle detected: A -> B -> C` |
| **AC-08** | Critical path тодорхойлогдоно | ✅ | `ScheduleActivity.isCritical`, `totalFloatMinutes` |
| **AC-09** | Resource conflict илэрвэл warning | ✅ | `ZONE_CONFLICT`, `CREW_UNAVAILABLE`, `EQUIPMENT_UNAVAILABLE` |
| **AC-10** | Daily plan baseline-тай холбоотой | ✅✅ | `DailyWorkPlan.baselineVersionId` — **NOT NULL, өгөгдлийн санд албадсан** |
| **AC-11** | Daily report plan-тай харьцуулагдана | ✅ | `ProgressEntry.planItemId` → `DailyVariance` |
| **AC-12** | Productivity actual man-hour дээр бодогдоно | ✅ | `AttendanceEntry.workerCount × hoursPerWorker` |
| **AC-13** | Remaining qty + productivity → finish forecast | ✅ | `ForecastWorkItem.rollingProductivity` → `projectedFinish` |
| **AC-14** | Material stock хүрэлцэхгүй бол shortage alert | ⚠️ | `DailyPlanMaterial.shortageQuantity` ✅, `MATERIAL_SHORTAGE` код ✅ — **гэхдээ "хэрэгцээтэй огноо → захиалах огноо" гинж байхгүй** |
| **AC-15** | Approved baseline overwrite болохгүй | ✅✅✅ | **Өгөгдлийн сангийн trigger** `BUILDWATCH_IMMUTABLE_VERSION`. Програм биш, SQL-ээр ч давж болохгүй |
| **AC-16** | Шинэ revision → хуучин superseded | ⚠️ | `supersedesId`, `SUPERSEDED` төлөв ✅ — **автомат шилжүүлэлт бичигдээгүй** |
| **AC-17** | AI-generated critical info → engineer approval | ✅✅ | Бүх агентын гаралт `DRAFT` → `ReviewTask`. Нэмээд **four-eyes** (өөрийгөө батлах хориг) |
| **AC-18** | Calculation result бүр source + formula trace | ✅ | `formulaCode`, `formulaInputs`, `sourceRefs`, `unitConversionVersion` |

**Дүн: 14 бүрэн, 4 хэсэгчлэн, 0 байхгүй.**

Гурван шалгуур (AC-10, AC-15, AC-17) дээр систем **шаардлагаас илүү хүчтэй** —
шаардлага "болохгүй" гэж хэлсэн газарт таны систем үүнийг өгөгдлийн сангийн
түвшинд албадсан.

---

## 2. MVP шатаар

### MVP-1 · Data + Planning Core — **бараг бүрэн**

| # | Зүйл | Төлөв | Тайлбар |
| --- | --- | :-: | --- |
| 1 | Project setup | ✅ | `POST /v1/projects` |
| 2 | PDF upload | ✅ | Malware scan, PDF бүтцийн шалгалт, SHA-256 |
| 3 | Work Item / BOQ import | ⚠️ | Parser бэлэн, **API endpoint байхгүй** |
| 4 | Material norm | ✅ | `NormCatalogVersion` → `WorkNorm`, хувилбарлагдсан |
| 5 | Price catalog | ✅ | `PriceCatalogVersion`, хүчинтэй огноотой |
| 6 | Crew | ✅ | `Crew` + `CrewAvailability` |
| 7 | Labor productivity | ✅ | `ProductivityRate` |
| 8 | Quantity calculation | ⚠️ | Логик бүрэн (`baseline-generation/quantity.ts`), CLI-ээр |
| 9 | Material requirement | ✅ | Tool болон детерминистик функц |
| 10 | Cost estimate | ⚠️ | Логик бүрэн, CLI-ээр |
| 11 | Dependency | ✅ | `WorkItemDependency`, `ScheduleDependency`, 4 төрөл |
| 12 | CPM | ✅ | `src/analysis/cpm.ts`, float, critical path |
| 13 | Basic schedule | ✅ | `ScheduleVersion` + `ScheduleActivity` |

### MVP-2 · Site Progress — **бараг бүрэн**

| # | Зүйл | Төлөв | Тайлбар |
| --- | --- | :-: | --- |
| 14 | Daily plan | ⚠️ | `src/planning/` бүрэн (eligibility 39 код), web дээр **харах + батлах** л боломжтой |
| 15 | Daily report | ✅ | Web форм + **offline outbox** |
| 16 | Photo upload | ✅ | + чанарын үнэлгээ + давхардал илрүүлэлт |
| 17 | Plan vs Actual | ✅ | `DailyVariance` |
| 18 | Productivity | ✅ | Rolling 3/7/14 хоног |
| 19 | Forecast finish | ✅ | `ForecastSnapshot.projectedFinish` |
| 20 | Delay alert | ✅ | Driver-үүдээр задалсан |

### MVP-3 · Project Control — **хамгийн сул хэсэг**

| # | Зүйл | Төлөв | Тайлбар |
| --- | --- | :-: | --- |
| 21 | Inventory | ⚠️ | `StockMovement` (append-only) ✅, **`Available Stock` формул, үлдэгдлийн харагдац байхгүй** |
| 22 | Procurement forecast | ❌ | Огт байхгүй |
| 23 | Cost control | ⚠️ | Төсөв vs бодит ✅. **Committed / EAC / Approved Change / Pending Change байхгүй** |
| 24 | Change management | ❌ | `ChangeOrder` entity байхгүй |
| 25 | Drawing revision | ✅ | `DrawingRevision`, revision code, approved by |
| 26 | RFI | ❌ | Огт байхгүй |
| 27 | QA/QC | ❌ | `Checklist` байхгүй |
| 28 | NCR | ❌ | Огт байхгүй |
| 29 | Risk | ❌ | `Risk Register` байхгүй |
| 30 | Recovery plan | ✅ | `RecoveryScenario` + өртөг/хугацааны нөлөө |

### MVP-4 · Advanced Intelligence — **эхлээгүй**

| # | Зүйл | Төлөв | Тайлбар |
| --- | --- | :-: | --- |
| 31 | IFC element extraction | ❌ | Шаардлагад бий, код байхгүй |
| 32 | Automated drawing comparison | ⚠️ | `/versions/compare` бий — **хувилбар** харьцуулна, **зураг** харьцуулахгүй |
| 33 | Photo progress estimation | ⚠️ | Чанар + давхардал ✅, **явц тооцоолохгүй** (энэ нь P-03-ын дагуу зориудын) |
| 34 | Historical productivity model | ⚠️ | Төслийн дотор rolling ✅, **төсөл хооронд суралцахгүй** |
| 35 | Resource optimization | ❌ | Байхгүй |
| 36 | Advanced cost/schedule prediction | ⚠️ | Детерминистик прогноз ✅, **ML байхгүй** |

---

## 3. Хэрэглэгчийн үүрэг (§3) харьцуулалт

| `final-req.md` | Танай систем | Төлөв |
| --- | --- | :-: |
| Project Administrator | `COMPANY_ADMIN` / `SUPER_ADMIN` | ✅ |
| Project Manager | `PROJECT_MANAGER` | ✅ |
| Site Engineer | `SITE_SUPERVISOR` | ⚠️ |
| Quantity / Cost Engineer | `ENGINEER` | ✅ |
| Planner | — | ❌ |
| QA/QC Engineer | — | ❌ |
| Viewer / Client | `OBSERVER` | ✅ |
| — | `STOREKEEPER` | ➕ нэмэлт |

**Гурван зөрүү:**

1. **Site Engineer ≠ SITE_SUPERVISOR.** Шаардлагад Site Engineer нь *quantity
   батлах* болон *inspection үүсгэх* эрхтэй. Танай `SITE_SUPERVISOR`-т
   `DESIGN_APPROVE` байхгүй, inspection модуль ч байхгүй. Танайх нь илүү
   явцуу — цэвэр өгөгдөл оруулагч.

2. **Planner тусдаа байхгүй.** WBS засах, dependency тохируулах, baseline
   батлах эрх бүгд `PROJECT_MANAGER`-т нэгдсэн. Жижиг байгууллагад зөв,
   том төсөлд үүргийн зааг бүдгэрнэ.

3. **QA/QC Engineer огт байхгүй.** Энэ бол зөвхөн үүргийн дутагдал биш —
   **бүтэн модуль байхгүйн шинж** (checklist, inspection, NCR).

`STOREKEEPER` нь шаардлагад байхгүй ч танайд байгаа — `INVENTORY_WRITE`-ийг
цорын ганц эзэмшигч. Барилгын бодит практикт нярав тусдаа хүн байдаг тул
**энэ нь шаардлагаас илүү бодитой**.

---

## 4. Core Database Entity (§63) — 49 entity

### ✅ Бүрэн байгаа (32)

| Шаардлага | Танайд |
| --- | --- |
| `User`, `Organization`, `Project`, `ProjectMember` | `User`, `Tenant`, `Project`, `ProjectMember` |
| `Document`, `Drawing`, `DrawingRevision`, `DrawingElement` | `DesignDocument`, `DrawingPage`, `DrawingRevision`, `DesignElement` (+`ElementGeometry`, +`ElementSourceRef`) |
| `WorkItem`, `WorkQuantity`, `WorkDependency` | `WorkItem`, `QuantityTakeoffItem`(+`Version`), `WorkItemDependency`/`ScheduleDependency` |
| `Material`, `MaterialNorm`, `MaterialPrice`, `MaterialTransaction` | `MaterialItem`(+`Catalog`,+`Version`,+`Alias`), `WorkNorm`, `PriceCatalogEntry`, `StockMovement` |
| `Crew`, `Equipment`, `ResourceAssignment` | `Crew`(+`Availability`), `Equipment`(+`Availability`), `DailyPlanResource`/`ResourceRequirement` |
| `LaborNorm`, `ProductivityRecord` | `ProductivityRate`, `AttendanceEntry`+`ForecastWorkItem` |
| `Schedule`, `ScheduleBaseline`, `Activity` | `ScheduleVersion`, `BaselineVersion`, `ScheduleActivity` |
| `DailyPlan`, `DailyReport`, `DailyProgress`, `Photo` | `DailyWorkPlan`(+4 дэд хүснэгт), `DailyReport`, `ProgressEntry`, `PhotoEvidence`(+3) |
| `CostEstimate`, `CostItem`, `ActualCost` | `EstimateVersion`, `EstimateLine`, `CostEntry` |
| `Approval`, `AuditLog` | `ReviewTask`+`ReviewDecision`+`ApprovalMatrix`, `AuditLog` |

### ⚠️ Хэсэгчлэн (4)

| Шаардлага | Танайд | Юу дутуу вэ |
| --- | --- | --- |
| `WBS` | `WorkItem` | Тусдаа шаталсан мод байхгүй, хавтгай жагсаалт |
| `Calendar` | `ScheduleVersion.calendarVersion` | Зөвхөн тэмдэглэгээ (`mn-6day-2026`), ажлын өдрийн хүснэгт байхгүй |
| `Issue` | `ProgressVerificationIssue` | Зөвхөн баталгаажуулалтын асуудал; ерөнхий blocker бүртгэл байхгүй |
| `Alert` | Хүснэгт биг, workspace-д тооцоологддог | Түүх хадгалагдахгүй, "хэн харсан/шийдсэн" мөшгөгдөхгүй |

### ❌ Огт байхгүй (13)

| Entity | Ямар модуль унана вэ |
| --- | --- |
| `Building`, `Floor`, `Zone`, `Room` | §8 Spatial Breakdown — байршил зөвхөн `locationCode` гэсэн чөлөөт текст |
| `MaterialStock` | §41 Inventory — `Available Stock` формул бодогдохгүй |
| `PurchaseOrder` | §40 Procurement Forecast |
| `Worker` | §15 — зөвхөн `Crew.memberCount`, хувь хүн бүртгэгдэхгүй |
| `Inspection`, `Checklist`, `NCR` | §28–30 QA/QC бүхэлдээ |
| `RFI` | §45 |
| `Risk` | §47 Risk Register |
| `ChangeOrder` | §44 Change Management |

**`Zone` байхгүй нь хамгийн их нөлөөтэй.** Танай `planning/eligibility.ts`-д
`ZONE_CONFLICT`, `ZONE_UNAVAILABLE`, `ZONE_DATA_MISSING` гэсэн код байгаа —
өөрөөр хэлбэл **логик нь бүсийн зөрчлийг шалгах бэлтгэлтэй**, гэхдээ бүсийг
тодорхойлох хүснэгт байхгүй тул бодит өгөгдөл дээр ажиллуулах боломжгүй.

---

## 5. Модуль бүрээр — 74 бүлгийн зураглал

### ✅ Шаардлагыг бүрэн, эсвэл илүү хангасан

| § | Модуль | Тайлбар |
| --- | --- | --- |
| 2.1 | AI ↔ deterministic салгах | **Шаардлагаас илүү.** 20 төрлийн тооцоо LLM-д хэзээ ч очихгүй, 644 тестээр хамгаалсан |
| 7 | Drawing Revision Control | Revision code, discipline, approved by, `supersedesId` |
| 10 | Quantity Takeoff | `formulaCode` + `formulaInputs` + `sourceRefs` |
| 11 | Material Norm DB | Хувилбарлагдсан, хүчинтэй огноотой, баталсан хүнтэй |
| 12 | Waste Factor | `WorkNorm.wastePercent`, дахин тооцоологддог |
| 13 | Material Master Data | + `MaterialAlias` (mn/en) — **шаардлагад байхгүй нэмэлт** |
| 14 | Labor Norm & Productivity | 3 шатлалт fallback (төсөл → компани → норм) |
| 15/16 | Crew & Equipment | + өдөр тутмын бэлэн байдал |
| 17 | Cost Database | Хувилбарлагдсан үнийн каталог |
| 19 | Activity Duration | Бүтээмж × багийн хэмжээ |
| 20 | Work Dependency | 4 төрөл (FS/SS/FF/SF) + lag |
| 22 | CPM Scheduling | Float, critical path, cycle detection |
| 23 | Baseline Management | **Өгөгдлийн сангийн trigger-ээр хамгаалсан** |
| 24 | Resource Allocation | Зөрчил илрүүлэлт |
| 25 | Daily Planning | `min()` 5 хязгаарлалтаар |
| 26 | Constraint Check | **12 категори** (`PREDECESSOR`, `MATERIAL_COVERAGE`, `CREW_AVAILABILITY`, `EQUIPMENT_AVAILABILITY`, `INSPECTION`, `ZONE_AVAILABILITY`, `OPEN_BLOCKER`, `WORK_STATUS`, `CALENDAR`, `WEATHER`, `SAFETY_RESTRICTION`, `ACTIVITY_DATE_WINDOW`) ~28 шалтгааны кодтой. Шаардлагын 8-аас илүү, гэхдээ **«Drawing approved» категори байхгүй** |
| 31 | Daily Report | Бүх талбар + weather |
| 32 | Natural Language Intake | LLM бүтэцчлэл (CLI-д) |
| 33 | Photo Evidence | 10 шалгалт + perceptual hash |
| 34 | Plan vs Actual | `DailyVariance` |
| 35/36 | Progress / Productivity | Жигнэсэн, rolling |
| 37 | Finish Forecast | CPM дахин тооцоолол |
| 38 | Delay Classification | 4 driver задаргаа |
| 39 | Recovery Plan | Өртөг + хугацааны нөлөө |
| 50 | Data Confidence & Approval | + four-eyes |
| 51 | Audit Trail | **Шаардлага "soft-delete зөвлөж байна" гэсэн; танайх hard append-only trigger** |
| 52 | Data Validation | 60+ алдааны код |
| 53 | Calculation Traceability | Formula + source + unit version |
| 61 | Security | Бүх зүйл + multi-tenant + zip-bomb хамгаалалт |

### ⚠️ Хэсэгчлэн

| § | Модуль | Юу дутуу вэ |
| --- | --- | --- |
| 6 | Зураг төслийн input | Architectural/Structural ✅. **MEP (Plumbing/HVAC/Electrical/ELV) discipline enum-д бий ч задлах логик байхгүй** |
| 8 | Spatial Breakdown | Building/Floor/Zone/Room **хүснэгт байхгүй** |
| 9 | WBS | Хавтгай, шаталсан бус |
| 18 | BOQ Management | Duplicate шалгалт ✅, **импортын API байхгүй** |
| 21 | Working Calendar | Зөвхөн хувилбарын нэр |
| 41 | Inventory | Хөдөлгөөн ✅, **үлдэгдэл тооцоо байхгүй** |
| 42 | Shortage Alert | Өдрийн түвшинд ✅, **ирээдүйн таамаг байхгүй** |
| 43 | Cost Control | 7 утгын 3 нь л бий |
| 48 | Dashboard | Project ✅, **Engineer dashboard тусдаа байхгүй** |
| 54 | Unit Management | **Хоёр нэгжийн систем:** тоо хэмжээ/төсөвт 8 канон нэгж (`m, m2, m3, kg, pcs, h, working_day, percent`); геометрт 10 нэгж (`mm, cm, m, mm2, cm2, m2, mm3, cm3, m3, pcs`) + `convertMeasurement()` хөрвүүлэгч, гэр бүл шалгадаг (урт→талбай хөрвүүлэхийг хориглоно). **`ton, liter, man-hour, machine-hour` байхгүй** |
| 56 | Reporting | PDF ✅, **Excel/CSV export байхгүй; 13 тайлангийн 3 нь л бий** |
| 60 | ML шаардлага | Fallback шатлал ✅, **ML огт байхгүй тул хэрэглэгдэхгүй** |
| 62 | NFR | Performance ✅ (p95 14–31ms), **deployed load test байхгүй** |

### ❌ Огт байхгүй

| § | Модуль |
| --- | --- |
| 27 | Method Statement / Work Instruction |
| 28 | QA/QC Checklist |
| 29 | Inspection |
| 30 | NCR |
| 40 | Procurement Forecast |
| 44 | Change Management |
| 45 | RFI Management |
| 46 | Issue / Blocker Management (ерөнхий) |
| 47 | Risk Register |
| 55 | Document Search (semantic + exact) |
| 57 | Lookahead Planning (7/14/21/30 хоног) |
| 58 | Activity Readiness Score |
| 59 | Project Learning (төсөл хооронд) |

---

## 6. Шаардлагад байхгүй ч танайд байгаа — 14 чадвар

Энэ бол хамгаалалт дээр **хамгийн үнэ цэнэтэй хэсэг**. `final-req.md`-д огт
дурдагдаагүй атлаа таны системд хэрэгжсэн зүйлс:

| # | Чадвар | Яагаад чухал вэ |
| --- | --- | --- |
| 1 | **Өгөгдлийн сангийн 18 trigger** (append-only + immutable version) | Шаардлага §51 зөвхөн "soft-delete зөвлөж байна" гэсэн. Танайх SQL-ээр ч давж болохгүй баталгаа өгсөн — **аудит хийгддэг салбарт энэ шийдвэрлэх ялгаа** |
| 2 | **Idempotency-Key бүх бичих үйлдэлд** | Талбайд сүлжээ тасарч дахин илгээхэд давхар бичлэг үүсэхгүй. Шаардлагад огт байхгүй |
| 3 | **Offline-first PWA** (IndexedDB outbox) | Барилгын талбайд интернэт байдаггүй. Шаардлага үүнийг огт хөндөөгүй — **бодит нөхцөлийн ойлголт** |
| 4 | **No-code бизнес дүрмийн засварлагч** (GoRules JDM) | Босго, severity-г програмист оролцуулахгүй өөрчилнө. Хувилбарлагдана, нийтлэгдэнэ |
| 5 | **OpenAPI-аас автоматаар үүсгэсэн typed client** | Backend өөрчлөгдвөл frontend шууд typecheck-т унана — contract drift боломжгүй |
| 6 | **Transactional Outbox** (`OutboxEvent` + `ConsumedEvent`) | Тархсан системд мессеж алдагдахгүй, давхардахгүй |
| 7 | **LLM evaluation harness** (`EvalCase`, golden case, judge) | §60 зөвхөн "model version audit" гэсэн. Танайд A1/A2/A3/A4 бүрд golden суурь |
| 8 | **Агентын зардлын хязгаар** (`AgentUsageBudget`) + Langfuse | LLM зардал хяналтгүй өсөхөөс хамгаална |
| 9 | **Perceptual hash + hamming distance** давхардал илрүүлэлт | §33 "previous photo comparison" гэсэн; танайх хэмжигдэхүйц алгоритм |
| 10 | **Four-eyes + emergency override audit** | §50.2-оос илүү. Өөрийгөө батлах хориг, override нь бүртгэгддэг |
| 11 | **Multi-tenant** бүрэн тусгаарлалт | §61 "шаардлагатай бол" гэсэн. Танайх default |
| 12 | **Zip-bomb / макро / гадаад холбоос шалгалт** | §61 зөвхөн "virus scanning". Танайх шахалтын харьцаа >500, VBA, embedded object шалгана |
| 13 | **403 биш 404 буцаах** | Төсөл байгаа эсэхийг ч мэдэгдэхгүй — мэдээлэл алдагдахаас хамгаална |
| 14 | **Бүрэн монгол хэлний UI + материалын alias** (mn/en) | Шаардлагад хэлний заалт огт байхгүй. Бодит хэрэглэгчид зориулсан |

Мөн **давхар эрхийн хяналт** (`DESIGN_APPROVE` + `COMMAND_APPLY` зэрэг шаардах)
нь шаардлагад байхгүй — `ENGINEER` батална, өөр хүн хэрэгжүүлнэ гэсэн
хяналт-тэнцвэр.

---

## 7. Сул тал — шударгаар

### 7.1 Хамгийн ноцтой: **QA/QC гинж бүхэлдээ байхгүй**

`final-req.md` §33.1-д "Accepted Actual" гэсэн томьёо бий:

```
Reported Quantity + Photo Evidence + Inspection + Engineer Confirmation
= Accepted Actual
```

Танай системд **дөрвөн бүрэлдэхүүний гурав нь бий, `Inspection` байхгүй**.
Тиймээс §33.1-ийн гол дүрэм бүрэн хэрэгжихгүй байна. Мөн `planning/eligibility.ts`-д
`INSPECTION` категори, `INSPECTION_MISSING`, `INSPECTION_NOT_PASSED` гэсэн
шалгалт аль хэдийн бий — логик нь хүлээж байгаа ч өгөгдөл ирэх суваг байхгүй.

Мөн `dailyPlanPreconditionTypeSchema`-д 7 төрөл (`PREDECESSOR`, `INSPECTION`,
`MATERIAL`, `WEATHER`, `BLOCKER`, `SAFETY`, `ACCESS`) тодорхойлогдсон —
`INSPECTION` болон `ACCESS` хоёрын ард бодит хүснэгт байхгүй.

### 7.2 Орон зайн задаргаа байхгүй

`Building/Floor/Zone/Room` байхгүй тул:
- Байршил зөвхөн `locationCode` гэсэн чөлөөт текст
- `ZONE_CONFLICT` шалгалт бодит өгөгдөл дээр ажиллуулах боломжгүй
- "12 давхрын аль давхарт хэдэн хувь дууссан" гэсэн асуултад хариулж чадахгүй
- Lookahead (§57) хийхэд байршил шаардлагатай

### 7.3 Тооцооллыг web-ээс өдөөх боломжгүй

Хамгийн их ажил хэрэгтэй зүйл. Одоо:

| Юу | Логик | Web-ээс товч |
| --- | :-: | :-: |
| Зураг задлах | ✅ | ❌ |
| Тоо хэмжээ гаргах | ✅ | ❌ |
| Төсөв гаргах | ✅ | ❌ |
| Хуваарь гаргах | ✅ | ❌ |
| Өдрийн даалгавар гаргах | ✅ | ❌ |
| Прогноз тооцох | ✅ | ❌ |

Өөрөөр хэлбэл web console нь **тооцоологдсоныг хянаж батлах** консол. Хэрэглэгч
"одоо ажиллуул" гэж дарж чадахгүй. Аудитын баримт (`AUDIT-AND-IMPROVEMENT-PLAN.md`
P1-1) үүнийг queue нэрийн зөрүү гэж тодорхойлсон.

### 7.4 Санхүүгийн хяналт өнгөцхөн

§43 долоон утга шаарддаг: Original Budget, Current Approved Budget, Committed
Cost, Actual Cost, Forecast Cost, Approved Change, Pending Change.

Танайд: `Project.budget`, `Project.actualCost`, `CostEntry` — **гурав**.
`EAC = Actual + Forecast Remaining` бодогдохгүй. Change management байхгүй тул
"Current Approved Budget" гэсэн ойлголт ч үүсэхгүй.

### 7.5 Агуулах хагас

`StockMovement` (хөдөлгөөн) бий, харин `Available Stock` формул байхгүй:

```
Available = Opening + Received + Returned - Issued - Damaged - Reserved
```

`Damaged`, `Reserved`, `Returned` төрлүүд `StockMovementType` enum-д байхгүй
(`RECEIPT, ISSUE, TRANSFER_IN, TRANSFER_OUT, ADJUSTMENT, REVERSAL`). Нярав
үлдэгдлээ харах дэлгэц ч байхгүй.

### 7.6 Нэгжийн менежмент хэсэгчлэн

Хөрвүүлэх service **байгаа** — `convertMeasurement()` (`baseline-generation/decimal.ts`)
нь `mm/cm/m`, `mm2/cm2/m2`, `mm3/cm3/m3`, `pcs` гэсэн 4 гэр бүлийг BigInt
нарийвчлалтай хөрвүүлж, гэр бүл хоорондын хөрвүүлэлтийг (урт → талбай) алдаа
өгч зогсооно.

Дутуу зүйл: §54-ийн жагсаалтаас **`ton` (kg×1000), `liter`, `man-hour`,
`machine-hour`** байхгүй. Мөн тоо хэмжээ/төсвийн канон нэгж (8) болон
геометрийн нэгж (10) хоёр тусдаа enum — нэг дор нэгтгэгдээгүй.

### 7.7 Хайлт байхгүй

§55 semantic + exact search шаарддаг. Танайд ямар ч хайлтын функц байхгүй —
16 файлтай демо дээр асуудалгүй, 500 файлтай бодит төсөлд ашиглах боломжгүй.

### 7.8 Export хязгаарлагдмал

PDF ✅. **Excel, CSV байхгүй.** §56-ийн 13 тайлангаас Daily/Progress/Cost
гэсэн 3 нь л бий. Барилгын салбарт Excel export бараг заавал шаардагддаг.

---

## 8. Давуу тал — яагаад энэ нь "сул биш, сонголт" вэ

### 8.1 Гүн ↔ өргөн сонголт

`final-req.md` бол **бүтэн ERP-ийн хэмжээний** тодорхойлолт: 74 модуль,
49 entity, MVP-4 хүртэл. Нэг хүн дипломын хугацаанд бүгдийг хийвэл модуль
бүр 2 хоногт ногдоно — өөрөөр хэлбэл бүгд өнгөцхөн болно.

Таны сонгосон зам эсрэг: **нэг гинжийг production түвшинд**. Үүний нотолгоо:

| Үзүүлэлт | Тоо |
| --- | --- |
| Тест | 644 (123 файл) |
| Мөшгөгдсөн шаардлага | 176 |
| ADR (архитектурын шийдвэрийн бүртгэл) | 7 |
| Өгөгдлийн сангийн invariant trigger | 18 |
| Детерминистик validation код | 60+ |
| Даалгаврын хязгаарлалтын категори | 12 (шаардлага 8 гэсэн) |
| p95 хариу хугацаа | 14–31 ms |

Энэ бол "дипломын прототип" биш үзүүлэлт.

### 8.2 Хамгийн хүнд хэсгийг сонгосон

74 модулиас хамгийн хэцүү нь QA/QC биш, **quantity → cost → CPM → daily plan
→ forecast** гинж. RFI, NCR, Risk Register нь үндсэндээ CRUD хүснэгт —
2 өдрийн ажил тус бүр. Харин CPM-ийг cycle detection, float, critical path-тай
зөв бичих, дараа нь rolling productivity дээр дахин тооцоолох нь долоо
хоногуудын ажил.

**Та амархныг нь орхиод хэцүүг нь хийсэн.** Энэ бол зөв дараалал.

### 8.3 Шаардлагаас илүү хатуу баталгаа

Гурван газарт систем шаардлагыг **давсан**:

| Шаардлага хэлсэн | Танайх хийсэн |
| --- | --- |
| §51: "soft-delete / versioning ашиглахыг **зөвлөж байна**" | Өгөгдлийн сангийн append-only trigger — зөвлөмж биш, албадлага |
| AC-15: "baseline overwrite **болохгүй**" | `BUILDWATCH_IMMUTABLE_VERSION` — програм алдаа гаргасан ч давахгүй |
| §50.2: "Engineer Approved болохоос өмнө ашиглагдахгүй" | + four-eyes + давхар эрх + emergency override audit |

### 8.4 Бодит нөхцөлийн ойлголт

Шаардлагад байхгүй атлаа танайд байгаа гурван зүйл нь **барилгын талбайг
ойлгосны шинж**:

1. **Offline горим** — талбайд 4G байхгүй
2. **`STOREKEEPER` тусдаа үүрэг** — нярав бол бодит хүн
3. **Материалын alias** ("цемент м400" → `MAT-CEM-425`) — талбайн хүн код
   бичихгүй, нэрээр бичнэ

### 8.5 Архитектурын гол шийдвэр зөв

`final-req.md` §74 дүгнэлтдээ:

```
AI proposes.  Calculation engine computes.  Engineer validates.  System tracks.
```

Таны системийн P-01/P-02 зарчим яг үүнтэй нэг. Бүр цаашилж, **LLM-д хэзээ ч
очихгүй 20 тооцооллын жагсаалтыг тодорхой бичсэн**. 7.9 тэрбумын төсвийг LLM
бодуулбал галлюцинац болно — та үүнийг архитектурын түвшинд шийдсэн.

---

## 9. Хамгаалалт дээр хэрхэн байрлуулах

**Битгий хий:** "Шаардлагыг 60% хэрэгжүүлсэн" гэж хэлэх. Энэ нь дутуу гэсэн
сонсогдоно.

**Ингэж хэл:**

> «`final-req.md` бол бүтэн ERP-ийн хэмжээний тодорхойлолт — 74 модуль.
> Би MVP-1 болон MVP-2, өөрөөр хэлбэл **системийн үнэ цэнийг үүсгэдэг гол
> loop-ийг** production түвшинд хийсэн: 644 тест, 18 өгөгдлийн сангийн
> invariant, 176 мөшгөгдсөн шаардлага.
>
> MVP-3-ийн QA/QC, RFI, Risk зэрэг нь үндсэндээ CRUD модуль — тэдгээрийг
> хийх нь техникийн эрсдэлгүй, зөвхөн цаг. Харин quantity → CPM → forecast
> гинжийг зөв хийх нь энэ системийн жинхэнэ хүндрэл байсан.
>
> Мөн шаардлагад байхгүй 14 чадвар нэмсэн — offline горим, өгөгдлийн сангийн
> append-only баталгаа, no-code дүрмийн засварлагч. Эдгээр нь бодит хэрэглээнээс
> гарсан.»

**Хэрэв "яагаад QA/QC хийгээгүй вэ?" гэж асуувал:**

> «Хамрах хүрээгээ ухамсартай хязгаарласан. QA/QC-г хийхэд `Inspection`
> хүснэгт нэмээд CRUD бичих нь 2-3 өдөр. Гэхдээ би түүнийг хийхийн оронд
> `Inspection`-ийг хүлээж авах **бэлтгэлийг** логикт хийсэн —
> `planning/eligibility.ts`-д `INSPECTION_MISSING`, `INSPECTION_NOT_PASSED`
> гэсэн шалгалт аль хэдийн бий. Модуль нэмэхэд гол логик өөрчлөгдөхгүй.»

**Хэрэв "яагаад web-ээс тооцоолол ажиллуулж болохгүй вэ?" гэж асуувал:**

> «Энэ бол мэдэгдэж байгаа цоорхой, аудитдаа P1-1 гэж бүртгэсэн. Тооцооллын
> логик болон queue хоёулаа бэлэн, зөвхөн queue-ийн нэрлэлт зөрсөн.
> 1-2 цагийн ажил, гэхдээ би үүнийг зассан гэж хуурамчаар мэдүүлэхгүй.»

---

## 10. Хийвэл өгөөж хамгийн өндөртэй 5 ажил

Хугацаа хязгаартай бол энэ дарааллаар:

| # | Ажил | Хугацаа | Яагаад |
| --- | --- | --- | --- |
| **1** | **Queue нэрийг нэгтгэж, web-ээс тооцоолол өдөөх** | ~2 цаг | Системийг "хоосон демо"-оос "ажиллаж байгаа бүтээгдэхүүн" болгоно. Хамгийн өндөр өгөөж |
| **2** | **`Building/Floor/Zone` хүснэгт нэмэх** | ~1 өдөр | `ZONE_CONFLICT` логик амьдарна, Lookahead боломжтой болно, "аль давхар хэдэн %" асуултад хариулна |
| **3** | **`Inspection` + `Checklist` минимал хувилбар** | ~2 өдөр | §33.1-ийн "Accepted Actual" томьёог бүтэн болгоно. Eligibility логик аль хэдийн хүлээж байгаа |
| **4** | **Excel/CSV export** | ~4 цаг | Барилгын салбарт бараг заавал. `exceljs` аль хэдийн dependency-д бий |
| **5** | **`Available Stock` тооцоо + няравын дэлгэц** | ~1 өдөр | `STOREKEEPER` үүрэг бүрэн утга агуулна, AC-14 бүрэн болно |

**1 болон 2-ыг хийвэл** шаардлагын нийцэл MVP-1/MVP-2 дээр бүрэн болж,
MVP-3-ын суурь тавигдана.

---

## 11. Товч хүснэгт — асуулт бүрт хариулж чадах уу

`final-req.md` §73-д "хэрэглэгч эдгээр асуултад хариулт авна" гэсэн 24 асуулт бий:

| Асуулт | Хариулж чадах уу |
| --- | :-: |
| Ямар материал хэдий хэмжээтэй хэрэгтэй вэ? | ✅ |
| Ямар материал **хэдийд** хэрэг болох вэ? | ❌ (procurement forecast байхгүй) |
| Одоо байгаа нөөц хүрэлцэх үү? | ⚠️ (өдрийн түвшинд) |
| Нийт төсөв хэд вэ? | ✅ |
| Нэг work package-ийн төсөв хэд вэ? | ✅ |
| Төсөв хэтрэх эрсдэл байгаа юу? | ⚠️ (variance бий, EAC байхгүй) |
| Ямар ажлыг ямар дарааллаар хийх вэ? | ✅ |
| Аль ажлууд critical path дээр байна? | ✅ |
| Төсөл хэдийд дуусах төлөвтэй вэ? | ✅ |
| Өнөөдөр ямар ажил хийх ёстой вэ? | ✅ |
| Аль crew ямар ажил хийх вэ? | ✅ |
| Хэдэн хүн, хэдэн цаг шаардагдах вэ? | ✅ |
| Өнөөдрийн төлөвлөгөө биелсэн үү? | ✅ |
| Ажилчдын бодит бүтээмж ямар байна? | ✅ |
| Төлөвлөсөн бүтээмжээс хэдэн хувь зөрөв? | ✅ |
| Энэ хурдаар явбал хугацаандаа амжих уу? | ✅ |
| Ямар ажил хоцролт үүсгэж байна? | ✅ |
| Хоцролтыг нөхөх ямар хувилбар байна? | ✅ |
| Нэмэлт crew авахад хэдэн өдөр хэмнэх вэ? | ✅ |
| Нэмэлт нөөцийн өртөг хэд вэ? | ✅ |
| Ямар материалын shortage ойртож байна? | ⚠️ |
| Ямар drawing revision одоогийн approved вэ? | ✅ |
| Ямар RFI, inspection, NCR шийдэгдээгүй байна? | ❌ |
| PM өнөөдөр ямар шийдвэр гаргах хэрэгтэй вэ? | ✅ (review queue) |

**18 бүрэн, 3 хэсэгчлэн, 2 байхгүй.**

Хоёр хариулж чадахгүй асуулт хоёулаа MVP-3-д хамаарна (procurement, QA/QC) —
өөрөөр хэлбэл **гол loop бүрэн ажиллаж байна**.

---

## 12. Холбоотой баримтууд

| Файл | Агуулга |
| --- | --- |
| [SYSTEM-EXPLAINED.md](SYSTEM-EXPLAINED.md) | Систем яаж ажилладаг — бүрэн тайлбар |
| [DEMO-PROJECT.md](DEMO-PROJECT.md) | Демо өгөгдөл, seed script |
| [DEMO-ACCOUNTS.md](DEMO-ACCOUNTS.md) | 7 үүрэг, эрхийн матриц |
| [AUDIT-AND-IMPROVEMENT-PLAN.md](AUDIT-AND-IMPROVEMENT-PLAN.md) | Аудитын дүн |
| [TODO-NEXT-STEPS.md](TODO-NEXT-STEPS.md) | Үлдсэн ажил |
| [buildwatch.md](buildwatch.md) | Хэрэгжүүлсэн шаардлага (v2.2) |
| [final-req.md](final-req.md) | Өргөн хүрээний шаардлага (энэ шинжилгээний эх) |
