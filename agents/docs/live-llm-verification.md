# Live LLM verification

**Date:** 2026-08-07
**Why this exists:** the 621-test suite runs entirely with the model off, exercising the
deterministic fallback path. Nothing in CI proves the A1 structuring agent works against a
real model, so this records one verified live run.

## Environment

|             |                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------- |
| Provider    | OpenAI via `@ai-sdk/openai` (`src/agent/model.ts`)                                                                   |
| Model       | `gpt-5.6-luna` (`A1_OPENAI_MODEL`)                                                                                   |
| Command     | `pnpm structure -- --text "…" --tenant tenant-demo --project project-atlas --reference-date 2026-03-01 --no-persist` |
| Persistence | disabled, so the run touches no canonical tables                                                                     |

## Input

Free-form Mongolian site update, no structure of any kind:

```
AT-010 Тайлангийн модулийн ажил өнөөдөр 60 хувьтай үргэлжилж байна. 4 ажилтан 8 цаг
ажиллав. Цемент 12 тонн зарцуулсан. Цахилгаан тасарснаас болж 2 цаг зогссон.
```

## Output

```json
{
  "schemaVersion": 1,
  "update": {
    "schemaVersion": 1,
    "language": "mn",
    "projectCode": null,
    "workItemCode": "AT-010",
    "workItemName": "Тайлангийн модулийн",
    "reportDate": "2026-03-01",
    "status": "IN_PROGRESS",
    "priority": null,
    "progressPercent": 60,
    "issueTypes": []
  },
  "confidence": {
    "overall": 0.985,
    "level": "HIGH",
    "fields": [
      { "field": "language", "score": 0.99, "evidence": "Монгол хэлээр бичигдсэн эх сурвалж" },
      { "field": "progressPercent", "score": 0.99, "evidence": "60 хувьтай" },
      { "field": "reportDate", "score": 0.98, "evidence": "өнөөдөр; reference date: 2026-03-01" },
      { "field": "status", "score": 0.98, "evidence": "үргэлжилж байна" },
      { "field": "workItemCode", "score": 0.99, "evidence": "AT-010" },
      { "field": "workItemName", "score": 0.98, "evidence": "Тайлангийн модулийн ажил" }
    ]
  },
  "validation": { "valid": true, "errorCount": 0, "warningCount": 0, "issues": [] },
  "reviewRecommendation": "READY_FOR_REVIEW",
  "requiresHumanReview": true
}
```

```
persist=no provider=openai model=gpt-5.6-luna finish=stop
```

## What this confirms

- The OpenAI integration is live and the configured model responds (`finish=stop`, no fallback).
- Relative date resolution works: "өнөөдөр" became `2026-03-01` from `--reference-date`.
- Every extracted field carries its own confidence score and a quoted evidence span, so a
  reviewer can trace each value back to the source text (A1-08).
- `requiresHumanReview` stays `true` even at 0.985 confidence — the model never
  auto-applies, matching ADR-0007 and requirement P1.

## Known gap this run also exposes

`workItemName` came back as `"Тайлангийн модулийн"` while its own evidence span reads
`"Тайлангийн модулийн ажил"` — the trailing noun is dropped. Confidence is still reported
as 0.98. Low impact (the authoritative key is `workItemCode`), but it is a real extraction
defect worth a golden case rather than something to leave undocumented.

Two other observations, both expected rather than defects: the attendance (4 workers × 8h),
material (12t cement) and stoppage (2h power cut) facts in the source are not part of this
particular contract — `structure` emits the project-update shape, while attendance/material
capture belongs to the daily-report intake path (`a1:intake`).

## Reproducing

```powershell
cd agents
pnpm.cmd structure -- --text "<Монгол текст>" --tenant tenant-demo --project project-atlas --reference-date 2026-03-01 --no-persist
```

Requires `OPENAI_API_KEY` in `agents/.env`. Drop `--no-persist` to write a reviewable draft
into the canonical store.
