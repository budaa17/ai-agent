# BuildWatch — Зураг төслөөс baseline үүсгэх, өдөр тутмын ажил төлөвлөх ба гүйцэтгэл баталгаажуулах нэгдсэн шаардлага

**Хувилбар:** v2.2  
**Огноо:** 2026-07-31  
**Статус:** Professional draft  
**Бүтээгдэхүүн:** Барилгын төслийн зураг төсөл, тоо хэмжээ, төсөв, хугацаа, өдөр тутмын ажил, фото нотолгоо, эрсдэлийн forecast-ийг нэгтгэсэн AI-assisted multi-tenant SaaS  
**Зорилтот хэрэглээ:** Төгсөлтийн ажил + production сахилгатай MVP  
**Requirement ID ба priority catalog:** `agents/docs/buildwatch-v2.2-requirement-catalog.md`  
**Architecture freeze:** `agents/docs/phase-0-buildwatch-v2.2-architecture-freeze.md`  
**Implementation roadmap:** `agents/BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md`

Энэ файл бүтээгдэхүүний requirement-ийн үндсэн эх сурвалж байна. Implementation,
test, evaluation болон demo evidence нь дээрх тогтвортой requirement ID-г ашиглана.
Ambiguity-г `agents/docs/adr/0009`–`0015` шийдвэрүүдээр тайлбарлах боловч requirement-ийг
бууруулахгүй.

---

# 1. Зорилго

BuildWatch нь барилгын төслийн амьдралын мөчлөгийг дараах урсгалаар удирдана.

```text
PDF / зураг төсөл / IFC / инженерийн Excel
            ↓
Зураг төслийн элемент таних
            ↓
Тоо хэмжээний түүвэр
            ↓
Материалын норм
            ↓
Материалын хэрэгцээ
            ↓
Үнийн каталог
            ↓
Урьдчилсан төсөв
            ↓
WBS + ажлын дараалал
            ↓
CPM + нөөцийн төлөвлөлт
            ↓
Өдөр бүрийн ажлын хуваарь
            ↓
Талбайн бодит гүйцэтгэл + зураг
            ↓
Өдрийн төлөвлөгөө биелсэн эсэх
            ↓
Rolling forecast: хугацаандаа амжих эсэх
            ↓
Alert + засах зөвлөмж
            ↓
Инженер / менежер батална
```

Системийн гол зорилго нь зөвхөн “юу болсон”-ыг бүртгэх биш, харин:

- өнөөдрийн ажил биелсэн эсэх;
- төлөвлөсөн хэмжээнээс хэдээр зөрсөн;
- зураг болон бүртгэл хоорондоо нийцэж байгаа эсэх;
- одоогийн хурдаар төслийг хугацаанд нь дуусгах боломжтой эсэх;
- амжихгүй бол хэдэн өдөр хоцрох төлөвтэй;
- ямар ажил, материал, бригад, саад гол шалтгаан болж байгааг;

өдөр бүр бодитоор тооцоолж харуулах явдал байна.

---

# 2. Үндсэн зарчим

| Код | Зарчим | Тайлбар |
|---|---|---|
| P-01 | AI бэлдэнэ, хүн батална | AI зураг, текст, баримтыг боловсруулж ноорог гаргана. Эцсийн баталгаа инженер, төсөвчин, менежерт үлдэнэ |
| P-02 | Тоо LLM-ээс гарахгүй | Тоо хэмжээ, материал, төсөв, хугацаа, critical path, forecast-ийг детерминистик service бодно |
| P-03 | Зураг бол нотолгооны нэг хэсэг | Фото дангаараа албан ёсны гүйцэтгэл биш. Тайлан, хэмжилт, зураг, материалын хөдөлгөөнтэй хамт үнэлнэ |
| P-04 | Scale баталгаагүй бол quantity блоклогдоно | Масштаб баталгаажаагүй зураг төслөөс бодит урт, талбай, эзлэхүүн гаргахгүй |
| P-05 | Үнэ, норм, бүтээмж эх сурвалжтай | Үнэ, материалын норм, бригадын бүтээмж бүр хүчинтэй огноо, хувилбар, баталсан хүнтэй байна |
| P-06 | Өдрийн төлөвлөгөө baseline-ийг эвдэхгүй | Өдөр тутмын schedule нь батлагдсан baseline-ийн operational view байна |
| P-07 | График автоматаар өөрчлөгдөхгүй | Forecast болон recovery proposal гарна. Шинэ baseline/version-ийг зөвхөн хүн батална |
| P-08 | Мэдээлэл хүрэлцэхгүй бол шууд хэлнэ | Таамаглал зохиохын оронд `INSUFFICIENT_INFORMATION` төлөв гаргана |
| P-09 | Бүх өөрчлөлт audit-тэй | Зураг, quantity, үнэ, хугацаа, баталгаа, буцаалт, override бүр хэн, хэзээ, яагаад гэдгээр хадгалагдана |
| P-10 | Tenant болон project isolation кодод | Prompt-д найдахгүй. Tool болон query дотроо tenantId, projectId, role-аар шүүнэ |

