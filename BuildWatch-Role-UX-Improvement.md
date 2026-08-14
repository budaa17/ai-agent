# BuildWatch — Role & UX Сайжруулалтын Санал

**Огноо:** 2026-08-08  
**Зориулалт:** BuildWatch системийн role-based UX, navigation, ownership болон approval flow-ийг илүү цэвэр, ойлгомжтой болгох санал.

---

## 1. Ерөнхий дүгнэлт

Одоогийн BuildWatch-ийн role бүтэц сайн суурьтай боловч backend permission-ийг frontend UI/navigation руу хэт шууд буулгасан хэсгүүд байна.

Үүний улмаас:

- Role бүрт хэт олон ижил дэлгэц харагдаж байна.
- Зарим ажил 2 өөр role дээр давхардаж байна.
- Зарим өгөгдлийн жинхэнэ эзэн тодорхойгүй байна.
- A0–A5 гэсэн техникийн нэр frontend дээр хэт давамгай байна.
- Хэрэглэгчид өөрт хэрэггүй мэдээлэл, workflow харах эрсдэлтэй.
- Permission байгаа гэдэг нь тухайн role-д тэр дэлгэц үндсэн navigation-д заавал харагдах ёстой гэсэн үг биш.

### Гол зарчим

Backend:

```text
Role
 ↓
Permission
 ↓
A0 / A1 / A2 / A3 / A4 / A5
```

Frontend:

```text
Role
 ↓
Тухайн хүний өдөр тутмын хийх ажил
```

байх нь зөв.

---

# 2. ENGINEER ба SITE_SUPERVISOR-ийн давхардлыг арилгах

Одоогийн бүтэц дээр ENGINEER болон SITE_SUPERVISOR хоёул өдрийн тайлантай холбоотой өгөгдөл оруулах боломжтой.

Энэ нь ownership-ийг бүдгэрүүлж байна.

## SITE_SUPERVISOR

SITE_SUPERVISOR-ийн үндсэн үүрэг:

- Өглөө өдрийн даалгавраа харах
- Гүйцэтгэл оруулах
- Ажилчдын ирц бүртгэх
- Фото зураг оруулах
- Саатал, асуудал тэмдэглэх
- Материалын бодит хэрэглээ бүртгэх
- Өдрийн тайлбар оруулах
- Өдрийн тайлан илгээх

### Гол асуулт

> Өнөөдөр юу хийсэн бэ?

---

## ENGINEER / PTO

ENGINEER дахин тайлан бичих шаардлагагүй.

ENGINEER-ийн үүрэг:

- Supervisor-ийн тайланг шалгах
- Тоо хэмжээтэй тулгах
- Зурагтай тулгах
- Төлөвлөгөөтэй тулгах
- Материалын хэрэглээтэй тулгах
- Мэдүүлсэн гүйцэтгэлийг баталгаажуулах
- Зөрүү илрүүлэх
- UNVERIFIABLE тохиолдлыг шалгах

### Гол асуулт

> Мэдүүлсэн гүйцэтгэл техникийн хувьд үнэн зөв үү?

---

## Зөв ownership

```text
SITE_SUPERVISOR
    ↓
Daily Report
    ↓
ENGINEER
    ↓
Progress Verification
    ↓
PROJECT_MANAGER
    ↓
Approve / Apply
```

Ингэснээр:

```text
Supervisor = юу болсон гэж мэдүүлэх

Engineer = үнэхээр тийм болсон эсэхийг шалгах
```

гэсэн маш тодорхой ялгаа үүснэ.

---

# 3. A0–A5 navigation-ийг хэрэглэгчид шууд харуулахгүй байх

A0, A1, A2, A3, A4, A5 нь backend болон agent architecture-д хэрэгтэй нэршил.

Гэхдээ хэрэглэгчийн үндсэн navigation ийм байх шаардлагагүй.

Жишээ нь SITE_SUPERVISOR:

```text
A0
A1
A3
A4
A5
```

гэсэн menu харахаас илүү:

```text
Өнөөдөр
Тайлан
Материал
Баримт
Анхааруулга
```

гэсэн menu харах нь илүү ойлгомжтой.

---

# 4. COMPANY_ADMIN

## Үндсэн зорилго

