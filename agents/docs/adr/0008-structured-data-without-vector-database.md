# ADR 0008: Structured project data without a vector database

- Төлөв: Accepted
- Огноо: 2026-07-29

## Нөхцөл

BuildWatch-ийн хугацаа, өртөг, материал, ирц, dependency, alert зэрэг үндсэн баримт нь `ProjectAnalysisSnapshotV1` дотор ID, огноо, нэгж, source reference-тэй бүтэцтэй байна. Эдгээр тоон болон холбоост баримтыг semantic similarity хайлтаар авах нь tenant scope, exact decimal, as-of болон аудитын баталгааг сулруулна.

## Шийдвэр

- Phase 1–2-ын agent tool-ууд authorized structured repository-оос л уншина.
- Tool бүр tenant/project scope, as-of, row limit, source catalog-ийг албадан мөрдөнө.
- Daily report text хайлтыг `searchDailyReports`-ийн scoped deterministic search-аар гүйцэтгэнэ.
- A4-ийн factual claim бүр tool-ийн source reference-тэй байна.
- Vector database-ийг Phase 1-ийн зайлшгүй dependency болгохгүй.
- Ирээдүйд урт баримт, гэрээ, дүрэм, knowledge-base semantic retrieval шаардагдвал тусдаа ADR, tenant-filtered index, source-level authorization, deletion/retention policy-тэйгээр нэмнэ.

## Үр дагавар

- Тоо, огноо, status, tenant scope deterministic хэвээр үлдэнэ.
- Нэмэлт infrastructure, embedding cost, stale index эрсдэлгүй.
- Чөлөөт баримтын semantic хайлт одоогоор хязгаарлагдана.
- Vector search нэмэгдсэн ч canonical structured repository-г орлохгүй.
