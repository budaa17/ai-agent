# ADR 0004: Deterministic rules engine boundary

- Төлөв: Accepted
- Огноо: 2026-07-29

## Нөхцөл

Хугацаа, материал, өртөг, бүтээмжийн тооцоог LLM хийвэл ижил өгөгдөлд ялгаатай хариу гарч, аудит хийх боломж муудна.

## Шийдвэр

- CPM, forecast, threshold rule, scenario impact-ийг цэвэр TypeScript deterministic функцээр бодно.
- LLM нь зөвхөн баталгаатай facts/tool results-ийг тайлбарлаж, зөвлөмжийн draft бичнэ.
- Rule бүр `ruleId`, `ruleVersion`, actual, threshold, delta, source IDs гаргана.
- Rule input нь version-тэй `ProjectAnalysisSnapshotV1` байна.
- GoRules руу шилжих боломжийг contract-аар хадгална.

## Үр дагавар

- Тооцоо давтагдах, тестлэх, хамгаалах боломжтой.
- Threshold өөрчлөхөд код review/deployment шаардлагатай.
- LLM-ийн хэлний чанар deterministic accuracy-д нөлөөлөхгүй.