Компанийн түвшний системийн тохиргоо, хэрэглэгч, төсөл, лавлах өгөгдлийг удирдах.

### Гол асуулт

> Системийг ажиллах нөхцөлөөр хэрхэн хангах вэ?

---

## Санал болгох navigation

```text
Нүүр
Төслүүд
Хэрэглэгчид
Лавлах өгөгдөл
  ├─ Материал
  ├─ Ажлын норм
  ├─ Бүтээмж
  └─ Үнийн каталог
Дүрэм
Аудит
Компанийн тохиргоо
```

---

## Үндсэн ажиллагаа

- Төсөл үүсгэх
- Хэрэглэгч урих
- Role оноох
- Project membership удирдах
- Материалын каталог импортлох
- Ажлын норм импортлох
- Бүтээмжийн норм импортлох
- Үнийн каталог импортлох
- Бизнес дүрэм удирдах
- Audit log харах

---

## Өдөр тутмын project workflow-оос холдуулах

COMPANY_ADMIN-ийн үндсэн sidebar дээр дараах зүйлс заавал байх шаардлагагүй:

- Өдрийн тайлан
- Gantt editing
- Element review
- Өдрийн task execution
- Site photo workflow

Шаардлагатай үед project руу drill-down хийж харж болно.

---

# 5. SUPER_ADMIN ба COMPANY_ADMIN-ийг салгах

SUPER_ADMIN болон COMPANY_ADMIN-ийг нэг role мэт авч үзэх нь SaaS системд цаашдаа асуудал үүсгэнэ.

## SUPER_ADMIN

BuildWatch платформын өөрийн админ.

### Navigation

```text
Tenants
Subscriptions
System Health
Feature Flags
Support
Global Audit
Platform Settings
```

### Үүрэг

- Tenant удирдах
- Subscription удирдах
- System monitoring
- Feature flag
- Support
- Global audit
- Platform configuration

SUPER_ADMIN нь хэрэглэгч компанийн өдөр тутмын estimate, daily report зэрэг operational approval хийх үндсэн role биш байна.

---

## COMPANY_ADMIN

Барилгын компанийн админ.

### Navigation

```text
Users
Projects
Roles
Catalogs
Rules
Company Settings
Audit
```

---

# 6. PROJECT_MANAGER

## Үндсэн зорилго

Шийдвэр гаргах.

### Гол асуулт

> Юуг одоо шийдэх хэрэгтэй вэ?

---

## Санал болгох navigation

```text
Нүүр
Миний шийдвэрүүд
Төслийн явц
Хуваарь
Төсөв
Эрсдэл
Тайлан
Баримт бичиг
```

---

## PM Dashboard

```text
Өнөөдөр шийдэх        4
Хоцорч буй ажил       3
Материалын эрсдэл     2
Төсвийн хазайлт       +4.2%
Хугацааны прогноз     +6 өдөр
```

PM-ийн dashboard-ийн гол зорилго нь мэдээлэл харуулах биш, шийдвэр гаргахад туслах байх ёстой.

---

## PM-ийн үндсэн workflow

PM дараах зүйлсийг:

- Батлах
- Татгалзах
- Хэрэгжүүлэх
- Recovery scenario сонгох
- Risk шийдэх
- Төсөв батлах
- Тайлан батлах
- Baseline хэрэгжүүлэх

---

# 7. ENGINEER / PTO

## Үндсэн зорилго

Зураг төсөл, тоо хэмжээ, техникийн зөв эсэхийг шалгах.

### Гол асуулт

> Техникийн хувьд зөв үү?

---

## Санал болгох navigation

```text
Нүүр
Зураг төсөл
Тоо хэмжээ
WBS / Ажлын бүтэц
Хуваарь
Гүйцэтгэл баталгаажуулах
Баримт бичиг
```

---

## Engineer Dashboard

```text
Шалгах элемент        23
Confidence < 80%       7
Батлах Quantity        2
Зөрүүтэй гүйцэтгэл     4
```

---

## ENGINEER-ийн үндсэн ажиллагаа

- Зураг төсөл upload
- Масштаб баталгаажуулах
- AI илрүүлсэн element шалгах
- Element → workCode mapping
- Quantity takeoff шалгах
- Schedule technical review
- Progress verification
- Drawing revision review

---