---

# 3. Агентуудын бүтэц

## 3.1 A0 — Зураг төсөл ба урьдчилсан тооцооны агент

**Үүрэг:**

- PDF, зураг, IFC, Excel ангилах;
- зураг төслийн revision, scale, discipline таних;
- давхар, өрөө, хана, хаалга, цонх, багана, дам нуруу, хавтан зэрэг элемент санал болгох;
- тоо хэмжээний түүврийн candidate үүсгэх;
- WBS, норм, үнэ, бүтээмжийн каталогоор холболт санал болгох;
- дутуу инженерийн мэдээллийг тодруулах асуулт үүсгэх;
- baseline draft бэлтгэх.

**A0 хийхгүй зүйл:**

- scale баталгаагүй зурагт quantity зохиох;
- байхгүй үнэ, норм, материал үүсгэх;
- инженерийн өмнөөс estimate батлах;
- албан ёсны төсөв гаргах.

---

## 3.2 A1 — Өдөр тутмын бүртгэлийн агент

**Үүрэг:**

- талбайн ахлагчийн чөлөөт бичвэрийг бүтэцтэй DailyReport draft болгох;
- work item, өнөөдрийн quantity, cumulative quantity, percent, headcount, hours, materials, blockers ялгах;
- зураг болон текстийн хооронд илэрхий зөрүү байвал асуулт үүсгэх;
- материалын нэр стандартчлах;
- давхардсан report сэжиглэх;
- confidence багатай талбарыг review-д оруулах.

---

## 3.3 A2 — Ажиглагч ба forecast агент

**Үүрэг:**

- төлөвлөгөө ба бодит гүйцэтгэлийг харьцуулах;
- өдөр, долоо хоног, сарын бүтээмжийн чиг хандлага олох;
- critical path болон downstream impact шинжлэх;
- босго давахаас өмнөх эрсдэлийг илрүүлэх;
- олон alert-ийн үндсэн шалтгааныг нэгтгэх;
- recovery option болон нөлөөллийн ноорог гаргах.

---

## 3.4 A3 — Тайлан ба бичиг баримтын агент

**Үүрэг:**

- өдөр, долоо хоног, сарын тайлангийн тайлбар бэлтгэх;
- хазайлтын дүгнэлт;
- нийлүүлэгч, туслан гүйцэтгэгчид зориулсан албан бичгийн draft;
- батлагдсан тоонуудыг template-д оруулах;
- PDF тайлан үүсгэх;
- хүний засварын diff хадгалах.

---

## 3.5 A4 — Read-only лавлагааны туслах

**Үүрэг:**

- хэрэглэгчийн асуултыг read-only tool дуудалт болгох;
- эх сурвалжтай хариу өгөх;
- эрхээс гадуурх project/tenant мэдээлэл харуулахгүй;
- тоог tool-ийн үр дүнгээс шууд ашиглах;
- өөрчлөх хүсэлтэд татгалзаж зөв дэлгэц рүү чиглүүлэх.

---

## 3.6 A5 — Өдөр тутмын төлөвлөлт ба гүйцэтгэл баталгаажуулах агент

A5 нь энэхүү requirement-д шинээр нэмэгдэж буй гол чадвар байна.

**Үүрэг:**

1. Батлагдсан schedule-ээс тухайн өдрийн ажлыг гаргах  
2. Бригад, техник, материал, календарь, цаг агаарын хязгаарлалтаар feasible daily plan үүсгэх  
3. Өдрийн эцэст text + quantity + photo evidence-ийг нэгтгэх  
4. Ажил бүрийг:
   - `COMPLETED`
   - `PARTIALLY_COMPLETED`
   - `NOT_COMPLETED`
   - `NOT_STARTED`
   - `BLOCKED`
   - `UNVERIFIABLE`
   гэж ангилах  
5. Daily plan variance бодох  
6. Remaining work болон rolling productivity-оор шинэ projected finish бодох  
7. “Энэ хурдаар хугацаандаа амжих уу?” гэдгийг confidence-тэй харуулах  
8. Амжихгүй бол recovery proposal бэлтгэх  
9. Инженерийн approval queue үүсгэх

---

# 4. Оролтын файлууд ба инженерээс авах мэдээлэл

## 4.1 Дэмжих файлууд

| Файл | Ашиглалт |
|---|---|
| PDF | Архитектур, бүтээц, инженерийн зураг |
| PNG / JPEG / WEBP | Скан зураг, фото нотолгоо |
| IFC | BIM элемент, geometry, property |
| XLSX | Төслийн нөхцөл, норм, үнэ, бүтээмж, нөөц, хамаарал |
| CSV | Каталог болон batch import |
| DOCX / PDF тайлбар | Техникийн тодорхойлолт, тайлбар бичиг |

---

## 4.2 Инженерийн Excel workbook

