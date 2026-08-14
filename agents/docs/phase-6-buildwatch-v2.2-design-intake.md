# BuildWatch v2.2 — Phase 6 A0 design intake

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase6:v22:gate`

## 1. Зорилго ба MVP хүрээ

Phase 6 нь A0-ийн эхний production boundary-г инженерийн XLSX workbook болон
vector architectural PDF дээр хэрэгжүүлнэ. Upload-оос гарсан үр дүн шууд official
baseline болдоггүй; document, revision, scale, element бүгд candidate/review state-д
үлдэнэ. Metric geometry нь зөвхөн инженерийн `VERIFIED` scale-аар үүснэ.

Энэ phase-д IFC/BIM, structural, MEP, raster drawing quantity, automated revision
impact болон quantity/material/cost/schedule calculation орохгүй. Эдгээр нь Phase 7
эсвэл advanced scope байна.

## 2. File intake ба security boundary

`intakeDesignFile` дараах дарааллаар deterministic шалгалт хийнэ:

1. source bytes-ийн SHA-256 checksum бодно;
2. injectable `MalwareScanner` port-оор bytes/checksum-ийг шалгана;
3. PDF/XLSX magic bytes болон filename extension тааруулна;
4. хэмжээ, PDF page count, XLSX ZIP entry/expanded-size/compression ratio limit шалгана;
5. encrypted ZIP, ZIP64, path traversal, macro, ActiveX, embedded болон external-link
   content-ийг блоклоно;
6. exact checksum duplicate lineage үүсгэнэ;
7. PDF page бүрийг vector/raster/mixed/empty гэж profile хийнэ;
8. classification, discipline, source metadata, issue, status-тай immutable intake
   manifest буцаана;
9. `ArtifactStore` өгсөн үед зөвхөн clean, non-rejected bytes-ийг tenant/project
   scope-т immutable хадгална.

Built-in scanner нь development deterministic signature scanner; production scanner
нь ижил port-оор солигдоно. Scanner bypass хийх зам байхгүй.

## 3. Engineering workbook

`importEngineeringWorkbook` нь requirement-ийн `01_Project`-оос
`18_Approval_Matrix` хүртэлх 18 canonical sheet-ийг бүгдийг шалгана.

- sheet/column нэр canonical normalization-той;
- unexpected эсвэл duplicate sheet/column reject болно;
- required column/value, cell type, duplicate key row бүрээр шалгагдана;
- formula, hyperlink, Excel error, unsupported object authoritative input болохгүй;
- accepted row бүр canonical checksum болон `EXCEL_IMPORT_ROW` source reference-тэй;
- sheet checksum, workbook checksum, import version, source artifact хадгалагдана;
- алдаатай row тусдаа reject болж, sheet-level болон row-level error report гарна;
- clean workbook `READY_FOR_REVIEW`; ямар нэг deterministic error байвал `INVALID`.

Workbook import нь approved catalog/baseline биш. Хүний approval болон canonical DB
apply boundary Phase 7–9-д үргэлжилнэ.

## 4. Vector PDF, page ба revision

PDF.js-ийн Node legacy build-ээр page tree, rotation, text span, vector operator,
image operator болон vector path bounding box-ийг уншина. PDF бүр:

- page count, width/height, 0/90/180/270 rotation;
- vector/raster/mixed/empty mode;
- text source region;
- vector geometry source region;

гэсэн profile-тэй.

`registerArchitecturalRevision` нь sheet code, revision code, title, issue date,
discipline болон page source-г бүртгэнэ. Required metadata байхгүй бол утга зохиохгүй,
`revision = null` болон explicit missing-info error гаргана. Ижил revision code өөр
document дээр таарвал `DRAWING_REVISION_CONFLICT` үүсэж human review-д орно.
Supersession нь зөвхөн explicit `supersedesRevisionId`-аар бүртгэгдэнэ.

## 5. Scale verification gate

Scale candidate source priority:

1. `VECTOR_DIMENSION`;
2. `TITLE_BLOCK`;
3. `ENGINEER_KNOWN_DISTANCE`;
4. `APPROVED_MANUAL_CALIBRATION`.

Candidate нь `UNKNOWN`, `CANDIDATE`, `REJECTED`; authoritative scale нь тусдаа
`VerifiedDrawingScaleV1` contract байна. `reviewScaleCandidate` зөвхөн ENGINEER
approval-аар `VERIFIED` scale үүсгэнэ. Scale correction нь corrected field paths,
before/after hash, actor, time, reason бүхий audit-тэй.

Нэг page-ийн scale ratio 2%-иас илүү зөрвөл
`DRAWING_MIXED_SCALE_CONFLICT` болж review-д орно. `UNKNOWN`, `CANDIDATE`,
`REJECTED` scale-аас metric dimension гарахгүй.

## 6. Architectural element candidate

Narrow extractor нь engineer-labeled vector convention-оос дараах зургаан type-ийг
source path-тай нь гаргана:

- `FLOOR`;
- `ZONE`;
- `ROOM`;
- `WALL`;
- `DOOR`;
- `WINDOW`.

Candidate бүр type/code/name, page, normalized bounding region, geometry type,
source reference, overall confidence, field confidence/evidence, extraction method,
`PDF_VECTOR_LABEL` extraction method, `buildwatch-vector-architecture-v1` extraction
version, review status болон missing
information-тэй. Label-д vector geometry олдохгүй бол candidate зохиохгүй,
`ELEMENT_VECTOR_GEOMETRY_MISSING` issue гаргана.

Scale баталгаагүй candidate-ийн `dimensions = []`, `scaleId = null` байна. Scale
баталгаажсаны дараа PDF point → drawing unit → metre conversion deterministic хийгдэж,
metric dimension бүр source-backed болно. Quantity formula Phase 7 хүртэл үүсэхгүй.

## 7. Human review ба audit

`reviewDesignCandidates` болон `prepareElementDecision` нь:

- accept;
- edit;
- reject;
- merge;
- split;
- dimension/geometry correction;

үйлдлийг immutable ID/version lineage-аар шалгана. Edit/merge/split нь шинэ candidate
ID шаарддаг. Accepted metric dimension бүр тухайн tenant/project/revision/page-ийн яг
таарах `VERIFIED` scale-тай байх ёстой. Source page + bounding region байхгүй accepted
candidate schema болон review boundary-г давахгүй.

`DesignReviewAuditV1` нь source/result IDs, before/after SHA-256, actor, role, time,
reason болон review decision хадгална. Frontend viewer-д source highlight хийхэд
шаардлагатай normalized region contract бэлэн; actual production viewer Phase 10-д
энэ contract-ийг render хийнэ.

## 8. Test ба evaluation нотолгоо

Targeted suite:

- Test files: `4/4 PASS`;
- Tests: `16/16 PASS`;
- PDF magic/rotation/vector profile;
- malware, extension spoof, exact duplicate;
- 18-sheet valid import, missing sheet, formula, unexpected sheet, checksum substitution;
- six element type, source region, unverified/verified scale gate;
- accept/edit/reject/merge/split/scale-correction audit;
- source-less candidate rejection.

Golden/adversarial evaluation:

- Status: `PASS`;
- Element precision: `100.00%`;
- Element recall: `100.00%`;
- Unverified metric dimensions: `0`;
- Source-less accepted elements: `0`;
- Missing-scale metric dimensions: `0`;
- Rejected-scale metric dimensions: `0`;
- Rotated page detected: `true`;
- Mixed scale routed to review: `true`;
- Revision conflict routed to review: `true`.

Evidence:

- `src/design-intake/contracts.ts`;
- `src/design-intake/file-intake.ts`;
- `src/design-intake/xlsx-container.ts`;
- `src/design-intake/workbook.ts`;
- `src/design-intake/pdf-inspection.ts`;
- `src/design-intake/vector-architecture.ts`;
- `src/design-intake/review.ts`;
- `src/design-intake/evaluation.ts`;
- `tests/design-intake/`;
- `data/evaluations/buildwatch-v22-design-intake.json`.

Requirement evidence: `A0-001`, `A0-004`–`A0-009`, `A0-014`, `A0-016`,
`DET-GEO-001`, `DET-GEO-002`, `DET-GEO-007`, `BE-DESIGN-001`, `BE-DESIGN-002`,
`BE-DESIGN-009`, `QA-V22-003`, `QA-V22-007`, `QA-V22-008`, `QA-V22-020`,
`G-01`, `G-02`, `P-01`, `P-02`, `P-04`, `P-08`, `P-09`.

## 9. Команд

```powershell
pnpm.cmd run test:design-intake:v22
pnpm.cmd run eval:design-intake:v22
pnpm.cmd run phase6:v22:gate
```

## 10. Exit gate

- [x] PDF/XLSX magic, media, extension, size/page limit шалгагдана.
- [x] Upload бүр SHA-256 болон malware result-тэй.
- [x] Exact duplicate document/artifact lineage-тай.
- [x] Clean artifact immutable store port-той.
- [x] XLSX ZIP bomb, encryption, traversal, macro/external content блоклогдоно.
- [x] `01_Project`–`18_Approval_Matrix` 18 strict sheet бүрэн.
- [x] Sheet/column mapping болон row-level error report гарна.
- [x] Workbook/sheet/row checksum, import version, source artifact хадгалагдана.
- [x] Formula authoritative input болохгүй.
- [x] PDF page rotation болон vector/raster/mixed mode танигдана.
- [x] Revision/page/discipline/source бүртгэгдэнэ.
- [x] Missing revision metadata зохиогдохгүй.
- [x] Duplicate revision conflict human review-д орно.
- [x] Scale дөрвөн source priority-тай.
- [x] Scale status `UNKNOWN/CANDIDATE/VERIFIED/REJECTED` boundary-тай.
- [x] Mixed-scale conflict human review-д орно.
- [x] Scale correction audit reason/before/after hash-тай.
- [x] Floor/zone/room/wall/door/window зургаан type гарна.
- [x] Candidate бүр source page + normalized bounding region-тэй.
- [x] Candidate бүр confidence/evidence/method/version-тэй.
- [x] Missing vector geometry дээр element зохиохгүй.
- [x] Scale баталгаагүй metric dimension `0`.
- [x] Rejected scale-аас metric dimension `0`.
- [x] Source-гүй accepted element `0`.
- [x] Accept/edit/reject/merge/split immutable audit-тай.
- [x] Metric review яг таарах verified page scale шаарддаг.
- [x] Rotated, mixed-scale, duplicate revision, missing scale adversarial gate pass.
- [x] Golden element precision/recall `100.00% / 100.00%`.
- [x] Targeted test болон evaluation gate pass.

**PHASE 6 EXIT GATE: PASS**
