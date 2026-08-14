# A1. Бүртгэлийн агент

## Зорилго

A1 агент нь хэрэглэгчийн оруулсан чөлөөт бичвэр болон зураг дээрх төслийн мэдээллийг уншиж, стандарт бүтэцтэй хяналтын ноорог болгоно.

A1-ийн гаралт шууд `Project` эсвэл `WorkItem` хүснэгтийг өөрчлөхгүй. Бүх үр дүн эхлээд `RegistrationDraft` хэлбэрээр хадгалагдаж, хүн шалгах зориулалттай байна.

## Боломжууд

- Монгол, англи болон холимог хэлтэй бичвэр боловсруулна.
- PNG, JPEG, WEBP, GIF зураг дээрх харагдах мэдээллийг OpenAI vision ашиглан уншина.
- Бичвэр болон зургийг хамтад нь нэг оролт болгон боловсруулж чадна.
- Төслийн код, ажлын код, нэр, төлөв, явц, огноо, төсөв, зардал зэрэг утгыг стандарт талбаруудад хөрвүүлнэ.
- Ажлын нэрийн Монгол хэлний тийн ялгал болон `ажил`, `төсөв`, `бодит зардал` зэрэг контекст үгийг deterministic дүрмээр цэвэрлэнэ.
- Model төлөвийг орхисон үед одоогийн явц `1–99%` бол `IN_PROGRESS`, `100%` бол `COMPLETED` гэж нөхнө.
- `$`, `USD`, `EUR` зэрэг гадаад валютыг MNT хөрвүүлэлтгүй үед `budgetMnt`, `actualCostMnt`, `ledgerTotalMnt` талбарт буруу бичихгүй, warning гаргана.
- Хугацаа хэтрэлт, явц зогсолт, хамаарлын зөрчил, төсөв хэтрэлт, ledger зөрүүг ангилна.
- Олдсон талбар бүрд `0–1` хооронд confidence оноо болон нотолгоо гаргана.
- TypeScript дүрмээр огноо, төлөв, явц, төсөв, зардлын логик нийцлийг дахин шалгана.
- Үр дүнг PostgreSQL-д хяналтын ноорог болгон хадгална.
- `pg-boss` queue ашиглан өгөгдөл орж ирэх үед event хэлбэрээр автоматаар ажиллаж чадна.

## Ажиллах дараалал

1. Хэрэглэгч бичвэр, зураг эсвэл хоёуланг нь оруулна.
2. Оролтын төрөл, хэмжээ, зургийн формат, dimension, frame болон checksum-ийг шалгана.
3. Зургийг EXIF orientation-аар зөв эргүүлж, 2048px дотор resize/compress хийн, metadata-г арилган normalized checksum/provenance үүсгэнэ.
4. OpenAI model мэдээллийг бүтэцтэй JSON болгон ялгана.
5. Код, хэл, нэр, төлөв болон issue төрлүүдийг deterministic дүрмээр стандарт хэлбэрт оруулна.
6. Deterministic дүрмүүдээр логик зөрчил байгаа эсэхийг шалгана.
7. Confidence оноог validation үр дүнтэй нэгтгэнэ.
8. `READY_FOR_REVIEW` эсвэл `NEEDS_CORRECTION` төлөвтэй ноорог үүсгэнэ.
9. Persistence идэвхтэй бол нооргийг `RegistrationDraft` хүснэгтэд хадгална.

## Шаардлагатай тохиргоо

`.env` файлд дараах утгууд хэрэгтэй:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5434/diplom_agents?schema=public"
OPENAI_API_KEY="өөрийн шинэ API key"
A1_OPENAI_MODEL="gpt-5.6-luna"
A1_TENANT_ID="tenant-demo"
A1_PROJECT="project-atlas"
A1_PERSIST="true"
```

API key-г `.env.example`, source code эсвэл Git repository дотор хийж болохгүй.

## Шууд ажиллуулах

### DailyReportDraft review урсгал — санал болгох command

Текст, зураг эсвэл хоёуланг нь Phase 1-ийн human-review store-д нэг төрлийн `DailyReportDraft` болгон оруулна:

```powershell
cd C:\Users\user\Desktop\diplom\agents

# Текст
pnpm.cmd agent:a1:intake -- --text "2026-03-30-нд BW-017 ажил 69 хувь болсон." --reference-date 2026-03-30 --request-id report-001

# Зураг
pnpm.cmd agent:a1:intake -- --image "C:\path\daily-report.png" --reference-date 2026-03-30 --request-id report-002