```text
BuildWatch_Project_Input.xlsx
├── 01_Project
├── 02_Drawing_Register
├── 03_Floors_Zones
├── 04_Construction_Assumptions
├── 05_Material_Catalog
├── 06_Work_Norms
├── 07_Prices
├── 08_Productivity
├── 09_Resources
├── 10_Dependencies
├── 11_Calendar
├── 12_Risk_Allowances
├── 13_Daily_Planning_Rules
├── 14_Crews_Shifts
├── 15_Photo_Evidence_Rules
├── 16_Progress_Measurement
├── 17_Weather_Logistics
└── 18_Approval_Matrix
```

---

## 4.3 `13_Daily_Planning_Rules`

Өдөр тутмын ажлыг хэрхэн хуваарилах дүрэм.

| Багана | Жишээ |
|---|---|
| RuleCode | DPR-001 |
| WorkCode | WALL-AAC-200 |
| MinimumDailyQty | 25 |
| TargetDailyQty | 45 |
| MaximumDailyQty | 60 |
| MinCrewSize | 4 |
| RequiredEquipment | MIXER-01 |
| RequiredMaterialCoverageDays | 2 |
| CanOverlapWith | ELECTRICAL-ROUGH |
| CannotOverlapWith | PLASTER |
| WeatherRestriction | NO_HEAVY_RAIN |
| PriorityRule | CRITICAL_FIRST |

---

## 4.4 `14_Crews_Shifts`

| Багана | Жишээ |
|---|---|
| CrewCode | CREW-MASON-01 |
| CrewType | MASON |
| Headcount | 5 |
| ShiftStart | 08:00 |
| ShiftEnd | 17:00 |
| BreakMinutes | 60 |
| ProductivityFactor | 1.00 |
| AvailableFrom | 2026-08-01 |
| AvailableTo | 2026-12-31 |
| AssignedProject | BW-001 |
| CostPerDay | 650000 |

---

## 4.5 `15_Photo_Evidence_Rules`

Ажил бүрт шаардлагатай фото нотолгооны дүрэм.

| Багана | Жишээ |
|---|---|
| WorkCode | FOUNDATION-CONCRETE |
| MinPhotoCount | 3 |
| RequiredAngles | overview; closeup; measurement |
| RequireTimestamp | TRUE |
| RequireLocation | OPTIONAL |
| RequireReferenceMarker | TRUE |
| RequireBeforeAfter | TRUE |
| MaxPhotoAgeMinutes | 120 |
| BlurThreshold | 0.60 |
| DuplicateCheck | TRUE |

---

## 4.6 `16_Progress_Measurement`

Ажлын төрлөөс хамаарсан биелэлт хэмжих арга.

| WorkCode | MeasurementMethod | Unit | CompletionRule |
|---|---|---|---|
| EXCAVATION | QUANTITY | m3 | actualQty / plannedQty |
| WALL-AAC-200 | QUANTITY | m2 | netWallAreaDone / totalWallArea |
| CONCRETE | QUANTITY_AND_CHECKLIST | m3 | pouredQty + inspection passed |
| ELECTRICAL | POINT_COUNT | point | completedPoints / totalPoints |
| FINISHING | AREA_AND_VISUAL | m2 | measuredArea + image verification |
| MILESTONE | CHECKLIST | boolean | all mandatory checks approved |

---

## 4.7 `17_Weather_Logistics`

| Багана | Жишээ |
|---|---|
| Date | 2026-08-01 |
| WeatherCode | HEAVY_RAIN |
| TemperatureMin | 12 |
| TemperatureMax | 21 |
| WindKmh | 25 |
| RestrictedWorkCodes | ROOF; EXTERNAL_PAINT |
| DeliveryWindow | 09:00-15:00 |
| SiteAccessStatus | OPEN |
| Notes | Хүнд даацын машинд түр хязгаарлалттай |

---

## 4.8 `18_Approval_Matrix`

| TargetType | DraftBy | ReviewBy | ApproveBy |
|---|---|---|---|
| QuantityTakeoff | A0 | Engineer | Estimator |
| Estimate | System | Estimator | Manager |
| DailyPlan | A5 | SiteEngineer | ProjectManager |
| DailyReport | A1 | SiteEngineer | ProjectManager |
| ProgressVerification | A5 | SiteEngineer | ProjectManager |
| BaselineChange | System | Engineer | ProjectManager |

---

# 5. Зураг төслөөс baseline үүсгэх урсгал

```text
1. Project setup
2. Document upload
3. Checksum + duplicate check
4. Drawing classification
5. Revision resolution
6. Scale verification
7. Element extraction
8. Engineer review
9. Quantity takeoff
10. Norm mapping
11. Material requirement
12. Price review
13. Cost estimate
14. Productivity mapping
15. Dependency graph
16. Calendar and resource validation
17. CPM
18. Schedule draft
19. Missing information report
20. Approval
21. BaselineVersion үүсгэх
```

---

# 6. Өдөр тутмын ажлын хуваарь гаргах

## 6.1 Daily planning input

A5 дараах мэдээллийг ашиглана:

- approved baseline;
- current schedule version;
- critical path;
- remaining quantities;
- өмнөх өдрийн actual progress;
- rolling productivity;
- crew availability;
- equipment availability;
- material availability;
- subcontractor commitment;
- calendar;
- weather and logistics constraints;
- open blockers;
- safety restrictions;
- inspection requirements;
- site zone conflicts.

---

## 6.2 Daily work plan үүсгэх

Өдөр бүр 05:00 эсвэл менежерийн хүсэлтээр:

```text
Current schedule
     +
Remaining quantities
     +
Criticality
     +
Resources
     +
Materials
     +
Weather
     +
Blockers
     ↓
DailyWorkPlan draft
```

DailyWorkPlan item бүр:

```json
{
  "date": "2026-08-01",
  "workItemCode": "SK-003",
  "zoneCode": "Z-01",
  "plannedQty": 18,
  "unit": "m3",
  "plannedStartTime": "08:00",
  "plannedEndTime": "17:00",
  "crewCode": "CREW-CONCRETE-01",
  "headcount": 8,
  "equipment": ["PUMP-01", "VIBRATOR-02"],
  "requiredMaterials": [
    {
      "materialCode": "CONCRETE-C25",
      "qty": 18,
      "unit": "m3"
    }
  ],
  "preconditions": [
    "FORMWORK_APPROVED",
    "REBAR_INSPECTION_PASSED"
  ],
  "evidenceRule": "PHOTO-CONCRETE-01",
  "criticality": "CRITICAL",
  "sourceScheduleActivityId": "ACT-003"
}
```

---

## 6.3 Өдрийн хуваарийн алгоритм

### Алхам 1 — Eligible work

Дараах нөхцөл хангагдсан ажлуудыг сонгоно:

- predecessor дууссан;
- required inspection батлагдсан;
- материал хүрэлцээтэй;
- crew болон equipment боломжтой;
- zone conflict байхгүй;
- weather restriction зөрчөөгүй;
- blocker нээлттэй биш.

### Алхам 2 — Priority

```text
1. Critical path дээрх ажил
2. Float багатай ажил
3. Material/crew booking-тэй ажил
4. Downstream олон ажлыг нээх ажил
5. Contract milestone-д хамаарах ажил
6. Ердийн non-critical ажил
```

### Алхам 3 — Daily quantity

```text
DailyTargetQty =
min(
  RemainingQty,
  CrewProductivity × CrewCount × ShiftFactor,
  MaterialAvailableQty,
  EquipmentCapacity,
  ZoneCapacity
)
```

### Алхам 4 — Resource conflict

Нэг crew, equipment, zone-ийг давхар хуваарилсан бол plan invalid болно.

### Алхам 5 — Manager review

A5-ийн гаргасан daily plan нь draft байна. Талбайн инженер засаж, менежер батална.

---

# 7. Өдрийн эцсийн гүйцэтгэл ба зураг

## 7.1 Талбайн ахлагчийн оролт

Орой бүр тухайн ажил бүрээр:

- actual quantity;
- cumulative quantity;
- headcount;
- hours worked;
- material used;
- equipment hours;
- blocker;
- note;
- 1–5 зураг;
- шаардлагатай бол богино видео;
- checklist;

оруулна.

---

## 7.2 Фото нотолгооны validation

Систем дараах шалгалтыг хийнэ:

| Код | Шалгалт |
|---|---|
| PE-01 | Файл нээгдэж байна уу |
| PE-02 | Зураг blur эсвэл хэт харанхуй юу |
| PE-03 | Duplicate зураг мөн үү |
| PE-04 | Өмнөх өдрийн зураг давтан ашигласан уу |
| PE-05 | Огноо report date-тэй нийцэж байна уу |
| PE-06 | Зөв project/work item-тэй холбоотой юу |
| PE-07 | Required angle бүрдсэн үү |
| PE-08 | Measurement marker эсвэл reference object байна уу |
| PE-09 | Текстийн мэдүүлэгтэй илэрхий зөрчил байна уу |
| PE-10 | Нууцлал шаардсан нүүр, дугаар, баримт харагдаж байна уу |

**Анхаарах зүйл:** зураг дээр үндэслэн exact quantity зохиохгүй. Зураг нь:

- declared progress-ийг дэмжих;
- илэрхий зөрчил илрүүлэх;
- ажлын үе шат таних;
- safety signal илрүүлэх;

зорилготой.

---

## 7.3 Гүйцэтгэлийн статус

Daily plan item бүр дараах дүрмээр үнэлэгдэнэ.

### `COMPLETED`

```text
ActualQty ≥ PlannedQty
AND required evidence complete
AND mandatory checklist passed
AND engineer verification not rejected
```

### `PARTIALLY_COMPLETED`

```text
0 < ActualQty < PlannedQty
```

### `NOT_COMPLETED`

```text
ActualQty = 0
AND work started or crew/equipment assigned
AND blockerгүй эсвэл зөвшөөрөгдөөгүй blocker
```

### `BLOCKED`

