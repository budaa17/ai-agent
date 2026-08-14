# Sample workbooks

Энэ хавтас Excel import contract, mapping UI болон parser-ийн deterministic fixture-үүдийг хадгална. Эдгээр файлыг production database эсвэл agent-ийн баталгаатай бодит context гэж үзэхгүй.

## `anonymized-construction-project-synthetic-v1.xlsx`

- Эх файл: `anonymized_construction_project_sample.xlsx`
- Ангилал: `SYNTHETIC_ANONYMIZED`
- Workbook-ийн өөрийн README: “сургалт/дипломын ажилд зориулсан бодит мэт зохиомол, бүрэн anonymized sample”
- SHA-256: `f3f3ef49c40605098fb34b9377475af059bdfbf672780602beb98e486e450eaf`
- Хэмжээ: `69653` byte
- Manifest: `anonymized-construction-project-synthetic-v1.manifest.json`

## Шалгалтын дүн

- 9 visible sheet, 20 work item, 28 dependency edge.
- 76 daily report, 336 attendance row, 36 material transaction, 71 cost entry.
- Work code давхардал, үл танигдах work reference, dependency cycle илрээгүй.
- Macro/VBA, external link, embedded object, encryption, external formula илрээгүй.
- Email, Монгол регистр, нэр, яг хаяг зэрэг шууд identifier илрээгүй. Утасны regex-д таарсан 4 утга нь Dashboard-ийн 8 оронтой мөнгөн KPI байсан бөгөөд гараар false positive гэж нягталсан.

Энэ нь статик аюулгүй байдлын шалгалт болохоос malware scanner-ийн production баталгаа биш.

## Contract mapping

| Sheet | Зорилтот contract | Төлөв |
|---|---|---|
| `Work_Plan` | `activeBaseline`, `workItems`, `dependencies` | Partial mapping |
| `Daily_Reports` | `dailyReports`, `progressEntries`, `blockers` | Partial mapping |
| `Attendance` | `attendanceEntries` | Aggregate шаардлагатай |
| `Materials` | `materials`, `stockMovements`, `costEntries` | Movement kind policy шаардлагатай |
| `Costs` | `costEntries` | Source normalization шаардлагатай |
| `Dashboard` | Байхгүй | Derived-only, импортлохгүй |
| `README`, `Lists`, `Data_Dictionary` | Байхгүй | Reference metadata |

## Ашиглах дүрэм

- Contract mapping, Phase 3 Excel mapping UI, parser regression fixture-д ашиглаж болно.
- Agent context, golden answer, бодит хэрэглэгчийн үр дүнгийн нотолгоо болгож ашиглахгүй.
- `Dashboard`-ийн тоог canonical гэж хуулалгүй source sheet-үүдээс дахин тооцоолно.
- Файл өөрчлөгдвөл manifest-ийн checksum, хэмжээ, mapping audit-ийг хамтад нь шинэчилнэ.
- `pnpm.cmd exec vitest run tests/sample-workbooks` командаар integrity шалгана.

## Нээлттэй шаардлага

Phase 1 roadmap-д дурдсан **anonymized бодит Монгол Excel** одоо ч тусдаа шаардлагатай. Тэр файлд data owner-ийн зөвшөөрөл, anonymization тайлбар, бодит гарал гэсэн attestation байх ёстой; repo-д нэмэхээс өмнө энэ fixture-тэй ижил safety/integrity audit хийнэ.
