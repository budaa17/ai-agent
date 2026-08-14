# Construction Project Planning & Control AI System
## Project Requirements Specification

**Version:** 1.0  
**Document type:** Software / AI System Requirements  
**Purpose:** Барилгын төслийн зураг төсөл, тоо хэмжээ, материал, төсөв, хугацаа, нөөц, өдөр тутмын гүйцэтгэл, чанар болон эрсдэлийн мэдээллийг нэг дор боловсруулж, инженерийн төлөвлөлт ба хяналтын ажлыг хөнгөвчлөх системийн шаардлагыг тодорхойлох.

---

# 1. Төслийн зорилго

Системийн үндсэн зорилго нь барилгын төслийн эхний өгөгдлүүд болон барилгын явцын бодит мэдээллийг ашиглан дараах ажлуудыг автоматжуулах, хагас автомат болгох явдал байна.

1. Зураг төсөл болон баримт бичгээс шаардлагатай мэдээлэл извлэх.
2. Барилгын ажлын тоо хэмжээг тооцоолох.
3. Материалын хэрэгцээг норм болон хаягдлын коэффициент дээр үндэслэн бодох.
4. Хөдөлмөр, машин механизм болон бусад нөөцийн хэрэгцээг тооцоолох.
5. Нийт болон хэсэгчилсэн төсөв гаргах.
6. Ажлын бүтэц буюу WBS үүсгэх.
7. Ажлын дараалал, хамаарал дээр үндэслэн график болон CPM тооцоолох.
8. Ажиллах хүч болон машин механизмыг ажлуудад оновчтой хуваарилах.
9. Өдөр тутмын ажлын төлөвлөгөө автоматаар боловсруулах.
10. Өдрийн тайлан, бодит гүйцэтгэл, материал зарцуулалт болон талбайн зургаар төлөвлөгөөтэй харьцуулах.
11. Ажлын бүтээмжийг тооцоолох.
12. Хоцролт, материалын дутагдал, төсвийн хэтрэлт болон бусад эрсдэлийг урьдчилан тооцоолох.
13. Хоцролтыг нөхөх боломжит хувилбарууд боловсруулах.
14. Зураг төслийн хувилбар, өөрчлөлт, RFI, QA/QC болон NCR мэдээллийг удирдах.
15. Инженер болон төслийн удирдлагад шийдвэр гаргахад зориулсан dashboard, тайлан, alert гаргах.

Систем нь инженерийг орлох бус, инженерийн давтагддаг тооцоо, мэдээлэл нэгтгэх, хяналт хийх ажлыг багасгаж, эцсийн техникийн шийдвэрийг инженерээр баталгаажуулах зарчимтай байна.

---

# 2. Системийн үндсэн зарчим

## 2.1 AI ба deterministic calculation-ийг салгах

AI/LLM дараах төрлийн ажилд ашиглагдана:

- Текст ойлгох
- PDF болон зургийн мэдээлэл тайлбарлах
- Баримтаас field извлэх
- Өдрийн тайланг structured data болгох
- Баримт бичгийн утга, холбоосыг тайлбарлах
- RFI, тайлан, checklist-ийн draft боловсруулах
- Зургийн ерөнхий өөрчлөлт болон гүйцэтгэлийн шинж тэмдгийг илрүүлэх

Deterministic calculation engine дараах ажлыг гүйцэтгэнэ:

- Геометрийн тооцоо
- Quantity calculation
- Material requirement
- Waste calculation
- Labor man-hour
- Equipment-hour
- Cost calculation
- Productivity
- Variance
- CPM
- Critical path
- Float
- Resource availability check
- Material shortage
- Forecast dates
- Budget variance

> **Шаардлага:** Санхүү, хугацаа, quantity болон инженерийн тооцооны эцсийн утгыг LLM-ийн чөлөөт текстээр шууд гаргахгүй. Баталгаатай input + тодорхой formula / algorithm ашиглан тооцно.

---

# 3. Хэрэглэгчийн үндсэн төрлүүд

## 3.1 Project Administrator
- Төсөл үүсгэх
- Хэрэглэгч нэмэх
- Эрх тохируулах
- Төслийн үндсэн тохиргоо хийх

## 3.2 Project Manager
- Нийт явц харах
- Schedule батлах
- Нөөцийн хуваарилалт харах
- Forecast болон risk review хийх
- Recovery plan сонгох

## 3.3 Site Engineer
- Өдрийн төлөвлөгөө харах
- Өдрийн тайлан оруулах
- Quantity батлах
- Фото нотолгоо оруулах
- Issue / blocker бүртгэх
- Inspection үүсгэх

## 3.4 Quantity / Cost Engineer
- BOQ шалгах
- Quantity батлах
- Material norm тохируулах
- Unit rate шинэчлэх
- Estimate батлах

## 3.5 Planner
- WBS засварлах
- Dependency тохируулах
- Calendar тохируулах
- Schedule review хийх
- Baseline батлах

## 3.6 QA/QC Engineer
- Checklist
- Inspection
- NCR
- Corrective action удирдах

## 3.7 Viewer / Client
- Dashboard
- Явц
- Тайлан
- Батлагдсан мэдээлэл харах

---

# 4. Системд эхэнд оруулах шаардлагатай өгөгдөл

Систем хэрэглэгчээс бүх мэдээллийг нэг дор гараар бөглүүлэхгүй.

Зөв дараалал:

```text
Upload / Import
      ↓
Automatic extraction
      ↓
Validation
      ↓
Missing data detection
      ↓
User confirmation
      ↓
Engineer approval
```

---

# 5. Project Master Data

Төсөл бүр дараах үндсэн мэдээлэлтэй байна.

| Field | Тайлбар | Required |
|---|---|---|
| Project Name | Төслийн нэр | Yes |
| Project Type | Орон сууц, үйлдвэр, оффис гэх мэт | Yes |
| Location | Ерөнхий байршил | Yes |
| Building Count | Барилгын блокийн тоо | No |
| Floor Count | Давхрын тоо | Yes |
| Gross Floor Area | Нийт талбай | Recommended |
| Planned Start Date | Төлөвлөсөн эхлэх огноо | Yes |
| Target Finish Date | Зорилтот дуусах огноо | Yes |
| Working Calendar | Ажлын өдөр | Yes |
| Default Shift | Ажиллах цаг | Yes |
| Currency | MNT, USD гэх мэт | Yes |
| Time Zone | Төслийн цагийн бүс | Yes |
| Measurement System | Metric | Yes |

---

# 6. Зураг төсөл болон техникийн баримт бичгийн input

Систем дараах файлуудыг дэмжихээр төлөвлөгдөнө.

## 6.1 Architectural
- PDF
- DWG/DXF
- IFC
- зураг хэлбэрийн scan

Извлэх боломжтой мэдээлэл:

- Building
- Floor
- Zone
- Room
- Wall
- Door
- Window
- Floor area
- Ceiling
- Opening
- Finish type
- Length
- Width
- Height
- Thickness
- Grid
- Level

## 6.2 Structural

- Foundation
- Footing
- Pile
- Column
- Beam
- Slab
- Wall
- Stair
- Reinforcement
- Steel structure
- Concrete grade
- Member dimensions

## 6.3 MEP

### Plumbing
- Pipe type
- Diameter
- Length
- Fixture
- Valve
- Pump

### HVAC
- Duct
- Pipe
- Fan
- AHU
- FCU
- Radiator
- Equipment

### Electrical
- Cable
- Conduit
- Socket
- Light
- DB
- Panel
- Transformer
- Equipment load

### ELV
- CCTV
- Fire alarm
- Access control
- Network
- Data point
- Other low-voltage systems

## 6.4 General Plan
- Building position
- Road
- Parking
- Outdoor utilities
- Landscape
- Level
- External work area

## 6.5 Technical documents
- Specification
- Technical requirement
- Geotechnical report
- Technical conditions
- Method statement
- Approved material submittal
- Design note

---

# 7. Drawing Revision Control

Drawing бүр дараах metadata-тай байна.

- Document Number
- Drawing Number
- Discipline
- Revision Number
- Revision Date
- Status
- Approved / Draft / Superseded
- Uploaded By
- Approved By

Жишээ:

```text
AR-101 Rev01
AR-101 Rev02
AR-101 Rev03 ← Current Approved
```

## 7.1 Шаардлага

- Хуучин revision автоматаар superseded болох.
- Ажилд ашиглагдаж байгаа drawing хуучин бол warning өгөх.
- Revision хоорондын өөрчлөлтийг харьцуулах.
- Өөрчлөлт quantity, cost болон schedule-д нөлөөлөх эсэхийг тооцоолох.
- Change impact батлагдахаас өмнө baseline-г шууд өөрчлөхгүй.

---

# 8. Spatial Breakdown

Төслийн бүх ажил байршилтай холбогдоно.

```text
Project
 └── Building
      └── Floor
           └── Zone
                └── Room / Area
```

## 8.1 Шаардлага

Work Item, Daily Plan, Daily Report, Photo, Inspection болон Issue бүр дээр location заавал эсвэл боломжтой хэмжээнд холбогдсон байна.

---

# 9. Work Breakdown Structure (WBS)

Систем бүх ажлыг WBS хэлбэрээр хадгална.

Жишээ:

```text
1. Earthwork
2. Foundation
3. Structure
4. Masonry
5. MEP
6. Finishing
7. External Works
8. Testing & Commissioning
```

Work Item бүр:

| Field | Тайлбар |
|---|---|
| Work Code | Давтагдашгүй код |
| Work Name | Ажлын нэр |
| Unit | m, m², m³, ton, pcs гэх мэт |
| Quantity | Нийт хэмжээ |
| Location | Floor / Zone |
| Discipline | Architectural / Structural / MEP |
| Activity Type | Ажлын төрөл |
| Status | Planned/In Progress/Done |
| Source | Drawing/BOQ/Manual |
| Confidence | Extraction confidence |
| Approval Status | Draft/Approved |

---

# 10. Quantity Takeoff Module

## 10.1 Зорилго

Зураг болон model-оос хэмжээс авч quantity үүсгэх.

## 10.2 Жишээ

```text
Wall:
Length = 8.4 m
Height = 3.0 m

Gross area = 25.2 m²

Opening area = 4.2 m²

Net wall area = 21.0 m²
```

## 10.3 Шаардлага

- Formula trace хадгална.
- Quantity бүр source drawing / element-тэй холбоотой байна.
- AI extracted quantity нь Draft байна.
- Инженер баталсны дараа Approved болно.
- Manual override хийх боломжтой байна.
- Override reason хадгална.
- Нэг quantity-г давхар тоолохоос хамгаална.
- Unit conversion дэмжинэ.

---

# 11. Material Norm Database

Work Item → Material relation байна.

Жишээ:

```text
1 m² block masonry:
- Block = 12.5 pcs
- Cement = 5.2 kg
- Sand = 0.016 m³
```

Field:

- Work Type
- Material Code
- Material Name
- Usage Per Unit
- Unit
- Source
- Valid From
- Valid To
- Company-specific / Standard
- Approval Status

---

# 12. Waste Factor

Material бүр optional waste factor-тай байна.

```text
Required material =
Net Quantity × Material Norm × (1 + Waste Factor)
```

Waste factor:

- Company default
- Project-specific
- Work-specific
- Material-specific

түвшинд тохируулж болно.

## 12.1 Priority

```text
Work-specific
↓
Project-specific
↓
Company-specific
↓
Global default
```

---

# 13. Material Master Data

Material бүр:

- Material Code
- Name
- Category
- Unit
- Specification
- Brand
- Manufacturer
- Supplier
- Unit Price
- VAT
- Delivery Cost
- Lead Time
- Minimum Order Quantity
- Storage Requirement
- Current Stock
- Reorder Level

---

# 14. Labor Norm & Productivity

## 14.1 Labor Norm

```text
Labor requirement =
Work Quantity × Labor Hours per Unit
```

Жишээ:

```text
100 m² masonry
× 0.8 man-hour/m²
= 80 man-hours
```

## 14.2 Productivity

```text
Productivity =
Actual Quantity / Actual Man-hours
```

Жишээ:

```text
46 m²
8 workers
9 hours

Man-hours = 72
Productivity = 46 / 72
             = 0.639 m²/man-hour
```

## 14.3 Productivity hierarchy

Forecast хийхдээ дараах дарааллыг ашиглана.

1. Same Crew + Same Work Type + Recent Actual
2. Same Project + Same Work Type
3. Company Historical Average
4. Standard Labor Norm

Ингэснээр нэг удаагийн санамсаргүй муу/сайн өдөр бүх schedule-г буруу өөрчлөхөөс сэргийлнэ.

---

# 15. Crew & Worker Resource Data

Crew бүр:

- Crew ID
- Crew Name
- Skill
- Worker Count
- Supervisor
- Shift
- Available From
- Available To
- Maximum Hours
- Productivity History
- Assigned Activities

Worker-ийн нэр заавал шаардлагагүй. MVP түвшинд crew-level planning хангалттай.

---

# 16. Equipment Resource

Equipment бүр:

- Equipment ID
- Type
- Capacity
- Availability
- Working Hours
- Cost per Hour
- Mobilization Cost
- Location
- Maintenance Status

Жишээ:

- Excavator
- Crane
- Concrete Pump
- Loader
- Truck
- Compactor
- Hoist

---

# 17. Cost Database

Төсвийн үндсэн бүтэц:

```text
Material Cost
+ Labor Cost
+ Equipment Cost
+ Subcontract Cost
+ Other Direct Cost
= Direct Cost

Direct Cost
+ Overhead
+ Contingency
+ Tax
= Total Estimated Cost
```

## 17.1 Unit Rate

Work Item-ийн unit rate нь боломжтой бол задралтай байна.

```text
Unit Rate =
Material/unit
+ Labor/unit
+ Equipment/unit
+ Other/unit
```

---

# 18. BOQ Management

Хэрэглэгч BOQ import хийж болно.

Дэмжих format:

- Excel
- CSV
- Structured import

Хэрэв BOQ байхгүй:

```text
Drawing
↓
Quantity Takeoff
↓
Draft BOQ
↓
Engineer Review
↓
Approved BOQ
```

## 18.1 Duplicate checking

Drawing-derived quantity болон imported BOQ хоёрыг шууд нийлүүлж давхардуулж болохгүй.

Систем source type болон mapping ашиглан:

- Imported
- Derived
- Reconciled

гэсэн төлөвтэй байна.

---

# 19. Activity Duration Calculation

Duration-г шууд AI таахгүй.

Үндсэн formula:

```text
Required Man-hours =
Quantity × Labor Hours per Unit

Daily Crew Capacity =
Worker Count × Effective Hours per Day

Base Duration =
Required Man-hours / Daily Crew Capacity
```

Хэрэв historical productivity хангалттай бол:

```text
Duration =
Remaining Quantity / Forecast Crew Productivity
```

---

# 20. Work Dependency

Activity хооронд дараах dependency дэмжинэ.

- Finish to Start (FS)
- Start to Start (SS)
- Finish to Finish (FF)
- Start to Finish (SF)

Мөн:

- Lead
- Lag

дэмжинэ.

Жишээ:

```text
Concrete Pour
   ↓
FS + 7 days
   ↓
Next Structural Activity
```

---

# 21. Working Calendar

Project calendar:

- Working days
- Weekend
- Public holiday
- Shift start/end
- Break time
- Overtime
- Weather shutdown day
- Project-specific non-working day

Duration болон CPM calculations нь calendar-aware байна.

---

# 22. CPM Scheduling Engine

Систем:

- Early Start
- Early Finish
- Late Start
- Late Finish
- Total Float
- Free Float
- Critical Path

тооцоолно.

## 22.1 Critical activity

```text
Total Float <= configured threshold
```

бол critical гэж үзэж болно.

Default threshold = 0.

---

# 23. Baseline Management

Schedule бүр:

- Draft Schedule
- Approved Baseline
- Current Forecast

гэж ялгаатай байна.

## 23.1 Чухал дүрэм

