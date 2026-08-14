# BuildWatch v2.2 — Phase 4.2 deterministic photo evidence

**Төлөв:** `COMPLETE` — 2026-08-02  
**Gate:** `pnpm.cmd run phase4.2:v22:gate`

## 1. Зорилго

Оройн A1 approved actual-д хавсарсан 1–5 талбайн зургийг exact quantity-ийн эх
сурвалж болголгүйгээр deterministic evidence signal болгон шалгана. Output нь
дараагийн progress verification phase-д орно, canonical actual/forecast-г өөрөө
өөрчлөхгүй.

## 2. Урсгал

```text
normalized image bytes
  → inspectPhotoEvidenceBytes
  → PhotoEvidenceByteInspectionV1
  → versioned PhotoEvidencePolicyV1
  → evaluatePhotoEvidence
  → PE-01 … PE-10 + evidence coverage
  → human-reviewed progress verification
```

A1-ийн existing preprocessing нь auto-orient, resize, metadata strip, compression
хийсний дараа энэ pipeline normalized bytes-ийг ашиглана.

## 3. Byte inspection

- file signature болон Sharp decode/open validation;
- expected/actual media type consistency;
- normalized byte SHA-256;
- width/height;
- grayscale edge contrast дээр sharpness score;
- grayscale mean дээр brightness/exposure score;
- 9×8 grayscale difference-аас deterministic 64-bit dHash;
- method version `buildwatch-photo-inspection-v1`.

Decode алдаа exception болж lineage алдахгүй. Structured
`IMAGE_DECODE_FAILED` эсвэл `MEDIA_TYPE_MISMATCH` inspection үүсээд PE-01 `FAIL`
болно.

## 4. Versioned policy

`PhotoEvidencePolicyV1` нь tenant/project/work class бүрээр:

- required photo count;
- required angles;
- reference marker requirement;
- maximum photo age;
- minimum sharpness;
- minimum/maximum brightness;
- near-duplicate Hamming threshold;
- effective date, approver, version, source lineage;

хадгална. Snapshot-ийн work class болон policy scope/effective date зөрвөл request
reject хийнэ.

## 5. PE-01–PE-10 canonical mapping

| Код   | Deterministic шалгалт                                         |
| ----- | ------------------------------------------------------------- |
| PE-01 | File decode/open болон media type                             |
| PE-02 | Blur, darkness, overexposure                                  |
| PE-03 | SHA-256 exact болон dHash near-duplicate                      |
| PE-04 | Өмнөх report date-ийн exact/near reuse                        |
| PE-05 | Capture/report/upload date ба max age                         |
| PE-06 | Tenant/project/reported/detected work-item linkage            |
| PE-07 | Required angle aggregate coverage                             |
| PE-08 | Measurement/reference marker aggregate evidence               |
| PE-09 | Text declaration/photo contradiction signal                   |
| PE-10 | Face, plate, identity document, sensitive-text privacy signal |

Check бүр strict schema, deterministic flag, source reference, policy/calculation
lineage-тэй. Simulation-ийн хуучин PE mapping мөн canonical дараалалд шилжсэн.

## 6. Duplicate ба review policy

- Exact duplicate: SHA-256 equality, PE-03 `FAIL`.
- Near duplicate: 64-bit dHash Hamming threshold, PE-03 `WARNING`.
- Previous-day exact reuse: PE-04 `FAIL`.
- Previous-day near reuse: PE-04 `WARNING`.
- Near signal дангаараа report reject хийхгүй ч automatic acceptance-г блоклож
  human review шаарддаг.
- Same-batch canonical photo сонголт болон history comparison stable sort-той.

## 7. Evidence coverage

Output нь submitted, usable, credited photo count, coverage percent, required,
observed, missing angle, marker status, `evidenceComplete`-г тусад нь гаргана.
Count/percentage/angle/marker tampering-ийг Zod refinement reject хийнэ.

`usableForEvidence` нь intrinsic PE failure-гүй зураг. Харин `WARNING` эсвэл aggregate
angle/marker failure байвал `acceptedForVerification = false` хэвээр review-д орно.

## 8. Аюулгүй байдлын хил

- Cross-tenant/project photo, history, policy, source reject хийнэ.
- Photo artifact source нь artifact ID болон SHA-256-тай таарна.
- Future snapshot, policy, history, upload reject хийнэ.
- Privacy `RESTRICTED` зураг auto-accept болохгүй.
- Ижил idempotency key + өөр content reject хийнэ.
- Input order өөрчлөгдсөн ч canonical request hash болон output ижил.

## 9. Exact quantity хориг

Photo request/output strict schema-д quantity талбар байхгүй.

```text
exactQuantityDerived = false
```

Зураг progress claim-ийг дэмжих эсвэл зөрчил/quality/privacy signal өгнө. Verified
quantity-г Phase 4.3 deterministic verification нь approved measurement болон бусад
non-photo source-оос авна.

## 10. Evaluation нотолгоо

BuildWatch operational simulation-ийн 117 photo metadata дээр:

- Cases: `117/117 PASS`;
- Duplicate precision: `100.00%`;
- Duplicate recall: `100.00%`;
- Acceptance accuracy: `100.00%`;
- Exact quantity violation: `0`.

Evidence:

- `src/contracts/photo-evidence.ts`;
- `src/verification/photo-evidence.ts`;
- `src/verification/photo-evidence-evaluation.ts`;
- `src/scripts/evaluate-buildwatch-v22-photo-evidence.ts`;
- `tests/verification/photo-evidence.test.ts`;
- `tests/verification/photo-evidence-evaluation.test.ts`;
- `data/evaluations/buildwatch-v22-photo-evidence-latest.json`.

Requirement evidence: `A5-006`, `DET-VERIFY-001`–`DET-VERIFY-005`, `PE-01`–`PE-10`,
`BE-PLAN-003`, `QA-V22-005`, `QA-V22-013`, `P-03`, `P-08`.

## 11. Команд

```powershell
pnpm.cmd run test:photo:v22
pnpm.cmd run eval:photo:v22
pnpm.cmd run phase4.2:v22:gate
```

## 12. Exit gate

- [x] Decode/open failure structured PE-01 result болдог.
- [x] Media-type mismatch deterministic reject signal-тэй.
- [x] Artifact SHA-256 lineage шалгагддаг.
- [x] Sharpness болон brightness/exposure score deterministic.
- [x] 64-bit dHash method version-тэй.
- [x] Exact duplicate PE-03 fail болдог.
- [x] Near-duplicate warning/review болдог.
- [x] Previous-day reuse PE-04-өөр ялгардаг.
- [x] Capture/report/upload chronology шалгагддаг.
- [x] Tenant/project/work-item linkage шалгагддаг.
- [x] Required angle aggregate coverage шалгагддаг.
- [x] Reference marker requirement шалгагддаг.
- [x] Text/photo contradiction signal шалгагддаг.
- [x] Privacy signal auto-accept-г блоклодог.
- [x] Photo-оос exact quantity үүсгэдэггүй.
- [x] Same input/order variation byte-stable.
- [x] Idempotency content conflict reject хийнэ.
- [x] Simulation PE mapping canonical PE-01–PE-10 болсон.
- [x] 117-photo duplicate precision/recall болон acceptance gate pass.

**PHASE 4.2 EXIT GATE: PASS**