```text
ActualQty < PlannedQty
AND approved blocker exists
```

### `UNVERIFIABLE`

```text
Declared progress exists
BUT quantity, image, checklist, material movement
хоорондоо баталгаажихгүй
```

---

## 7.4 Биелэлтийн хувь

```text
DailyCompletionRate =
ActualQty / PlannedQty × 100
```

Жишээ:

```text
Төлөвлөсөн: 120 м3
Бодит: 90 м3
DailyCompletionRate = 75%
Variance = -30 м3
```

Ажилд quantity unit байхгүй бол approved checklist эсвэл weighted milestone ашиглана.

---

# 8. “Энэ хурдаар хугацаандаа амжих уу?” forecast

## 8.1 Rolling productivity

Систем нэг өдрийн гүйцэтгэлээр шууд дүгнэхгүй.

```text
RollingProductivity_3d
RollingProductivity_7d
RollingProductivity_14d
```

тооцно.

Шинэ project дээр historical data бага бол:

```text
ApprovedProductivityNorm
```

ашиглана.

---

## 8.2 Remaining duration

```text
RemainingDurationDays =
ceil(RemainingQty / AdjustedDailyProductivity)
```

`AdjustedDailyProductivity` дараах хүчин зүйлээр тохируулагдана:

- crew count;
- shift;
- actual recent productivity;
- weather factor;
- learning curve;
- equipment capacity;
- material availability;
- approved blocker days;
- calendar.

---

## 8.3 Projected finish

Ажил бүрийн remaining duration шинэчлэгдээд dependency graph дээр дахин CPM тооцно.

```text
ProjectedFinish =
CPM(CurrentDate, RemainingDurations, Dependencies, Calendar)
```

---

## 8.4 On-time status

| Төлөв | Нөхцөл |
|---|---|
| `ON_TRACK` | Projected finish ≤ approved finish |
| `AT_RISK` | 0 < projected delay ≤ warning threshold |
| `LIKELY_LATE` | projected delay > warning threshold |
| `CRITICAL_LATE` | critical milestone хоцрох өндөр магадлалтай |
| `INSUFFICIENT_DATA` | гүйцэтгэлийн өгөгдөл хүрэлцэхгүй |

Жишээ:

```json
{
  "baselineFinish": "2027-06-01",
  "projectedFinish": "2027-06-14",
  "delayDays": 13,
  "status": "LIKELY_LATE",
  "confidence": 0.82,
  "mainDrivers": [
    "SK-003 concrete productivity is 22% below plan",
    "MAT-CEM-001 stock covers only 3 days",
    "CREW-MASON-01 unavailable for 2 days"
  ]
}
```

---

## 8.5 Forecast confidence

Confidence нь model-ийн дурын тоо биш. Дараах үзүүлэлтээр бодно:

- approved report coverage;
- valid quantity coverage;
- photo evidence coverage;
- productivity history length;
- unresolved blockers;
- price/norm completeness;
- schedule dependency completeness;
- crew/resource data quality.

---

# 9. Recovery proposal

Төсөл амжихгүй төлөвтэй бол A5/A2 дараах хувилбаруудыг санал болгоно:

- crew нэмэх;
- хоёр ээлж болгох;
- critical work дээр equipment нэмэх;
- non-critical resource-ийг шилжүүлэх;
- feasible ажлыг зэрэгцүүлэх;
- material order-ийг урагшлуулах;
- zone sequence өөрчлөх;
- subcontractor capacity нэмэх.

Хувилбар бүр:

```json
{
  "proposal": "Add one masonry crew for 10 working days",
  "estimatedScheduleImpactDays": -6,
  "additionalCostMnt": 6500000,
  "requiredResources": ["CREW-MASON-02"],
  "dependencyConflicts": [],
  "risks": ["Site congestion"],
  "sources": ["FORECAST-2026-08-01", "RESOURCE-AVAILABILITY-01"]
}
```

Эцсийн нөлөөг deterministic simulation service бодно.

---

# 10. Детерминистик тооцооллын engine

Дараах тооцоог LLM хийхгүй:

- geometry;
- quantity;
- material requirement;
- waste;
- cost;
- tax;
- contingency;
- labor hours;
- equipment hours;
- daily target;
- resource capacity;
- productivity;
- schedule duration;
- topological sort;
- critical path;
- float;
- daily variance;
- rolling forecast;
- projected finish;
- delay propagation;
- scenario comparison.

---

# 11. Өгөгдлийн загварт нэмэх хүснэгтүүд