Actual progress эсвэл AI forecast өөрчлөгдлөө гээд **Approved Baseline-г автоматаар overwrite хийхгүй**.

Forecast тусдаа хадгалагдана.

Baseline өөрчлөлт зөвхөн:

- Approved Change Order
- Authorized Rebaseline

үед хийгдэнэ.

---

# 24. Resource Allocation

Систем activity бүрт:

- Crew
- Equipment
- Material availability
- Location

шалгаж хуваарилна.

## 24.1 Resource conflict

Нэг crew эсвэл equipment нэг хугацаанд давхар activity-д assign болсон бол conflict alert гаргана.

## 24.2 Location conflict

Нэг жижиг zone-д хоорондоо зөрчилтэй олон ажил зэрэг төлөвлөгдвөл warning өгч болно.

---

# 25. Daily Planning

Өдөр бүр систем дараах мэдээлэлтэй daily task санал болгоно.

- Date
- Activity
- Work Code
- Location
- Planned Quantity
- Crew
- Worker Count
- Equipment
- Required Material
- Prerequisite
- Safety Requirement
- QA Checklist
- Planned Start
- Planned Finish

Жишээ:

```text
Date: 2026-08-10
Location: Floor 3 / Zone B
Activity: Block Masonry
Planned Quantity: 52 m²
Crew: Mason Team A
Workers: 8
Required Block: 690 pcs
Required Mortar: 1.2 m³
```

---

# 26. Constraint Check Before Daily Plan

Daily task-г assign хийхээс өмнө систем дараах нөхцөлийг шалгана.

- Predecessor дууссан эсэх
- Drawing approved эсэх
- Material available эсэх
- Crew available эсэх
- Equipment available эсэх
- Required inspection completed эсэх
- Work area ready эсэх
- Blocking issue байгаа эсэх

Хэрэв critical constraint unresolved бол activity-г Ready гэж тэмдэглэхгүй.

---

# 27. Method Statement / Work Instruction

Activity template бүр дээр:

- Preparation
- Required Tool
- Required Material
- Execution Steps
- Inspection Point
- Safety Note
- Completion Criteria

байна.

## 27.1 AI usage

AI existing approved method statement-ээс:

- daily summary
- checklist
- worker instruction draft

гаргаж болно.

AI шинэ structural / safety-critical engineering method-ийг шууд approved болгох эрхгүй.

---

# 28. QA/QC Checklist

Work Type бүр checklist template-тай байна.

Жишээ: Concrete

- Formwork checked
- Rebar checked
- Embedment checked
- Concrete grade verified
- Slump test completed
- Sample taken
- Pour approval granted

---

# 29. Inspection

Inspection бүр:

- Work Item
- Location
- Inspection Type
- Requested Date
- Inspector
- Result
- Comment
- Photo
- Attachment
- Approved By

Result:

- Pass
- Conditional Pass
- Fail

---

# 30. NCR

Inspection Fail эсвэл зөрчил гарвал:

- NCR Number
- Issue
- Location
- Related Work
- Severity
- Responsible Party
- Corrective Action
- Due Date
- Status
- Verification

үүсгэнэ.

---

# 31. Daily Report

Өдрийн тайланд:

- Date
- Work Item
- Location
- Actual Quantity
- Unit
- Crew
- Worker Count
- Actual Working Hours
- Material Used
- Equipment Used
- Delay
- Delay Reason
- Issue
- Comment
- Photo
- Weather
- Safety Incident
- Inspection Result

орно.

---

# 32. Natural Language Daily Intake

Хэрэглэгч бүх field-ийг гараар бөглөх шаардлагагүй.

Жишээ:

> 3-р давхар Zone B өрлөг 46м² хийсэн. 8 хүн 9 цаг ажилласан. 620 блок зарцуулсан. Материал өглөө 2 цаг хоцорсон.

Систем:

```text
Location = Floor 3 / Zone B
Activity = Masonry
Actual Quantity = 46 m²
Workers = 8
Hours = 9
Material = Block
Material Used = 620 pcs
Delay = 2 hours
Delay Reason = Material delivery
```

гэж structured draft үүсгэнэ.

Дараа нь хэрэглэгч confirm хийнэ.

---

# 33. Photo-based Progress Evidence

Photo бүр:

- Project
- Date
- Time
- Location
- Related Work Item
- Uploaded By
- Caption
- Evidence Type

metadata-тай байна.

AI зураг ашиглан:

- Ажил эхэлсэн эсэх
- Visible progress
- Equipment presence
- Material presence
- Obvious issue
- Previous photo comparison

зэрэг **evidence signal** гаргаж болно.

## 33.1 Чухал дүрэм

Photo estimate-г дангаар нь official quantity гэж ашиглахгүй.

```text
Reported Quantity
+
Photo Evidence
+
Inspection
+
Engineer Confirmation
=
Accepted Actual
```

гэсэн олон эх үүсвэрийн баталгаажуулалт ашиглана.

---

# 34. Plan vs Actual

Activity бүрт:

```text
Planned Quantity
Actual Quantity
Quantity Variance
Planned Start
Actual Start
Planned Finish
Forecast Finish
Schedule Variance
Planned Cost
Actual Cost
Cost Variance
```

хадгална.

Progress:

```text
Physical Progress % =
Accepted Completed Quantity / Approved Total Quantity × 100
```

---

# 35. Progress Aggregation

Project progress-г activity-н хувийг шууд дундажлахгүй.

Weighting method хэрэглэнэ.

Default:

```text
Activity Weight =
Approved Budgeted Cost
```

эсвэл тохиргоогоор:

- Cost weighted
- Quantity weighted
- Labor-hour weighted

байж болно.

---

# 36. Productivity Analysis

Систем:

- Daily productivity
- 7-day rolling productivity
- 14-day rolling productivity
- 30-day rolling productivity
- Crew average
- Project average
- Planned vs Actual productivity

тооцоолно.

Short-term forecast-д нэг өдрийн утга биш rolling average ашиглана.

---

# 37. Finish Date Forecast

Forecast хийхдээ:

- Remaining Quantity
- Recent Productivity
- Crew Availability
- Calendar
- Dependency
- Critical Path
- Known Delay
- Material Constraint

ашиглана.

Жишээ:

```text
Remaining Quantity = 1000 m²
Forecast Productivity = 72 m²/day

Raw Duration = 13.89 working days
```

Calendar болон successor dependency-г нэмж project forecast-г шинэчилнэ.

---

# 38. Delay Classification

Delay reason standard category-тэй байна.

- Material
- Design
- Labor
- Equipment
- Weather
- Approval
- Client
- Rework
- Safety
- Access
- Subcontractor
- Unknown

Мөн:

- Excusable
- Non-excusable
- Internal
- External

гэсэн classification optional байна.

---

# 39. Recovery Plan

Хоцролт илэрвэл систем боломжит хувилбарууд гаргана.

Жишээ:

- Worker count нэмэх
- Additional crew
- Overtime
- Shift extension
- Parallel zone
- Equipment increase
- Resequencing
- Material expedited delivery

## 39.1 Recovery option бүр:

- Expected Schedule Gain
- Additional Cost
- Resource Need
- Risk
- Feasibility
- Constraint

харуулна.

AI зөвлөмж гаргаж болох боловч Project Manager / Engineer сонгон батална.

---

# 40. Procurement Forecast

Schedule + Material Norm + Stock ашиглан:

```text
Future Work
↓
Future Material Demand
↓
Current Stock
↓
Committed Purchase
↓
Expected Delivery
↓
Projected Shortage
```

тооцно.

---

# 41. Inventory Management

Material stock:

- Opening Stock
- Received
- Issued
- Returned
- Damaged
- Reserved
- Available
- Ordered
- Expected Delivery

## 41.1 Formula

```text
Available Stock =
Opening + Received + Returned
- Issued
- Damaged
- Reserved
```

---

# 42. Material Shortage Alert

```text
Projected Available on Need Date
<
Required Quantity
```

бол shortage alert.

Alert:

- Material
- Required Date
- Required Qty
- Forecast Available Qty
- Shortage Qty
- Suggested Order Date

---

# 43. Cost Control

Дараах утгууд тусдаа байна.

- Original Budget
- Current Approved Budget
- Committed Cost
- Actual Cost
- Forecast Cost
- Approved Change
- Pending Change

## 43.1 Forecast

```text
Estimate At Completion (EAC) =
Actual Cost to Date
+
Forecast Remaining Cost
```

---

# 44. Change Management

Change бүр:

- Change ID
- Source
- Description
- Drawing Revision
- Quantity Impact
- Cost Impact
- Schedule Impact
- Requested By
- Approval Status

Status:

- Draft
- Submitted
- Under Review
- Approved
- Rejected

Approved change л baseline budget болон scope-д нөлөөлнө.

---

# 45. RFI Management

RFI:

- RFI No
- Subject
- Question
- Related Drawing
- Related Work
- Location
- Requested By
- Assigned To
- Due Date
- Response
- Status
- Schedule Impact

AI холбогдох drawing/specification/context-ийг ашиглан draft RFI боловсруулахад тусалж болно.

---

# 46. Issue / Blocker Management

Issue бүр:

- Issue ID
- Date
- Category
- Description
- Work Item
- Location
- Owner
- Severity
- Schedule Impact
- Cost Impact
- Expected Resolution
- Status

Unresolved issue нь daily readiness болон forecast-д нөлөөлнө.

---

# 47. Risk Register

Risk бүр:

- Risk ID
- Category
- Description
- Probability
- Impact
- Risk Score
- Mitigation
- Owner
- Due Date
- Status

Risk score:

```text
Risk Score = Probability × Impact
```

Exact scale нь project configuration-аар тодорхойлогдоно.

---

# 48. Dashboard

## 48.1 Project Dashboard

- Overall Physical Progress
- Planned Progress
- Schedule Variance
- Forecast Finish
- Baseline Finish
- Budget
- Actual Cost
- Forecast Cost
- Critical Activities
- Open Issues
- Open RFIs
- Material Risks
- Failed Inspections
- NCR Count
- Crew Productivity
- Recent Daily Progress

## 48.2 Engineer Dashboard

- Today's Tasks
- Unconfirmed Daily Reports
- Pending Inspections
- Blocked Activities
- Missing Materials
- Drawing Revision Warning
- Upcoming Work
- Required Decisions

---

# 49. Alerts

Систем дараах alert-уудыг гаргана.

## Schedule
- Activity delayed
- Critical activity delayed
- Forecast project finish moved

## Resource
- Crew conflict
- Equipment conflict
- Capacity shortage

## Material
- Low stock
- Future shortage
- Late delivery

## Document
- Superseded drawing
- Unapproved drawing used
- RFI overdue

## Quality
- Inspection failed
- NCR overdue

## Cost
- Budget variance
- Forecast overrun

---

