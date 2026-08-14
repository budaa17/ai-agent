# BuildWatch v2.2 — Phase 3 A5 deterministic daily planning

**Төлөв:** `COMPLETE` — 2026-08-02  
**Gate:** `pnpm.cmd run phase3:v22:gate`

## 1. Зорилго

A5 нь `OperationalPlanningSnapshotV1`-ээс тухайн өдрийн ажлын төлөвлөгөөний
ноорог үүсгэнэ. Энэ урсгал OpenAI болон бусад LLM дуудахгүй. Ижил request нь
byte-stable ижил үр дүн гаргана.

## 2. Deterministic урсгал

1. `eligibility.ts` нь status, activity window, calendar, predecessor,
   inspection, material, crew, equipment, zone, weather, blocker, safety-г
   source-backed байдлаар шалгана.
2. `priority.ts` нь critical path → float → milestone → downstream unlock →
   booked resource/material → baseline sequence → work-item ID дарааллаар
   stable эрэмбэлнэ.
3. `daily-target.ts` нь remaining, crew productivity × crew factor × shift
   factor, material, equipment, zone capacity-ийн minimum-ийг `ROUND_HALF_UP`
   boundary-р тооцно.
4. Input дутуу үед target зохиохгүй, `INSUFFICIENT_INFORMATION` болон
   source-backed reason code гаргана.
5. `resource-conflicts.ts` нь crew/equipment double booking, zone capacity,
   material, predecessor, weather, safety, calendar, shift, inspection,
   blocker зөрчлийг илрүүлнэ.
6. `plan.ts` нь `DailyWorkPlanDraftV1` үүсгэнэ. Алдаатай draft `DRAFT`, цэвэр
   draft `REVIEW_REQUIRED` төлөвтэй бөгөөд хүний review заавал шаарддаг.
7. `review.ts` нь `DRAFT → REVIEW_REQUIRED → APPROVED → IN_PROGRESS → CLOSED`
   state machine, reject/correction reason, corrected field path, SHA-256 audit
   мөр хадгална.
8. `jobs.ts` нь project timezone-аар өдөр бүр `05:00`, manager request, stable
   idempotency key, retry/dead-letter, replay-г дэмжинэ.

## 3. Команд

```powershell
pnpm.cmd run plan:v22 -- --scenario HEALTHY_CONTROL --mode auto
pnpm.cmd run plan:v22 -- --scenario EQUIPMENT_DOUBLE_BOOKING --mode validate
pnpm.cmd run eval:planning:v22
pnpm.cmd run test:planning:v22
pnpm.cmd run phase3:v22:gate
```

`plan:v22`-ийн default output:
`data/planning/a5-daily-plan-latest.json`.

Evaluation output:

- `data/evaluations/buildwatch-v22-planning-latest.json`;
- `data/evaluations/buildwatch-v22-planning-latest.md`.

## 4. Requirement evidence

- `A5-001`–`A5-005`: eligibility, priority, target, review, orchestration.
- `DET-PLAN-001`–`DET-PLAN-008`: source-backed deterministic plan/conflict.
- `QA-V22-004`: 50-work-item deterministic benchmark.
- `QA-V22-012`: planning answer-key regression.
- `P-02`, `P-06`, `P-08`: no invented quantity, deterministic ownership,
  human approval boundary.

## 5. Exit gate

- [x] Eligibility matrix бүх fault/control case-ийг шалгасан.
- [x] Priority-ийн бүх 7 tie-breaker unit test-тэй.
- [x] Daily-target boundary ба missing-input test-тэй.
- [x] Crew/equipment/zone/material/weather/precondition conflict шалгагдсан.
- [x] Manager болон timezone-aware 05:00 job contract бэлэн.
- [x] Retry, dead-letter, replay infrastructure-тэй.
- [x] Same tenant/project/date idempotency key давхардсан plan-ийг хориглоно.
- [x] Review state machine correction/reject reason audit-тэй.
- [x] 50-work-item deterministic benchmark byte-stable.
- [x] Eligible precision/recall `100% / 100%`.
- [x] Conflict precision/recall `100% / 100%`.
- [x] Auto critical omission `0`.
- [x] Undetected resource conflict `0`.
- [x] Shortage-г feasible гэж ангилсан тоо `0`.
- [x] LLM шаардлагагүй (`llmRequired: false`).

**PHASE 3 EXIT GATE: PASS**
