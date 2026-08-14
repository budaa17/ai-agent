# Full release gadны нотолгооны checklist (TODO-NEXT-STEPS.md 4-р шат)

**Огноо:** 2026-08-05
**Зорилго:** `pnpm run phase11:release:v22:gate -- --evidence <manifest>` (`agents/src/operations/release-evidence.ts`) шаарддаг 10 гадны нотолгоог цуглуулах явцыг хянах. **Энэ баримт болон хамт орсон `evidence-manifest.template.json` нь зөвхөн хоосон бүтэц/маягт — аль нэг талбарт хиймэл/зохиомол өгөгдөл бичихгүй.** Бодит нотолгоо ирсэн үед л тухайн мөрийг бөглөнө.

> Учир нь: `PRODUCTION-ROADMAP.md`-д аль хэдийн тэмдэглэснээр "энэ external evidence-ийг зохиомлоор нөхөхгүй; өгөөгүй үед `technicalPass=true`, `releasePass=false` байна" — AI агент энэ зарчмыг зөрчихгүй.

## Checklist

| #     | Зүйл                                                                     | Manifest талбар                                      | Эзэмшигч | Огноо цуглуулсан | Байршил/линк | Sign-off | Төлөв |
| ----- | ------------------------------------------------------------------------ | ---------------------------------------------------- | -------- | ---------------- | ------------ | -------- | ----- |
| 4.1   | Жинхэнэ (synthetic биш) drawing/BOQ dataset, 10+ case, инженерийн review | `drawingBoq.*`                                       |          |                  |              |          | ☐     |
| 4.2   | Жинхэнэ, зөвшөөрөл авсан талбайн зураг, 60+, хүний review                | `photoDataset.*` (A1-16 гадны хэсэг)                 |          |                  |              |          | ☐     |
| 4.3   | Бодит Монгол компанийн Excel/төсвийн формат (QA-12)                      | _(тусдаа, manifest-д алга — доор тэмдэглэл үзнэ үү)_ |          |                  |              |          | ☐     |
| 4.4   | Deployed орчинд хоёр tenant isolation тайлан                             | `deployment.twoTenantIsolation`                      |          |                  |              |          | ☐     |
| 4.5   | Deployed auth/RBAC/refresh rotation smoke тайлан                         | `deployment.authRbacRefresh`                         |          |                  |              |          | ☐     |
| —     | Deployed орчинд production load test тайлан _(3.2-ын deployed хувилбар)_ | `deployment.productionLoadTest`                      |          |                  |              |          | ☐     |
| 4.6   | Талбайн ахлагчаар бодит offline орчинд туршуулсан, no-data-loss тайлан   | `deployment.offlineFieldTest`                        |          |                  |              |          | ☐     |
| 4.7   | Бие даасан OWASP/pentest тайлан                                          | `deployment.independentSecurityAssessment`           |          |                  |              |          | ☐     |
| 4.8   | Backup/restore бодит гүйцэтгэл, амжилттай баримтжуулалт                  | `deployment.backupRestoreDrill`                      |          |                  |              |          | ☐     |
| 4.9a  | Амьд Sentry alert жишээ                                                  | `deployment.sentryAlert`                             |          |                  |              |          | ☐     |
| 4.9b  | Амьд Langfuse trace/зардлын жишээ                                        | `deployment.langfuseTraceCost`                       |          |                  |              |          | ☐     |
| 4.10a | Domain engineer sign-off                                                 | `signoffs[role=DOMAIN_ENGINEER]`                     |          |                  |              |          | ☐     |
| 4.10b | Security owner sign-off                                                  | `signoffs[role=SECURITY_OWNER]`                      |          |                  |              |          | ☐     |
| 4.10c | Operations owner sign-off                                                | `signoffs[role=OPERATIONS_OWNER]`                    |          |                  |              |          | ☐     |

## 4.3 тухай тэмдэглэл

`QA-12` (`REQUIREMENT-TRACEABILITY.md`) — өгсөн Excel sample "бодит мэт зохиомол" гэдгээ мэдэгддэг тул шинэ, өгөгдөл-эзэмшигчийн баталгаажуулсан жишээ шаардлагатай. Энэ нь `phase11ReleaseEvidenceSchema`-ийн бүтцэд ороогүй тул (өөр gate/шалгуур) `agents/data/` дотор data-owner attestation-тай хамт хадгалж, `QA-12`-ийн мөрийг `REQUIREMENT-TRACEABILITY.md`-д гараар шинэчлэх шаардлагатай.

## Хэрхэн ашиглах

1. Бодит нотолгоо (PDF тайлан, dataset manifest, screenshot г.м.)-ийг `agents/data/release-evidence/` дотор байрлуулна. Энэ фолдер root `.gitignore`-д одоогоор ороогүй, доторх файлууд ихэвчлэн нууцлалтай/өгөгдөл-эзэмшигчийн мэдээлэлтэй байх тул commit хийхийн өмнө агуулгыг заавал шалгаж, шаардлагатай бол `.gitignore`-д тусад нь нэмнэ үү.
2. `evidence-manifest.template.json`-г хуулж, файл бүрийн бодит `sha256`-г тооцоолно:
   ```powershell
   Get-FileHash -Algorithm SHA256 "agents/data/release-evidence/<файл>" | Select-Object -ExpandProperty Hash
   ```
   (PowerShell-ийн гаралт том үсэгтэй тул `.ToLower()` хийж бичнэ — schema нь `^[a-f0-9]{64}$` жижиг үсэгтэй регексжтэй.)
3. `_comment`/`_todo` түлхүүрүүдийг устгана (schema `.strict()` тул тэдгээрийг үлдээвэл validate амжилтгүй болно — энэ бол зорилготой сануулга).
4. Бүх 10 зүйл бөглөгдсөний дараа:
   ```powershell
   cd agents
   pnpm run phase11:release:v22:gate -- --evidence data/release-evidence/phase11-evidence.json
   ```