```text
DesignDocument
DrawingRevision
DrawingPage
DrawingScale
DesignElement
ElementGeometry
ElementProperty
ElementSourceRef

QuantityTakeoffVersion
QuantityTakeoffItem
TakeoffAdjustment

MaterialCatalog
MaterialAlias
NormCatalog
NormVersion
WorkNorm
ProductivityRate

PriceCatalog
PriceEntry
SupplierQuotation

EstimateVersion
EstimateLine
EstimateAssumption
EstimateScenario

ScheduleVersion
ScheduleActivity
ScheduleDependency
ResourceRequirement
Crew
Equipment
CrewAvailability
EquipmentAvailability

DailyWorkPlan
DailyWorkPlanItem
DailyPlanResource
DailyPlanMaterial
DailyPlanPrecondition

DailyReport
DailyProgressEntry
DailyAttendanceEntry
DailyMaterialUsage
DailyEquipmentUsage

PhotoEvidence
PhotoEvidenceLink
PhotoQualityCheck
PhotoDuplicateCheck

ProgressVerification
ProgressVerificationIssue
DailyVariance

ForecastSnapshot
ForecastWorkItem
ForecastDriver
RecoveryScenario

ReviewTask
ReviewDecision
ReviewCorrection
ApprovalMatrix
```

---

## 11.1 `DailyWorkPlan`

```text
id
tenantId
projectId
date
scheduleVersionId
status
generatedAt
generatedBy
reviewedBy
approvedBy
approvedAt
weatherSnapshotId
notes
```

Статус:

```text
DRAFT
REVIEW_REQUIRED
APPROVED
IN_PROGRESS
CLOSED
CANCELLED
```

---

## 11.2 `DailyWorkPlanItem`

```text
id
dailyWorkPlanId
workItemId
zoneId
plannedQty
unit
plannedStartTime
plannedEndTime
crewId
priority
criticality
evidenceRuleId
status
```

---

## 11.3 `PhotoEvidence`

```text
id
tenantId
projectId
dailyReportId
workItemId
fileUrl
capturedAt
uploadedAt
checksum
width
height
qualityScore
duplicateOfId
privacyStatus
metadataJson
```

---

## 11.4 `ProgressVerification`

```text
id
dailyProgressEntryId
plannedQty
declaredQty
verifiedQty
completionStatus
evidenceCoveragePct
confidence
varianceQty
variancePct
verificationMethod
reviewStatus
reviewedBy
reviewedAt
notes
```

---

## 11.5 `ForecastSnapshot`

```text
id
projectId
asOfDate
scheduleVersionId
baselineFinish
projectedFinish
delayDays
status
confidence
mainDriversJson
createdAt
```

---

# 12. Tool layer

## A0 tools

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

## A5 tools

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

## Детерминистик services

```text
calculateGeometry
calculateQuantities
calculateMaterials
calculateCostEstimate
calculateDailyTargets
validateDailyPlan
verifyDailyProgress
calculateRollingProductivity
calculateCriticalPath
calculateProjectedFinish
simulateRecoveryScenario
compareScheduleVersions
```

---

# 13. UI шаардлага

## 13.1 Project setup

- project metadata;
- зураг төсөл upload;
- Excel import;
- revision register;
- scale verification;
- missing information.

## 13.2 Quantity review

Зүүн тал:

```text
PDF / IFC viewer
```

Баруун тал:

```text
Element
Quantity
Formula
Source
Confidence
Review status
```

## 13.3 Daily plan board

Баганууд:

```text
Planned
In progress
Completed
Partial
Blocked
Unverified
```

Card бүр:

- work item;
- zone;
- target quantity;
- crew;
- materials;
- equipment;
- evidence requirement;
- criticality;
- forecast impact.

## 13.4 Evening submission

Мобайл дээр:

1. Өнөөдрийн work item сонгох  
2. Actual quantity оруулах  
3. Headcount/hours оруулах  
4. Blocker сонгох  
5. 1–5 зураг авах  
6. Илгээх  

Нийт хугацаа ≤ 2 минут.

## 13.5 Progress verification screen

Зүүн тал:

- өдрийн өмнөх зураг;
- өнөөдрийн зураг;
- drawing/source reference.

Баруун тал:

- planned qty;
- declared qty;
- verified qty;
- variance;
- evidence completeness;
- AI note;
- approve / edit / reject.

## 13.6 Forecast dashboard

```text
Baseline finish
Projected finish
Delay days
On-time status
Confidence
Critical drivers
Recovery options
```

---

# 14. Мэдэгдэл

| Event | Хэнд | Жишээ |
|---|---|---|
| Daily plan approval pending | Project manager | Маргаашийн plan батлах шаардлагатай |
| Required material insufficient | Нярав + manager | SK-003-д 2 өдрийн бетон дутуу |
| Evening report missing | Site supervisor | 18:30 хүртэл тайлан ирээгүй |
| Photo evidence incomplete | Site engineer | SK-001 measurement зураг алга |
| Daily target missed | Manager | SK-004 62% биелэлттэй |
| Forecast changed | Manager + director | Projected finish +5 өдөр болсон |
| Critical path risk | Manager | SK-003 2 өдөр дараалан target-аас доогуур |
| Duplicate image suspected | Engineer | Өмнөх өдрийн зурагтай 98% төстэй |

---

# 15. Найдвартай байдал ба хамгаалалт