## ENGINEER-ээс хасах ажиллагаа

ENGINEER дараах зүйлсийг дахин оруулах шаардлагагүй:

- Daily report бичих
- Attendance бүртгэх
- Site photo report үүсгэх
- Supervisor-ийн гүйцэтгэлийг дахин гараар оруулах

---

# 8. SITE_SUPERVISOR

## Үндсэн зорилго

Өдрийн ажлыг гүйцэтгэж, бодит явцыг бүртгэх.

### Гол асуулт

> Өнөөдөр юу хийх вэ, юу хийсэн бэ?

---

## Санал болгох navigation

```text
Өнөөдөр
Тайлан
Материал
Баримт
Анхааруулга
```

Ердөө 5 үндсэн navigation байхад хангалттай.

---

## Landing page

```text
08 AUG

Өнөөдрийн ажил
────────────────

☐ W-014 Өрлөг
   Төлөвлөгөө: 35 м²
   Баг: Өрлөг-02
   Материал: Бэлэн

☐ W-021 Шал
   Төлөвлөгөө: 80 м²
   ⚠ Цемент 12 уут дутуу


[ + Зураг авах ]

[ Өдрийн тайлан бөглөх ]
```

---

## Supervisor UX зарчим

### 1. Mobile-first

Талбай дээр утсаар ашиглана.

### 2. One-handed interaction

Товч:

- Том
- Доод хэсэгт
- Нэг гараар хүрэхэд хялбар

### 3. Гар шивэлт хамгийн бага

Өглөөний төлөвлөгөөнөөс автоматаар бөглөнө.

Supervisor зөвхөн:

- actual quantity
- status
- зураг
- тайлбар

зэрэг өөрчлөгдсөн зүйлсийг оруулна.

### 4. Offline-first

```text
Offline
↓
Local Queue
↓
Connection available
↓
Sync
```

UI дээр:

```text
3 тайлан sync хүлээж байна
```

гэх мэт харагдана.

---

# 9. STOREKEEPER

Одоогийн role дундаас хамгийн их өөрчлөлт шаардлагатай хэсэг.

## Үндсэн зорилго

Материалын бодит хөдөлгөөн болон үлдэгдлийг удирдах.

### Гол асуулт

> Материал хаана, хэд байна?

---

## Санал болгох navigation

```text
Үлдэгдэл
Орлого
Зарлага
Шилжүүлэг
Хөдөлгөөний түүх
Дутагдал
```

---

## Landing page

```text
Материалын үлдэгдэл

Цемент М400
Available     240
Reserved       80
Free          160

────────────────

⚠ 3 материал дуусах эрсдэлтэй

Арматур Ø12
Хэрэгцээ: 4.2т
Бэлэн:    2.9т
Дутуу:    1.3т

[ Орлого ]   [ Зарлага ]
```

---

## Storekeeper-ийн үндсэн ажиллагаа

- Receipt
- Issue
- Transfer
- Adjustment
- Reversal
- Inventory balance
- Shortage detection
- Daily plan-д материал олгох

---

## StockMovement

Append-only зарчим хэвээр байна.

Иймээс:

```text
❌ Устгах

✅ Залруулах
```

байна.

Залруулах үед:

```text
Original Movement
       ↓
REVERSAL
       ↓
Corrected Movement
```

үүснэ.

---

# 10. OBSERVER

## Үндсэн зорилго

Төслийн батлагдсан явцыг хянах.

### Гол асуулт

> Төсөл төлөвлөгөөний дагуу явж байна уу?

---

## Санал болгох navigation

```text
Нүүр
Явц
Milestone
Батлагдсан төсөв
Батлагдсан хуваарь
Фото тайлан
Баримт бичиг
Тайлан татах
```

---

## Observer-д харуулах мэдээлэл

Үндсэндээ:

```text
APPROVED
APPLIED
```

төрлийн мэдээлэл.

---

## Observer-д харуулахгүй мэдээлэл

```text
DRAFT
REVIEW_REQUIRED
Internal recovery proposal
Internal comments
Operational chat
Unapproved estimate
Unapproved schedule
```

Observer role нь stakeholder-facing view байх нь илүү зөв.

---

# 11. A2 нэршлийг өөрчлөх