# Текст + олон зураг
pnpm.cmd agent:a1:intake -- --text "2026-03-30-ны талбайн тайлан" --image "C:\path\form.png" --image "C:\path\site.jpg" --reference-date 2026-03-30 --request-id report-003
```

`--image`-ийг хамгийн ихдээ 5 удаа ашиглана. Нэг source зураг 10 MB, 40 мегапиксел, аль нэг тал нь 20,000 пикселээс хэтрэхгүй бөгөөд animated/multi-frame байж болохгүй. PNG/JPEG/WEBP/GIF magic byte, dimension, JPEG/PNG/WebP EXIF orientation metadata болон checksum нь model call-аас өмнө шалгагдана. Дараа нь EXIF auto-orient, 2048px inside resize, no-enlargement, format-aware compression болон metadata strip хийгдэнэ; static GIF normalized PNG болно. Model, queue, database/review store-д transformed checksum ба source/output provenance дамжина. Draft болон normalized зураг нь default-аар `data/a1-review/` дотор хадгалагдана. Дараа нь:

```powershell
pnpm.cmd agent:a1:drafts
pnpm.cmd agent:a1:show -- --draft <draft-id>
pnpm.cmd agent:a1:approve -- --draft <draft-id> --reviewer user-manager
```

Зураг дээрх construction cue, safety advisory, delivery candidate нь `advisoryOnly: true` байна. Хүн батлаагүй үед үндсэн project data-г өөрчлөхгүй.

### Legacy single ProjectUpdate урсгал

### Бичвэр боловсруулах

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd structure -- --text "AT-001 ажил 100 хувь дууссан" --project project-atlas
```

### Зураг боловсруулах

```powershell
pnpm.cmd structure -- --image C:\path\to\update.png --project project-atlas
```

Дэмжих зургийн формат:

- PNG
- JPEG/JPG
- WEBP
- GIF

Зургийн дээд хэмжээ `10 MB`.

### Бичвэр болон зураг хамтад нь боловсруулах

```powershell
pnpm.cmd structure -- --text "2026-03-01-ний тайлан" --image C:\path\to\update.png --project project-atlas
```

### DB-д хадгалахгүй турших

```powershell
pnpm.cmd structure -- --text "AT-001 ажил дууссан" --no-persist
```

`--no-persist` ашигласан үед үр дүн terminal дээр харагдах боловч `RegistrationDraft` хүснэгтэд хадгалагдахгүй.

## Event хэлбэрээр автоматаар ажиллуулах

Эхний terminal дээр worker-ийг асаана:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd a1:worker
```

Хоёр дахь terminal дээр шинэ оролтын event илгээнэ:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd a1:intake -- --text "AT-001 ажил 100 хувь дууссан" --project project-atlas
```

Энэ урсгалд:

1. `pg-boss` event-ийг PostgreSQL queue-д хадгална.
2. A1 worker event-ийг авна.
3. OpenAI extraction, confidence болон validation ажиллана.
4. Үр дүн `RegistrationDraft` хүснэгтэд хадгалагдана.

Event бүрийн `requestId` нь idempotency key болно. Нэг event дахин ажилласан ч амжилттай үүссэн ноорог давхардахгүй.

## Гаралтын тайлбар

- `update`: ялгаж авсан бүтэцтэй төслийн мэдээлэл.
- `confidence.overall`: нийт итгэлцлийн оноо.
- `confidence.level`: `HIGH`, `MEDIUM`, эсвэл `LOW`.
- `confidence.fields`: талбар тус бүрийн оноо болон нотолгоо.
- `validation.valid`: deterministic шалгалт амжилттай эсэх.
- `validation.issues`: илэрсэн логик алдаа болон анхааруулгууд.
- `reviewRecommendation`: нооргийг шалгахад бэлэн эсвэл засвар шаардлагатай эсэх.
- `requiresHumanReview`: гаралтыг хүн заавал шалгахыг заана.
- `draftId`: PostgreSQL-д хадгалсан нооргийн ID.

## Нооргийн төлөвүүд

- `PROCESSING`: мэдээллийг боловсруулж байна.
- `READY_FOR_REVIEW`: validation амжилттай, confidence хангалттай.
- `NEEDS_CORRECTION`: логик алдаа илэрсэн эсвэл confidence бага.
- `APPROVED`: хүн шалгаж зөвшөөрсөн төлөвт ашиглахаар нөөцөлсөн.
- `REJECTED`: хүн шалгаж татгалзсан төлөвт ашиглахаар нөөцөлсөн.
- `FAILED`: extraction эсвэл хадгалалтын үед алдаа гарсан.

`APPROVED` болон `REJECTED` төлөвийг удирдах хүний review workflow нь A1-ийн дараагийн системтэй холбогдох хэсэг бөгөөд A1 өөрөө үндсэн өгөгдлийг автоматаар батлахгүй.

## Шалгах командууд

A1 golden dataset evaluation:

```powershell
pnpm.cmd eval:a1
```

A1-ийн автомат тестүүд:

```powershell
pnpm.cmd exec vitest run tests/structuring
```

Бүх төслийн тест:

```powershell
pnpm.cmd test
```

Одоогийн баталгаажуулалтаар TypeScript check амжилттай, нийт `168/168` тест амжилттай ажилласан. Бодит OpenAI текст extraction, confidence, validation болон PostgreSQL draft хадгалалт мөн амжилттай шалгагдсан.

## Анхаарах зүйл

- OpenAI API ашиглахын тулд идэвхтэй billing/quota хэрэгтэй.
- Бичвэрийн дээд урт `20,000` тэмдэгт.
- Зургийн дээд хэмжээ `10 MB`.
- Confidence өндөр байсан ч хүний хяналтыг алгасаж болохгүй.
- A1 зөвхөн ноорог үүсгэнэ; үндсэн төслийн өгөгдлийг шууд өөрчлөхгүй.