| Код | Шаардлага |
|---|---|
| G-01 | Scale баталгаагүй зураг төслөөс metric quantity гаргахгүй |
| G-02 | Source reference-гүй quantity татгалзана |
| G-03 | Approved norm байхгүй material estimate final болохгүй |
| G-04 | Үнэ байхгүй мөрийг 0₮ гэж үзэхгүй |
| G-05 | Фотоноос exact quantity зохиохгүй |
| G-06 | Daily actual нь approved report-оос л schedule forecast-д орно |
| G-07 | Duplicate зурагтай report автоматаар батлагдахгүй |
| G-08 | Declared progress, material usage, attendance, photo хоорондын зөрүү review queue-д орно |
| G-09 | Батлагдаагүй forecast baseline-ийг өөрчлөхгүй |
| G-10 | LLM унтарсан ч daily plan, deterministic comparison, alert ажиллана |
| G-11 | API token төсөв хэтэрвэл AI draft зогсоно, core calculation үргэлжилнэ |
| G-12 | Tenant/project isolation integration тесттэй байна |

---

# 16. Үнэлгээний систем

## 16.1 Зураг төсөл

| Чадвар | Хэмжүүр |
|---|---|
| Element detection | Precision / recall |
| Dimension extraction | Absolute/relative error |
| Quantity takeoff | Engineer BOQ зөрүү % |
| Material estimate | Quantity error % |
| Cost formula | Approved quantity дээр 100% зөв |
| Schedule | Engineer schedule зөрүү |
| Source grounding | Source-гүй мөр = 0 |

## 16.2 Өдөр тутмын төлөвлөлт

| Чадвар | Хэмжүүр |
|---|---|
| Eligible work selection | Precision / recall |
| Resource conflict | Undetected conflict = 0 |
| Daily target accuracy | Actual vs planned variance |
| Critical work priority | Critical omission = 0 |
| Material feasibility | Shortage-той ажлыг feasible гэж гаргасан тоо = 0 |

## 16.3 Фото ба гүйцэтгэл

| Чадвар | Хэмжүүр |
|---|---|
| Duplicate detection | Precision / recall |
| Evidence completeness | Correct classification |
| Completion status | Engineer label-тэй accuracy |
| False completion | `COMPLETED` гэж буруу баталсан хувь |
| Unverifiable handling | Таамаглалгүй review-д шилжүүлсэн хувь |

## 16.4 Forecast

| Чадвар | Хэмжүүр |
|---|---|
| Work item finish forecast | MAE хоногоор |
| Project finish forecast | MAE хоногоор |
| Delay risk classification | Precision / recall |
| Early warning | Хэдэн хоногийн өмнө илрүүлсэн |
| Recovery impact | Simulation result-тэй зөрүү |
| False alert | Худал эрсдэлийн хувь |

---

# 17. Санал болгох acceptance target

```text
Source-гүй quantity                           = 0
Scale баталгаагүй metric quantity             = 0
Зохиомол материал, норм, үнэ                  = 0
Approved quantity дээр cost formula           = 100% зөв
CPM unit test                                 = 100% pass
Resource double-booking                       = 0
Photo duplicate test precision                ≥ 90%
Daily completion classification accuracy      ≥ 90%
False COMPLETED status                        < 3%
Forecast project finish MAE                   ≤ 7 ажлын өдөр
Critical delay recall                         ≥ 90%
Эрт сэрэмжлүүлсэн дундаж хугацаа              ≥ 5 өдөр
Tenant/project isolation зөрчил               = 0
Бодит бус тоон мэдэгдэл                       = 0
```

Эдгээр босгыг бодит болон simulation dataset-ийн үр дүнд үндэслэн шинэчилж болно.

---

# 18. Simulation dataset

Пилот компани байхгүй үед:

1. 40–60 work item-тай baseline үүсгэх  
2. Dependency болон critical path тохируулах  
3. 12 долоо хоногийн daily plan үүсгэх  
4. Зориуд дараах асуудлууд шигтгэх:
   - материалын дутагдал;
   - crew productivity бууралт;
   - тоног төхөөрөмжийн эвдрэл;
   - цаг агаар;
   - тайлан ирээгүй;
   - duplicate зураг;
   - declared progress/photo mismatch;
   - critical ажил хоцрох;
   - төсөв явцаас түрүүлэх;
5. Agent болон rules engine илрүүлсэн эсэхийг answer key-тэй тулгах.

---

# 19. Хэрэгжүүлэх үе шат

## Phase 1 — A0 core

- vector PDF;
- Excel workbook;
- architecture plan;
- wall, room, door, window;
- quantity;
- norms;
- prices;
- estimate;
- basic WBS;
- CPM;
- engineer review.

## Phase 2 — Daily planning

- DailyWorkPlan;
- crew/equipment/material feasibility;
- өдөр тутмын target;
- mobile plan view;
- approval.

## Phase 3 — Evening verification

- DailyReport;
- photo evidence;
- duplicate/quality check;
- progress verification;
- engineer approval.

## Phase 4 — Rolling forecast

- rolling productivity;
- projected finish;
- delay drivers;
- recovery scenarios;
- forecast dashboard.

