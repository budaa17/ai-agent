# Phase 1 — Agent data foundation ба A1 text production

## Зорилго

Phase 1 нь frontend/backend-ээс хараат бус, version-тэй contract, бодит хэлбэрийн simulation, deterministic analysis, tenant-safe 11 tool, A1 daily-report text intake болон human review урсгалыг бэлэн болгоно.

Энэ нь **agent core production-ready** гэсэн үг. Login/JWT, production PostgreSQL transaction, object storage, frontend, deployment нь Phase 3–4-ийн ажил хэвээр.

## Бэлэн болсон хэсэг

1. `src/contracts/` — strict `v1` contract:
   - `DailyReportDraftV1`, `ApprovedDailyReportCommandV1`;
   - `ProjectAnalysisSnapshotV1`, `DeterministicAnalysisV1`;
   - `RecommendationDraftV1`, `DocumentBundleV1`, `ReferenceAnswerV1`;
   - `AgentRunEnvelopeV1`, `AgentUsageV1`, `AgentErrorV1`, `AgentEventV1`.
2. `src/simulation/` — 48 work item, 8 WBS бүлэг, 12 долоо хоног, calendar/holiday, daily report, attendance, stock, cost, subcontractor, decision, alert бүхий deterministic simulation.
3. `src/production-analysis/` — calendar-aware CPM, actual-pace forecast, dependency propagation, 11 rule, 4 deterministic recovery scenario.
4. `src/production-tools/` — authorization context ашигладаг 11 read-only tool.
5. `src/structuring/` — Монгол/англи/холимог daily report-оос олон progress, attendance, material, blocker гаргаж, evidence/confidence/clarification/duplicate/logic validation бүхий draft үүсгэнэ.
6. `data/a1-review/` — Phase 1-ийн file-based human review store. Энэ нь production database биш.
7. `src/structuring/daily-report-golden-cases.ts` — 14 ангиллын 140 text case.
8. `data/sample-workbooks/` — checksum, strict manifest, mapping audit бүхий synthetic anonymized Excel fixture. Workbook өөрөө “бодит мэт зохиомол” гэж тодорхойлсон тул anonymized бодит sample-ийн оронд тооцохгүй.

## A1 урсгал

```text
Ажилтны текст
  → OpenAI structured extraction
  → deterministic normalize + validation
  → DailyReportDraftV1
  → хүн show/edit/approve эсвэл reject
  → ApprovedDailyReportCommandV1 + PROJECT_EXECUTION_APPROVED event
  → simulation read-model apply
```

- OpenAI зөвхөн draft extraction хийнэ.
- Unknown утгыг зохиохгүй; null/candidate/question үлдээнэ.
- Approval-гүй draft simulation-д ч apply болохгүй.
- Ижил request ID дахин ирвэл хоёр draft үүсгэхгүй.
- Phase 4 canonical backend дээр яг approved command/event transaction boundary болно.

## Ажиллуулах

### 1. Simulation үүсгэх

```powershell
pnpm.cmd simulation:generate
```

Үр дүн: `data/simulation/phase1/snapshot.json`, тусдаа private fixture, agent-д өгч болохгүй hidden answer key.

### 2. Deterministic analysis

```powershell
pnpm.cmd simulation:analyze -- --as-of 2026-03-28 --output data/simulation/phase1/analysis.json
```

OpenAI API ашиглахгүй. Critical path, projected finish, deviations, recovery scenarios гаргана.

### 3. A1 daily report intake

Текст:

```powershell
pnpm.cmd agent:a1:intake -- --text "2026-03-30-нд A блокийн 2-р давхарт BW-017 Шатны марш өнөөдөр 4 м3 нэмэгдэж, нийт явц 69 хувь болсон. Манай Өрлөгийн баг 6 хүн тус бүр 8 цаг ажилласан. 100 ш тоосго зарцуулсан." --reference-date 2026-03-30 --request-id demo-001
```

Зураг:

```powershell
pnpm.cmd agent:a1:intake -- --image "C:\path\daily-report.png" --reference-date 2026-03-30 --request-id demo-image-001
```

Текст болон 1–5 зураг хамтад нь:

```powershell
pnpm.cmd agent:a1:intake -- --text "2026-03-30-ны талбайн тайлан" --image "C:\path\report-form.png" --image "C:\path\site-photo.jpg" --reference-date 2026-03-30 --request-id demo-multimodal-001
```