# 50. Data Confidence & Approval

AI-generated мэдээлэл бүр confidence болон review state-тай байна.

Жишээ:

```text
Extracted Quantity
Confidence: 0.82
Status: Needs Review
```

## 50.1 Approval states

- AI Draft
- User Reviewed
- Engineer Approved
- Rejected
- Superseded

## 50.2 Чухал дүрэм

Доорх мэдээлэл Engineer Approved болохоос өмнө contractual / official output-д ашиглагдахгүй:

- Quantity
- Structural interpretation
- Approved cost baseline
- Approved schedule baseline
- Change order
- Inspection result

---

# 51. Audit Trail

Чухал өөрчлөлт бүр:

- Who
- What
- Previous Value
- New Value
- Date/Time
- Reason

хадгална.

Delete хийхийн оронд soft-delete / versioning ашиглахыг зөвлөж байна.

---

# 52. Data Validation

## 52.1 Required validation

- Unit mismatch
- Negative quantity
- Invalid date
- Finish < Start
- Duplicate work code
- Duplicate drawing revision
- Invalid resource assignment
- Circular dependency
- Missing predecessor
- Unknown material
- Missing price
- Missing productivity norm

## 52.2 Dependency cycle

Schedule graph-д cycle байвал CPM ажиллуулахгүй.

Жишээ:

```text
A → B → C → A
```

бол validation error.

---

# 53. Calculation Traceability

Тооцоолсон бүх үр дүн тайлбарлагдах ёстой.

Жишээ:

```text
Material Required = 70,875 pcs

Source:
Wall Quantity = 5,400 m²
Norm = 12.5 pcs/m²
Waste = 5%

Calculation:
5,400 × 12.5 × 1.05
```

User "энэ тоо хаанаас гарсан?" гэж асуухад систем эх үүсвэр болон formula-г харуулна.

---

# 54. Unit Management

Дэмжих үндсэн unit:

- mm
- cm
- m
- m²
- m³
- kg
- ton
- pcs
- liter
- hour
- man-hour
- machine-hour

Unit conversion centralized service байна.

---

# 55. Document Search

Систем төсөл дотор:

- Drawing
- Specification
- Method Statement
- RFI
- Inspection
- Daily Report
- BOQ
- Contract attachment

дотроос semantic болон exact search хийх боломжтой байна.

---

# 56. Reporting

Export:

- PDF
- Excel
- CSV

Тайлан:

- Daily Report
- Weekly Progress Report
- Monthly Progress Report
- Material Requirement
- Cost Estimate
- Cost Variance
- Schedule
- Lookahead Plan
- Delay Report
- Productivity Report
- RFI Register
- NCR Register
- Risk Register

---

# 57. Lookahead Planning

Систем:

- 7-day
- 14-day
- 21-day
- 30-day

lookahead гаргаж чадна.

Lookahead бүр дээр:

- Upcoming Activity
- Location
- Crew
- Material Need
- Equipment
- Prerequisite
- Constraint
- Readiness

харуулна.

---

# 58. Activity Readiness Score

Optional feature:

Activity хийхэд бэлэн эсэхийг дараах constraint-уудаар үнэлж болно.

- Drawing
- Material
- Crew
- Equipment
- Predecessor
- Inspection
- Access
- Approval

Жишээ:

```text
7 / 8 constraints ready
Readiness = 87.5%
```

Critical prerequisite missing бол percentage өндөр байсан ч `Blocked` гэж үзнэ.

---

# 59. Project Learning

Систем төслийн actual data-аас:

- Crew productivity
- Material waste
- Work duration
- Common delay reason
- Supplier delay
- Rework rate

гэх мэт historical metric үүсгэнэ.

Эдгээрийг ирээдүйн project estimate болон schedule-д ашиглаж болно.

---

# 60. Machine Learning ашиглах үед тавих шаардлага

Historical data хангалтгүй бол ML forecast ашиглахгүй.

Систем fallback хийх ёстой:

```text
Project Actual
↓
Company Historical
↓
Standard Norm
```

Model version болон training dataset version audit-т хадгалагдана.

---

# 61. Security Requirements

- Authentication
- Role-based access control
- Project-level data isolation
- Tenant isolation шаардлагатай бол multi-tenant architecture
- File access control
- Audit log
- Secure password storage
- Encrypted secrets
- API rate limiting
- Backup
- Restore
- File virus scanning
- Signed file access эсвэл protected file delivery

---

# 62. Non-Functional Requirements

## 62.1 Performance

- Dashboard normal data дээр хурдан нээгдэх.
- Calculation heavy task background job ашиглаж болох боловч user-д job status харагдах.
- Том PDF / IFC боловсруулах task synchronous request-д түгжигдэхгүй.

## 62.2 Reliability

- Calculation repeatable байх.
- Calculation engine ижил input-д ижил output өгнө.
- Failed import rollback эсвэл partial error report өгнө.

## 62.3 Scalability

Architecture дараах хэмжээнд өргөжих боломжтой байна:

```text
One Project
↓
Multiple Projects
↓
Multiple Companies
```

## 62.4 Explainability

Forecast, alert, calculation бүр боломжит хэмжээнд reason харуулна.

---

# 63. Core Database Entities

Санал болгож буй үндсэн entity:

```text
User
Organization
Project
ProjectMember

Building
Floor
Zone
Room

Document
Drawing
DrawingRevision
DrawingElement

WBS
WorkItem
WorkQuantity
WorkDependency

Material
MaterialNorm
MaterialPrice
MaterialStock
MaterialTransaction
PurchaseOrder

Crew
Worker
Equipment
ResourceAssignment

LaborNorm
ProductivityRecord

Calendar
Schedule
ScheduleBaseline
Activity

DailyPlan
DailyReport
DailyProgress
Photo

CostEstimate
CostItem
ActualCost

Inspection
Checklist
NCR

RFI
Issue
Risk
ChangeOrder

Alert
Approval
AuditLog
```

---

# 64. Logical Relationship

```text
PROJECT
│
├── DOCUMENT
│   └── DRAWING REVISION
│       └── DRAWING ELEMENT
│
├── LOCATION
│   ├── BUILDING
│   ├── FLOOR
│   ├── ZONE
│   └── ROOM
│
├── WBS
│   └── WORK ITEM
│       ├── QUANTITY
│       ├── MATERIAL NORM
│       ├── LABOR NORM
│       ├── EQUIPMENT NORM
│       └── DEPENDENCY
│
├── MATERIAL
│   ├── PRICE
│   ├── STOCK
│   └── PROCUREMENT
│
├── RESOURCE
│   ├── CREW
│   └── EQUIPMENT
│
├── SCHEDULE
│   ├── BASELINE
│   ├── FORECAST
│   └── DAILY PLAN
│
├── DAILY REPORT
│   ├── ACTUAL QUANTITY
│   ├── MAN-HOURS
│   ├── MATERIAL USED
│   ├── PHOTO
│   └── ISSUE
│
├── COST
├── RFI
├── INSPECTION
├── NCR
├── CHANGE
└── RISK
```

---

# 65. Main End-to-End Workflow

```text
PROJECT CREATED
      ↓
PROJECT DATA
      ↓
DRAWINGS / DOCUMENTS UPLOADED
      ↓
DOCUMENT CLASSIFICATION
      ↓
DATA EXTRACTION
      ↓
USER / ENGINEER VALIDATION
      ↓
WBS CREATION
      ↓
QUANTITY TAKEOFF
      ↓
MATERIAL / LABOR / EQUIPMENT REQUIREMENT
      ↓
COST ESTIMATION
      ↓
DEPENDENCY
      ↓
CPM SCHEDULE
      ↓
RESOURCE ALLOCATION
      ↓
BASELINE APPROVAL
      ↓
DAILY / LOOKAHEAD PLAN
      ↓
SITE EXECUTION
      ↓
DAILY REPORT + PHOTO + ACTUAL DATA
      ↓
PLAN vs ACTUAL
      ↓
PRODUCTIVITY ANALYSIS
      ↓
SCHEDULE / COST FORECAST
      ↓
RISK / MATERIAL / DELAY ALERT
      ↓
RECOVERY OPTIONS
      ↓
ENGINEER / PM DECISION
      ↓
NEXT PLAN
      ↺
```

---

# 66. Хэрэглэгчээс зайлшгүй шаардлагатай эхний input

## Minimum Required

### A. Project
- Project Name
- Project Type
- Planned Start
- Target Finish
- Working Calendar

### B. Drawing
- Architectural PDF / IFC
- Structural PDF / IFC

### C. Quantity / Scope
- BOQ **эсвэл** quantity хийх боломжтой drawing

### D. Cost
- Material price
- Labor rate
- Equipment rate

### E. Planning
- Labor norm/productivity
- Available crew
- Main dependency

### F. Location
- Building
- Floor
- Zone

---

# 67. Хэрэглэгчээс байвал илүү сайн нэмэлт input

- MEP drawings
- Specification
- Geotechnical report
- Technical conditions
- Historical productivity
- Historical cost
- Material waste history
- Existing schedule
- MS Project / Primavera export
- Supplier data
- Lead time
- Inventory
- Method statement
- QA checklist
- Existing RFI
- Existing inspection history
- Existing risk register

---

# 68. Өдөр бүр авах хамгийн бага мэдээлэл

Хэрэглэгчийн өдөр тутмын ачааллыг бага байлгана.

Minimum:

1. Date
2. Activity
3. Location
4. Actual Quantity
5. Worker Count
6. Hours
7. Main Issue / Delay
8. Photo

Recommended:

9. Material Used
10. Equipment Used
11. Inspection Result
12. Weather

---

# 69. AI-аас хэт хамаарахгүй байх дүрэм

Систем дараах зүйлсийг зөвхөн AI guess дээр үндэслэн final болгохгүй.

- Structural safety decision
- Quantity approval
- Final contract budget
- Final schedule baseline
- Inspection pass/fail
- Change order
- Material substitution approval
- Safety-critical instruction

---

# 70. MVP Scope

Эхний хувилбарт бүх feature-г зэрэг хийх шаардлагагүй.

## MVP-1: Data + Planning Core

1. Project setup
2. PDF upload
3. Work Item / BOQ import
4. Material norm
5. Price catalog
6. Crew
7. Labor productivity
8. Quantity calculation
9. Material requirement
10. Cost estimate
11. Dependency
12. CPM
13. Basic schedule

## MVP-2: Site Progress

14. Daily plan
15. Daily report
16. Photo upload
17. Plan vs Actual
18. Productivity
19. Forecast finish
20. Delay alert

## MVP-3: Project Control

21. Inventory
22. Procurement forecast
23. Cost control
24. Change management
25. Drawing revision
26. RFI
27. QA/QC
28. NCR
29. Risk
30. Recovery plan

