# ADR 0014: Design, analysis ба operational snapshot boundary

- Төлөв: Accepted
- Огноо: 2026-07-31

## Нөхцөл

`ProjectAnalysisSnapshotV1` нь одоогийн work item, progress, dependency, calendar,
material, cost болон A1–A4 tool/evaluation-д тохирсон. Raw PDF geometry, design
candidate, daily resource allocation, photo review болон forecast state бүгдийг нэг
snapshot-д нэмбэл contract хэт томорч, security болон version semantics бүдгэрнэ.

## Шийдвэр

- `ProjectAnalysisSnapshotV1`-ийг backward-compatible analysis read model хэвээр
  хадгална.
- A0 raw/candidate domain нь design intake болон review contract-д тусдаа байна.
- A5-д `OperationalPlanningSnapshotV1` үүсгэнэ.
- Operational snapshot зөвхөн:
  - approved baseline/schedule reference;
  - remaining quantity;
  - crew/equipment/material availability;
  - approved actual;
  - blocker/inspection/weather/calendar;
  - source catalog;
  - as-of/policy version;
    агуулна.
- Raw file bytes, unrestricted OCR text, UI state, unapproved design candidate болон
  cross-tenant data snapshot-д орохгүй.
- Snapshot immutable, schema-versioned, tenant/project-scoped, as-of-тэй байна.
- Approved command canonical data-д apply болсны дараа adapter шинэ snapshot үүсгэнэ.
- Agent/tool нь caller-provided tenant/project-д итгэхгүй, authorized context-оос scope
  авна.

## Үр дагавар

- Existing A1–A4 contract эвдрэхгүй.
- A0/A5 domain тус бүр минимал, зориулалтын read model-тэй байна.
- Adapter/version synchronization тест шаардана.
- Snapshot stale эсэхийг source version/as-of-аар тодорхой шалгана.
