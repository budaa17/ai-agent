# ADR 0009: BuildWatch v2.2 extension boundary

- Төлөв: Accepted
- Огноо: 2026-07-31

## Нөхцөл

Одоогийн agent core нь A1–A4, `ProjectAnalysisSnapshotV1`, deterministic CPM/forecast/
rules, approval boundary, tenant-safe tools болон evaluation-тэй. BuildWatch v2.2 нь A0
design-to-baseline болон A5 operational planning/verification/forecast гэсэн том domain
нэмнэ.

Existing contract-д raw drawing geometry, resource planning болон UI state шууд нэмбэл
өнөөгийн test, CLI, worker, evaluation болон agent-console хэрэглэгчийг эвдэх эрсдэлтэй.

## Шийдвэр

- BuildWatch v2.2-ийг existing agent core-ийн add-only extension болгон хэрэгжүүлнэ.
- `ProjectAnalysisSnapshotV1`, `DailyReportDraftV1`,
  `ApprovedDailyReportCommandV1`, `DeterministicAnalysisV1`, A2/A3/A4 output болон
  production tool authorization contract-ийг in-place breaking change хийхгүй.
- A0/A5 contract тусдаа `V1` schema, parser, test, adapter-тай байна.
- A0 approved baseline command canonical data-д apply болсны дараа existing analysis
  snapshot болон шинэ operational snapshot adapter-аар үүснэ.
- A5 output existing A2/A3/A4-д source-backed read model хэлбэрээр очно.
- Шинэ capability feature flag, migration wave, backward-compatible API version-оор
  үе шаттай нэвтэрнэ.
- Requirement ID, priority болон target phase-ийг
  `../buildwatch-v2.2-requirement-catalog.md` удирдана.

## Үр дагавар

- Одоогийн A1–A4 regression болон CLI workflow хадгалагдана.
- Adapter болон version mapping нэмэлт ажил шаардана.
- Нэг том shared snapshot-д бүх domain-ийг шахахгүй тул ownership, source lineage,
  security boundary тодорхой байна.
- Breaking change шаардлагатай бол шинэ schema version болон migration ADR гаргана.