Одоогийн нэршилд A2 нь зарим хэсэгт forecast/risk workflow мэт ашиглагдаж байгаа атлаа зарим хүснэгтэд:

```text
A2 · Ажиглагч
```

гэж нэрлэгдсэн байна.

OBSERVER гэсэн role аль хэдийн байгаа тул нэршил будлиан үүсгэнэ.

## Санал

```text
A2 · Прогноз ба эрсдэл
```

эсвэл frontend дээр бүр A2-г харуулахгүй:

```text
Прогноз
Эрсдэл
Recovery
```

гэсэн хэрэглэгчийн хэлээр харуулах.

---

# 12. Four-eyes workflow-ийн асуудал

Одоогийн дүрэм:

```text
Creator өөрөө approve хийж болохгүй
```

мөн:

```text
ReviewTask.assignedRole == user.role
```

байх шаардлагатай.

Энэ нь жижиг төсөл дээр workflow гацах эрсдэлтэй.

---

## Жишээ

```text
Quantity Takeoff

Creator:
Engineer A

Assigned Role:
ENGINEER
```

Төсөл дээр ганц Engineer байвал:

```text
Engineer A created it
↓
Engineer A cannot approve it
↓
No other ENGINEER exists
↓
Workflow blocked
```

---

# 13. Reviewer assignment нэмэх

Role-based approval-аас гадна хүнээр assignment хийх хэрэгтэй.

## Санал болгох бүтэц

```text
Prepared By
Reviewed By
Approved By
Applied By
```

---

## Жишээ

```text
Quantity Takeoff

Prepared by:
Bat - Engineer

Reviewed by:
Dorj - Senior Engineer

Approved by:
Project Manager

Applied by:
Project Manager
```

---

## ReviewTask

Дараах бүтэцтэй байж болно:

```text
assignedRole
assignedUserId
reviewType
dueAt
priority
```

`assignedUserId` optional байж болно.

---

# 14. COMPANY_ADMIN approval эрхийг operational UI дээр багасгах

COMPANY_ADMIN backend дээр emergency эрхтэй байж болно.

Гэхдээ өдөр тутмын operational workflow-д:

```text
Approve Daily Report
Approve Estimate
Approve Progress
```

гэсэн үндсэн товч байнга харагдах шаардлагагүй.

---

## Emergency Override

UI дээр тусдаа:

```text
⋯
Emergency Override
```

байх.

Дарахад:

```text
⚠ Emergency Override

Энэ үйлдэл стандарт approval flow-ийг алгасана.
Audit log-д бүртгэгдэнэ.

Reason:
[________________________]

[ Cancel ] [ Override ]
```

---

# 15. Эцсийн санал болгох role бүтэц

| Role | Гол асуулт |
|---|---|
| Company Admin | Системийг яаж тохируулах вэ? |
| Project Manager | Юуг одоо шийдэх хэрэгтэй вэ? |
| Engineer / PTO | Техникийн хувьд зөв үү? |
| Site Supervisor | Өнөөдөр юу хийх, юу хийсэн бэ? |
| Storekeeper | Материал хаана, хэд байна? |
| Observer | Төсөл төлөвлөгөөний дагуу явж байна уу? |

---

# 16. Artifact Ownership Matrix

Нэг өгөгдөл нэг үндсэн owner-той байх зарчим ашиглана.

| Өгөгдөл | Үүсгэх | Шалгах | Эцсийн шийдвэр |
|---|---|---|---|
| Зураг төсөл | Engineer | Engineer Reviewer | PM |
| Quantity | AI + Engineer | Engineer | PM |
| Estimate | System | Engineer / Cost | PM |
| Schedule | System + Engineer | Engineer | PM |
| Daily Plan | System / PM | Supervisor | PM |
| Daily Report | Supervisor | Engineer | PM |
| Progress | System | Engineer | PM |
| Material Movement | Storekeeper | System | — |
| Forecast | AI | PM | PM |
| Recovery Plan | AI + PM | Engineer | PM |

---

# 17. Approval Flow

Санал болгох ерөнхий flow:

```text
DRAFT
  ↓
SUBMITTED
  ↓
REVIEW_REQUIRED
  ↓
APPROVED
  ↓
APPLIED
```

Хэн юу хийх нь тодорхой байна.