Энэ command OpenAI API ашиглаж `data/a1-review` дотор `DailyReportDraft` хадгална. Зураг model call-аас өмнө EXIF orientation-аар эргэж, урт тал нь ихдээ 2048 пиксел болж resize хийгдэн, metadata-гүй шахсан normalized зураг болно. Static GIF нь PNG болно. Зөвхөн normalized bytes checksum-аар dedupe хийгдэж `data/a1-review/artifacts/` дотор хадгалагдана; source/output checksum, хэмжээ, dimension, transformation operation нь мөн `.provenance.json` sidecar-д бичигдэнэ. Draft нь absolute local path бус `SOURCE_IMAGE` artifact metadata, field-level image region evidence болон advisory-only `photoObservations` агуулна.

Зургийн дүрэм:

- PNG, JPEG, WEBP, GIF;
- нэг зураг 10 MB-аас ихгүй;
- нэг intake-д 1–5 зураг;
- EXIF auto-orient, 2048px inside resize, no-enlargement, format-aware compression;
- EXIF/ICC/IPTC/XMP metadata normalized output-д хадгалагдахгүй;
- барилгын талбайн зургаас тоон явцыг таамаглахгүй;
- safety, delivery, progress cue нь автомат шийдвэр биш, зөвхөн хүн шалгах observation/question байна.

### 4. Review хийх

```powershell
pnpm.cmd agent:a1:drafts
pnpm.cmd agent:a1:show -- --draft <draft-id>
pnpm.cmd agent:a1:edit -- --draft <draft-id> --file corrected-draft.json
pnpm.cmd agent:a1:approve -- --draft <draft-id> --reviewer user-manager
pnpm.cmd agent:a1:reject -- --draft <draft-id> --reviewer user-manager --reason "Эх тайлан буруу"
```

`approve` нь validation error, required clarification, unresolved code/unit, logic conflict байвал татгалзана.

### 5. Approved command-ийг simulation-д apply хийх

```powershell
pnpm.cmd agent:a1:apply-simulation -- --draft <draft-id> --simulation-as-of 2026-03-30T23:59:59.000Z --output data/a1-review/applied-snapshot.json
```

Ижил command-ийг давтан apply хийхэд duplicate report үүсэхгүй.
Historical simulation турших үед `--simulation-as-of`-ийг report window-тэй тааруулна. Энэ override нь review store дахь жинхэнэ approval audit timestamp-ийг өөрчлөхгүй.

### 6. Шинэ snapshot-ийг дахин шинжлэх

```powershell
pnpm.cmd simulation:analyze -- --snapshot data/a1-review/applied-snapshot.json --output data/a1-review/applied-analysis.json
```

Ингэснээр хүний баталсан өдрийн тайлан орсны дараах forecast, deviation, rules, recovery scenario-г дахин бодно.

### 7. 140-case A1 evaluation

```powershell
# API зардалгүй reference gate
pnpm.cmd eval:a1:daily -- --output data/evaluations/a1-daily-reference.json

# OpenAI API quota/зардал ашиглах optional live gate
pnpm.cmd eval:a1:daily -- --live --limit 5 --output data/evaluations/a1-daily-live-smoke.json
```

Release gate:

- schema success = 100%;
- field accuracy ≥ 95%;
- clarification precision/recall ≥ 90%;
- prompt-injection pass = 100%;
- mean Brier score ≤ 0.15.

## Шалгах

```powershell
pnpm.cmd check
pnpm.cmd exec vitest run tests/contracts tests/simulation tests/production-analysis tests/production-tools tests/structuring tests/sample-workbooks
pnpm.cmd test
```

Live evaluation-ийг үндсэн CI gate болгохгүй: төлбөр, quota, model variability-аас deterministic regression хамаарах ёсгүй.

## Phase 1 ба дараагийн хязгаар

- A1 daily-report CLI-д image input, artifact storage, visible-region evidence болон advisory observation-ийн Phase 2.1 интеграци орсон.
- Phase 2.1-ийн dimension/EXIF inspection, 40MP/20,000-side guard, malformed/animated rejection, actual EXIF auto-orient, 2048px resize, compression, metadata strip болон source/output provenance хэрэгжсэн. 60+ image golden dataset, malware-scan port, production object storage, signed artifact access, retention/privacy lifecycle бүхий бүрэн vision production gate үлдэнэ.
- A2/A3/A4-ийг шинэ contract/tool bundle-д бүрэн шилжүүлэх, reliability/observability hardening Phase 2-т орно.
- Frontend Phase 3, canonical backend/security/deployment Phase 4-т орно.
- GoRules runtime/JDM persistence нь ADR-0001/0004-ийн boundary-г ашиглан Phase 4-т холбогдоно; Phase 1-ийн deterministic TypeScript rules canonical test oracle хэвээр.
- Synthetic Excel mapping fixture бэлэн боловч data-owner-attested anonymized бодит Монгол Excel sample аваагүй; энэ нь Phase 1-ийн data-evidence gate-ийн нээлттэй үлдсэн хэрэглэгчийн input юм.
