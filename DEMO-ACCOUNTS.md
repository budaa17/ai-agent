# BuildWatch — Демо хэрэглэгчийн данснууд

> **⚠️ Зөвхөн хөгжүүлэлт/демонстрацид зориулав.** Доорх нууц үгс үүргийн нэрээс гаралтай,
> нууц биш. Production орчинд эдгээр дансыг **хэзээ ч** үүсгэж болохгүй.

**Огноо:** 2026-08-07
**Байгууллага:** Nomad Build LLC (`nomad-build`)
**Үүсгэсэн:** `pnpm run seed:demo:accounts` (`agents/src/scripts/seed-demo-accounts.ts`)

## Дансны жагсаалт

7 үүрэг тус бүрд нэг данс. Бүгд `ACTIVE` төлөвтэй, tenant-ийн бүх төсөлд гишүүнчлэлтэй.

| Үүрэг             | Имэйл                             | Нууц үг                           | Эрхийн тоо |
| ----------------- | --------------------------------- | --------------------------------- | ---------- |
| `SUPER_ADMIN`     | `super.admin@buildwatch.demo`     | `BuildWatch-SuperAdmin-2026!`     | 25         |
| `COMPANY_ADMIN`   | `company.admin@buildwatch.demo`   | `BuildWatch-CompanyAdmin-2026!`   | 25         |
| `PROJECT_MANAGER` | `project.manager@buildwatch.demo` | `BuildWatch-ProjectManager-2026!` | 21         |
| `ENGINEER`        | `engineer@buildwatch.demo`        | `BuildWatch-Engineer-2026!`       | 13         |
| `SITE_SUPERVISOR` | `site.supervisor@buildwatch.demo` | `BuildWatch-SiteSupervisor-2026!` | 11         |
| `STOREKEEPER`     | `storekeeper@buildwatch.demo`     | `BuildWatch-Storekeeper-2026!`    | 7          |
| `OBSERVER`        | `observer@buildwatch.demo`        | `BuildWatch-Observer-2026!`       | 9          |

Нэвтрэхдээ **зөвхөн имэйл, нууц үг** оруулна — байгууллагыг систем өөрөө олно.

Долоон дансыг бүгдийг нь ажиллаж буй API-аар нэвтрүүлж шалгасан: бүгд `200`, эрхийн
тоо дээрх хүснэгттэй яг таарсан, гурван төсөл харагдсан.

## Үүрэг тус бүр ямар хуудас харах вэ

Цэсний зүйл бүр эрхээр хаагдсан (`app-shell.tsx`). Энэ хүснэгтийг гараар биш,
`permissionsForRole`-оос тооцоолж гаргасан.

| Үүрэг             | Самбар | A0  | A1  | A2  | A3  | A4  | A5  | Alert | Админ | Дүрэм |
| ----------------- | :----: | :-: | :-: | :-: | :-: | :-: | :-: | :---: | :---: | :---: |
| `SUPER_ADMIN`     |   ✓    |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |   ✓   |   ✓   |   ✓   |
| `COMPANY_ADMIN`   |   ✓    |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |   ✓   |   ✓   |   ✓   |
| `PROJECT_MANAGER` |   ✓    |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |   ✓   |   ✗   |   ✗   |
| `ENGINEER`        |   ✓    |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |   ✓   |   ✗   |   ✗   |
| `SITE_SUPERVISOR` |   ✓    |  ✓  |  ✓  |  ✗  |  ✓  |  ✓  |  ✓  |   ✓   |   ✗   |   ✗   |
| `STOREKEEPER`     |   ✓    |  ✗  |  ✓  |  ✗  |  ✓  |  ✗  |  ✓  |   ✓   |   ✗   |   ✗   |
| `OBSERVER`        |   ✓    |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |  ✓  |   ✓   |   ✗   |   ✗   |

Цэс харагдах нь тухайн хуудсан дээр бүх зүйл хийж чадна гэсэн үг **биш**. Жишээ нь
`OBSERVER` бүх хуудсыг үзнэ ч юу ч илгээж, батлаж чадахгүй.

## Гол ялгаанууд

Ижил хуудсыг хардаг хүмүүсийн хооронд юу ялгаатайг харуулав:

| Чадвар                                            | Хэн эзэмших вэ                                    |
| ------------------------------------------------- | ------------------------------------------------- |
| Хэрэглэгч урих, tenant удирдах                    | `SUPER_ADMIN`, `COMPANY_ADMIN`                    |
| Дүрмийн засварлагч (`RULES_MANAGE`)               | `SUPER_ADMIN`, `COMPANY_ADMIN`                    |
| Батлагдсан командыг хэрэгжүүлэх (`COMMAND_APPLY`) | `SUPER_ADMIN`, `COMPANY_ADMIN`, `PROJECT_MANAGER` |
| Төсөв, төлөвлөгөө, тайлан, баталгаажуулалт батлах | `SUPER_ADMIN`, `COMPANY_ADMIN`, `PROJECT_MANAGER` |
| Зураг төслийг батлах (`DESIGN_APPROVE`)           | дээрх гурав + `ENGINEER`                          |
| Аудитын бүртгэл унших                             | `SUPER_ADMIN`, `COMPANY_ADMIN`, `PROJECT_MANAGER` |
| Өдрийн тайлан илгээх (`REPORT_SUBMIT`)            | дээрх гурав + `ENGINEER`, `SITE_SUPERVISOR`       |
| Агент ажиллуулах (`AGENT_RUN`)                    | `STOREKEEPER` болон `OBSERVER`-оос бусад          |
| Файл хуулах (`ARTIFACT_UPLOAD`)                   | `OBSERVER`-оос бусад                              |
| Агуулахын бичилт (`INVENTORY_WRITE`)              | `SUPER_ADMIN`, `COMPANY_ADMIN`, `STOREKEEPER`     |
| Прогноз үзэх (`FORECAST_READ`)                    | `SITE_SUPERVISOR`, `STOREKEEPER`-оос бусад        |
| Чат лавлагаа (`CHAT_READ`)                        | `STOREKEEPER`-оос бусад                           |

**Хамгаалалт дээр үзүүлэхэд тохиромжтой хос:** `SITE_SUPERVISOR`-оор нэвтрэхэд A2
(Ажиглагч) цэснээс алга болно, `STOREKEEPER`-оор нэвтрэхэд A0 болон A4 хоёул алга болно.
RBAC зөвхөн UI дээр биш, backend дээр ч хэрэгждэгийг харуулах хамгийн хурдан арга.

## Дахин үүсгэх

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd run seed:demo:accounts
```

Идэмпотент — дахин ажиллуулахад данс давхардахгүй, зөвхөн нууц үг/үүрэг/гишүүнчлэлийг
шинэчилж, идэвхтэй session-уудыг цуцална. Сонголтууд:

```powershell
pnpm.cmd run seed:demo:accounts -- --tenant steppe-labs --domain example.test
pnpm.cmd run seed:demo:accounts -- --help
```

Өгөгдлийн сан цоо шинэ бол эхлээд `pnpm.cmd seed` ажиллуулж tenant/төслүүдийг үүсгэнэ.

## Бусад данс

Эдгээр нь энэ script-ээс биш, өмнөх ажлаас үлдсэн:

| Имэйл                         | Үүрэг             | Тэмдэглэл                                                                                                                    |
| ----------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `admin@gmail.com`             | `COMPANY_ADMIN`   | `.env`-ийн bootstrap данс. **Nomad Build болон Steppe Labs хоёуланд** байгаа тул нэвтрэхэд байгууллага сонгох алхмыг үзүүлнэ |
| `admin@buildwatch.mn`         | `COMPANY_ADMIN`   | Нөөц админ (`BuildWatch2026Admin!`)                                                                                          |
| `saruulaaasaruul47@gmail.com` | `PROJECT_MANAGER` | Таны өөрөө урьсан хэрэглэгч                                                                                                  |

## Аюулгүй байдлын тэмдэглэл

- Нууц үг бүр 12-оос дээш тэмдэгттэй (системийн бодлого), scrypt-ээр хэшлэгдэнэ
- Script нь `AuditLog`-д `DEMO_ACCOUNT_SEEDED` бичилт үлдээдэг тул эдгээр данс хаанаас
  гарсан нь дараа нь тодорхой байна
- `SUPER_ADMIN` ч гэсэн нэг tenant-д харьяалагдана — энэ систем cross-tenant super
  хэрэглэгчгүй, tenant тусгаарлалт үүнээс дээгүүр
- Демог дуусгасны дараа эдгээр дансыг устгах:
  ```sql
  DELETE FROM "User" WHERE "emailNormalized" LIKE '%@buildwatch.demo';
  ```
  (`ProjectMember`, `UserCredential` нь cascade-аар хамт устана)
