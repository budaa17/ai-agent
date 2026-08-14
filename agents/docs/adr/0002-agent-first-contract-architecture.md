# ADR 0002: Agent-first contract архитектур

- Төлөв: Accepted
- Огноо: 2026-07-29

## Нөхцөл

Frontend, backend-ийг түрүүлж баривал AI агентуудын оролт, гаралт өөрчлөгдөх бүрд API болон UI дахин засагдана. Дипломын дараалал нь эхлээд агентуудыг production contract, deterministic core, evaluation-тай болгох шаардлагатай.

## Шийдвэр

- Phase 1–2-т agent domain contract, simulation, deterministic analysis, read-only tools, evaluation-ийг бүрэн болгоно.
- Phase 3 frontend, Phase 4 backend нь батлагдсан contract-уудыг version-ээр хэрэглэнэ.
- `DailyReportDraftV1`, `ProjectAnalysisSnapshotV1`, `AgentRunEnvelopeV1` нь үндсэн boundary байна.
- Existing script болон Prisma adapter-ийг backward-compatible хэвээр үлдээнэ.

## Үр дагавар

- Frontend/backend эхлэхэд contract тогтвортой байна.
- Phase 1-ийн file/in-memory harness нь production persistence биш.
- Contract өөрчлөхөд шинэ schema version болон migration policy шаардана.