```text
Creator
   ↓
Reviewer
   ↓
Approver
   ↓
Applier
```

---

# 18. Role бүрийн Landing Page

## Company Admin

```text
3 шинэ хэрэглэгч
2 импортын алдаа
1 rule draft
6 active project
```

---

## Project Manager

```text
4 шийдвэр хүлээж байна
3 ажил хоцорч байна
2 материалын эрсдэл
+6 өдөр forecast delay
```

---

## Engineer

```text
23 element шалгах
7 low confidence
2 quantity approve
4 progress discrepancy
```

---

## Site Supervisor

```text
5 ажил өнөөдөр
2 ажил эхлээгүй
1 материалын асуудал

[ Зураг авах ]
[ Тайлан бөглөх ]
```

---

## Storekeeper

```text
7 материал өнөөдөр олгоно
3 shortage
2 incoming delivery
```

---

## Observer

```text
Project progress      46.2%
Planned               49.5%
Variance              -3.3%

Forecast delay        3 days
```

---

# 19. Navigation design-ийн гол дүрэм

Permission байгаа бүх page-ийг sidebar дээр харуулахгүй.

## Backend

```text
Can this user access this resource?
```

гэсэн асуулт шийднэ.

## Frontend

```text
Does this user need this screen to do their job?
```

гэсэн асуулт шийднэ.

Эдгээр нь тусдаа ойлголт.

---

# 20. Миний хамгийн их санал болгох өөрчлөлт

Одоогийн UX:

```text
Role
 ↓
A0
A1
A2
A3
A4
A5
```

Санал болгох UX:

```text
Role
 ↓
Job-to-be-done
```

---

## SITE_SUPERVISOR

```text
Өнөөдөр хийх 5 ажил байна.
```

---

## ENGINEER

```text
Танд шалгах 8 зүйл байна.
```

---

## PROJECT_MANAGER

```text
Таны шийдвэр хүлээж буй 4 зүйл байна.
```

---

## STOREKEEPER

```text
Өнөөдөр олгох 7 материал байна.
```

---

## OBSERVER

```text
Төсөл 46.2% гүйцэтгэлтэй.
Төлөвлөгөөнөөс 3 өдөр хоцорч байна.
```

---

# 21. Эцсийн зорилго

BuildWatch нь:

```text
Construction Dashboard
```

байхаас илүү:

```text
Role-driven Construction Operating System
```

болох боломжтой.

Үүний тулд:

1. Role бүрийн үндсэн ажлыг нэг өгүүлбэрээр тодорхойлох.
2. Нэг artifact-д нэг owner оноох.
3. Permission болон navigation-ийг салгах.
4. A0–A5 нэрийг frontend дээр багасгах.
5. Landing page-ийг role бүрийн ажлын queue болгох.
6. Supervisor болон Storekeeper-ийг mobile-first болгох.
7. PM-ийн dashboard-ийг decision-first болгох.
8. Engineer-ийн workflow-ийг verification-first болгох.
9. Observer-д зөвхөн stakeholder-facing мэдээлэл харуулах.
10. SUPER_ADMIN ба COMPANY_ADMIN-ийг салгах.
11. Four-eyes workflow-д user-level assignment нэмэх.
12. Approval болон Apply хоёрын ялгааг UI дээр тодорхой байлгах.

---

# 22. Тэргүүлэх хэрэгжүүлэх дараалал

## Priority 1

Role ownership цэвэрлэх:

```text
Daily Report → Supervisor
Progress Verification → Engineer
Decision / Apply → PM
Inventory → Storekeeper
```

## Priority 2

Sidebar/navigation role бүрээр шинэчлэх.

## Priority 3

Role-specific landing pages.

## Priority 4

Storekeeper inventory UI.

## Priority 5

Engineer scale verification + element review UI.

## Priority 6

Observer-ийн stakeholder portal.

## Priority 7

Reviewer assignment / Four-eyes workflow сайжруулалт.

---

**Дүгнэлт:**  
BuildWatch-ийн backend permission model-ийг хэвээр хадгалж болно. Гол өөрчлөлт frontend UX дээр хийгдэх шаардлагатай. Хэрэглэгч role бүр системийн бүх capability-г харах биш, тухайн мөчид хийх ёстой ажлаа хамгийн түрүүнд харах ёстой.