## Phase 5 — Advanced

- IFC;
- revision impact;
- structural elements;
- MEP;
- resource leveling;
- weather integration;
- supplier quotation;
- schedule scenario optimization.

---

# 20. Definition of Done

## Зураг төсөл ба baseline

- [ ] PDF/IFC/Excel import ажиллана
- [ ] Drawing revision бүртгэгдэнэ
- [ ] Scale verification gate ажиллана
- [ ] Element source highlight-тай
- [ ] Quantity formula unit test-тэй
- [ ] Material norm, үнэ, бүтээмж source/version-тэй
- [ ] Estimate scenario гарна
- [ ] Schedule draft + CPM гарна
- [ ] Engineer review/approval ажиллана
- [ ] Approved baseline immutable байна

## Өдөр тутмын төлөвлөгөө

- [ ] Батлагдсан schedule-ээс daily plan гарна
- [ ] Resource/material/weather feasibility шалгана
- [ ] Critical work priority зөв байна
- [ ] Crew/equipment double-booking хориглогдоно
- [ ] Менежер засаж батална
- [ ] Мобайл дээр тухайн өдрийн ажил харагдана

## Оройн гүйцэтгэл

- [ ] Actual quantity, labor, material, blocker, зураг оруулна
- [ ] Фото чанар болон duplicate шалгалттай
- [ ] Planned vs actual variance бодно
- [ ] Completion status зөв ангилна
- [ ] `UNVERIFIABLE` зөвшөөрөгдсөн төлөв байна
- [ ] Инженер баталсны дараа forecast-д орно

## Forecast

- [ ] Rolling productivity тооцно
- [ ] Remaining duration шинэчлэгдэнэ
- [ ] CPM дахин бодогдоно
- [ ] Projected finish гарна
- [ ] `ON_TRACK / AT_RISK / LIKELY_LATE / CRITICAL_LATE` төлөвтэй
- [ ] Delay driver source-тэй
- [ ] Recovery proposal нөлөөллийн тооцоотой
- [ ] Baseline автоматаар өөрчлөгдөхгүй

---

# 21. Requirement-д өмнө нь дутуу байсан ба энд нэмсэн зүйлс

1. Өдөр тутмын ажил baseline-ээс автоматаар гаргах механизм  
2. Crew, equipment, material, weather-д тулгуурласан feasible daily plan  
3. Оройн фото нотолгооны стандарт  
4. Duplicate, blur, хуучин зураг ашигласан эсэх шалгалт  
5. Ажил бүрийн `COMPLETED / PARTIAL / BLOCKED / UNVERIFIABLE` төлөв  
6. Daily planned vs actual variance  
7. Rolling 3/7/14 хоногийн productivity  
8. Одоогийн хурдаар хугацаандаа амжих эсэх forecast  
9. Forecast confidence ба data quality  
10. Recovery scenario + хугацаа/зардлын нөлөөлөл  
11. Daily plan, photo evidence, verification, forecast-ийн өгөгдлийн хүснэгтүүд  
12. Өдөр тутмын ажил болон forecast-ийн acceptance metric  
13. Engineer/manager approval matrix  
14. Photo evidence-ийг нотолгоо боловч exact quantity биш гэж хязгаарласан дүрэм  
15. Өдөр бүрийн төлөвлөгөө болон тайлангийн reminder/alert  
16. Бодит пилотгүй үед simulation-аар батлах аргачлал  

---

# 22. Эцсийн бүтээгдэхүүний тодорхойлолт

> BuildWatch нь зураг төсөл, IFC болон инженерийн Excel өгөгдлөөс эх сурвалжтай тоо хэмжээний түүвэр, материалын хэрэгцээ, төсөв, WBS, CPM бүхий baseline draft үүсгэнэ. Батлагдсан baseline-ийг crew, equipment, материал, календарь, цаг агаар болон одоогийн гүйцэтгэлтэй тулган өдөр бүр хэрэгжих боломжтой ажлын хуваарь болгон задална. Талбайн ахлагч орой actual quantity, хүн хүч, материал, саад болон фото нотолгоо илгээхэд систем төлөвлөгөө биелсэн эсэхийг детерминистик байдлаар тооцож, зөрүүтэй эсвэл нотлох боломжгүй мөрийг инженерийн review-д шилжүүлнэ. Батлагдсан бодит гүйцэтгэлийн хурдаар remaining duration болон critical path-ийг дахин тооцож, төслийг хугацаандаа дуусгах боломжтой эсэх, хэдэн өдөр хоцрох эрсдэлтэй, ямар ажил болон нөөц гол шалтгаан болж байгааг эх сурвалжтайгаар харуулна. AI нь зураг, текст, баримт ангилах, дутуу мэдээллийг тодруулах, хэв маяг болон recovery option тайлбарлахад ашиглагдах бөгөөд бүх тоо хэмжээ, төсөв, хугацаа, forecast нь детерминистик хөдөлгүүрээр тооцогдоно.
