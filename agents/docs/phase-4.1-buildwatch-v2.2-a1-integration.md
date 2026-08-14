# BuildWatch v2.2 — Phase 4.1 A1 approved actual integration

**Төлөв:** `COMPLETE` — 2026-08-02  
**Gate:** `pnpm.cmd run phase4.1:v22:gate`

## 1. Зорилго

A1-ийн хүний хяналтаар батлагдсан өдрийн тайланг verification engine-ийн
source-backed input болгоно. AI-ийн draft, засагдаагүй model output, эсвэл
батлагдаагүй тайлан энэ boundary-г давахгүй.

## 2. Approved-only урсгал

```text
A1 DailyReportDraftV1
  → human review/edit
  → ApprovedDailyReportCommandV1
  → buildApprovedA1ActualBundle
  → ApprovedA1ActualBundleV1
  → progress verification (Phase 4.2–4.5)
```

Adapter-ийн оролт:

- strict `ApprovedDailyReportCommandV1`;
- тухайн tenant/project-ийн `OperationalPlanningSnapshotV1`;
- source-backed previous cumulative quantity.

Adapter-ийн гаралт:

- `approvalBoundary = APPROVED_COMMAND_ONLY`;
- declared actual болон cumulative quantity;
- progress percent, status, blocker candidate;
- attendance, headcount, hours;
- material usage;
- equipment usage;
- эх artifact болон human approval source lineage;
- verification eligibility.

## 3. Quantity дүрэм

- `INCREMENTAL` quantity нь declared actual болно.
- Previous cumulative байвал incremental + previous-оос cumulative-г
  deterministic тооцно.
- `CUMULATIVE` quantity нь declared cumulative болно.
- Previous cumulative байвал зөрүүнээс actual-г deterministic тооцно.
- Cumulative quantity буурахыг reject хийнэ.
- Quantity байхгүй percentage-only тайланд previous value-г өнөөдрийн quantity
  мэт хуулж тавихгүй.
- Unit нь operational work item-ийн canonical unit-тэй таарах ёстой.

## 4. Resource ба blocker дүрэм

- Attendance-ийн explicit headcount/hours-ийг өөрчлөхгүй дамжуулна.
- Material quantity нь snapshot доторх resolved material ID, canonical unit-тэй
  байх ёстой.
- Equipment нь ID/type/name-аар snapshot дотор яг нэг удаа resolve хийгдэнэ.
- Blocker candidate нь зөвхөн ижил work item/category бүхий open, human-approved
  operational blocker-той холбоно.
- Тодорхойгүй resource reference дээр adapter таамаглахгүй, reject хийнэ.

## 5. Source, security, idempotency

- Bundle болон nested quantity бүр source reference-тэй.
- Daily report, source artifact, human decision, deterministic calculation тусдаа
  lineage-тэй.
- Source бүр bundle-ийн tenant/project scope-т таарна.
- Draft object-ийг command-ийн оронд өгөхөд strict schema reject хийнэ.
- Snapshot-аас өөр tenant/project-ийн command reject хийнэ.
- Ижил approved command byte-stable ижил bundle гаргана.
- Ижил idempotency key-г өөр approved content-тэй ашиглахыг хориглоно.

## 6. Forecast хамгаалалт

`ApprovedA1ActualBundleV1` нь:

```text
eligibleForVerification = true
eligibleForForecast = false
forecastExclusionReason = REQUIRES_APPROVED_PROGRESS_VERIFICATION
```

Иймээс A1 approved actual өөрөө forecast-г шууд өөрчлөхгүй. Зөвхөн дараагийн
phase-ийн `ApprovedProgressVerificationCommandV1` canonical forecast input үүсгэнэ.

## 7. Код ба тестийн нотолгоо

- `src/verification/a1-approved-actual.ts` — schema, adapter, idempotent gateway;
- `src/contracts/daily-report.ts` — approved equipment usage contract;
- `src/structuring/daily-report-model.ts` — model equipment output;
- `src/structuring/daily-report-extract.ts` — explicit-only extraction rule;
- `src/structuring/daily-report-finalize.ts` — review draft mapping;
- `tests/verification/a1-approved-actual.test.ts` — approved boundary regression;
- `tests/structuring/daily-report-finalize.test.ts` — equipment finalization.

Requirement evidence: `BW-CORE-001`, `A5-007` integration input,
`DET-VERIFY-010` approved/idempotent boundary, `P-01`, `P-02`, `P-08`.

## 8. Команд

```powershell
pnpm.cmd run test:verification:v22
pnpm.cmd run phase4.1:v22:gate
```

## 9. Exit gate

- [x] Strict approved command boundary хэрэгжсэн.
- [x] Unapproved draft adapter-т орохгүй.
- [x] Tenant/project scope mismatch reject хийнэ.
- [x] Work item operational snapshot-аас resolve хийгдэнэ.
- [x] Incremental болон cumulative quantity deterministic mapping-тэй.
- [x] Missing quantity-г percentage/previous value-оос зохиохгүй.
- [x] Attendance болон explicit hours дамжина.
- [x] Material usage resolved ID/unit-тэй дамжина.
- [x] Equipment usage contract, extraction, finalization, adapter-тэй.
- [x] Зөвхөн matching approved blocker холбоно.
- [x] Source artifact болон human decision lineage хадгалагдана.
- [x] Ижил input byte-stable output гаргана.
- [x] Idempotency key content conflict reject хийнэ.
- [x] Approved A1 actual forecast-д шууд орохгүй.
- [x] Targeted regression test болон TypeScript gate pass.

**PHASE 4.1 EXIT GATE: PASS**