## MVP-4: Advanced Intelligence

31. IFC element extraction
32. Automated drawing comparison
33. Photo progress estimation
34. Historical productivity model
35. Resource optimization
36. Advanced cost/schedule prediction

---

# 71. Acceptance Criteria

Систем үндсэндээ дараах шалгуурыг хангаж байвал core workflow ажиллаж байна гэж үзнэ.

## AC-01
User project үүсгээд зураг / BOQ импортолж чадна.

## AC-02
Work Item болон quantity source-тойгоо хадгалагдана.

## AC-03
Approved quantity + material norm ашиглан material requirement зөв бодогдоно.

## AC-04
Waste factor өөрчилбөл material requirement дахин зөв бодогдоно.

## AC-05
Unit prices ашиглан cost estimate гарна.

## AC-06
Labor norm + crew capacity ашиглан duration гарна.

## AC-07
Dependency graph cycle-гүй үед CPM зөв ажиллана.

## AC-08
Critical path тодорхойлогдоно.

## AC-09
Resource conflict илэрвэл warning өгнө.

## AC-10
Daily plan baseline schedule-тай холбоотой байна.

## AC-11
Daily report plan-тай харьцуулагдана.

## AC-12
Productivity actual man-hour дээр бодогдоно.

## AC-13
Remaining quantity + forecast productivity ашиглан finish forecast шинэчлэгдэнэ.

## AC-14
Material stock хүрэлцэхгүй бол shortage alert гарна.

## AC-15
Approved baseline actual progress-оос болж overwrite болохгүй.

## AC-16
Drawing шинэ revision орж ирэхэд хуучин revision superseded болно.

## AC-17
AI-generated critical information engineer approval шаардана.

## AC-18
Calculation result бүр source болон formula trace харуулна.

---

# 72. Төслийн гол value proposition

Системийн үнэ цэнэ нь зөвхөн нэг удаагийн төсөв эсвэл schedule гаргахад биш.

Гол loop нь:

```text
DESIGN
  ↓
QUANTITY
  ↓
MATERIAL
  ↓
COST
  ↓
SCHEDULE
  ↓
DAILY PLAN
  ↓
SITE EXECUTION
  ↓
ACTUAL DATA
  ↓
PLAN vs ACTUAL
  ↓
PRODUCTIVITY
  ↓
FORECAST
  ↓
RISK / RECOVERY
  ↓
UPDATED NEXT PLAN
  ↺
```

Ингэснээр систем барилгын явцын турш тасралтгүй шинэчлэгддэг **Project Planning & Control System** болно.

---

# 73. Эцсийн системийн гаргах үндсэн үр дүн

Хэрэглэгч дараах асуултад системээс тоон үндэслэлтэй хариулт авч чаддаг байна.

- Барилгад ямар материал хэдий хэмжээтэй хэрэгтэй вэ?
- Ямар материал хэдийд хэрэг болох вэ?
- Одоо байгаа нөөц хүрэлцэх үү?
- Нийт төсөв хэд вэ?
- Нэг work package-ийн төсөв хэд вэ?
- Төсөв хэтрэх эрсдэл байгаа юу?
- Ямар ажлыг ямар дарааллаар хийх вэ?
- Аль ажлууд critical path дээр байна?
- Төсөл хэдийд дуусах төлөвтэй вэ?
- Өнөөдөр ямар ажил хийх ёстой вэ?
- Аль crew ямар ажил хийх вэ?
- Хэдэн хүн, хэдэн цаг шаардагдах вэ?
- Өнөөдрийн төлөвлөгөө биелсэн үү?
- Ажилчдын бодит бүтээмж ямар байна?
- Төлөвлөсөн бүтээмжээс хэдэн хувь зөрөв?
- Энэ хурдаар явбал хугацаандаа амжих уу?
- Ямар ажил хоцролт үүсгэж байна?
- Хоцролтыг нөхөх ямар хувилбар байна?
- Нэмэлт crew авахад хэдэн өдөр хэмнэх вэ?
- Нэмэлт нөөцийн өртөг хэд вэ?
- Ямар материалын shortage ойртож байна?
- Ямар drawing revision одоогийн approved хувилбар вэ?
- Ямар RFI, inspection, NCR шийдэгдээгүй байна?
- Project Manager өнөөдөр ямар шийдвэрүүдийг түрүүлж гаргах хэрэгтэй вэ?

---

# 74. Дүгнэлт

Энэхүү системийг барилгын зураг төсөл уншдаг AI чатбот байдлаар биш, дараах гурван үндсэн давхаргатайгаар хөгжүүлэх шаардлагатай.

```text
1. DATA LAYER
   Drawings, BOQ, Cost, Resource, Actual Data

2. CALCULATION & CONTROL LAYER
   Quantity, Material, Cost, CPM, Productivity, Forecast

3. AI ASSISTANCE LAYER
   Extraction, Classification, Explanation, Photo Analysis,
   Document Search, Report Drafting
```

Хамгийн чухал нь:

```text
AI proposes.
Calculation engine computes.
Engineer validates.
System tracks.
```

гэсэн зарчмыг бүх системд мөрдөнө.

Ингэснээр систем нь барилгын инженер, талбайн инженер, тоо хэмжээний инженер, planner болон project manager-ийн давтагддаг ажлыг багасгаж, төслийн тоон мэдээлэлд тулгуурласан шийдвэр гаргалтыг хурдан, хяналттай, мөрдөх боломжтой болгоно.
