# BuildWatch v2.2 — Local concurrent load test (NFR-05, TODO 3.2)

**Огноо:** 2026-08-05
**Скрипт:** `agents/src/performance/load-test.ts` (`pnpm run loadtest:local`)
**Raw тайлан:** `agents/data/evaluations/buildwatch-v22-local-load-test.json`

## Арга зүй

`docs/phase-11-buildwatch-v2.2-production-release.md` §2-т байгаа `api-p95` гэдэг тохиолдол зөвхөн **дараалсан** (нэг хүсэлт дуусаад дараагийнх нь эхэлдэг) 40 local HTTP хүсэлтийг хэмждэг байсан. Энэ баримт бичиг үүнийг бодит **concurrent** (зэрэгцээ) ачааллаар нөхнө:

- Бодит production Express/Prisma runtime-ийг (`createPhase9ProductionRuntime`) local Postgres (`localhost:5434`)-той холбож, ephemeral порт дээр ажиллуулав — `createPhase9Api({} as Phase9ApiServices, ...)` гэсэн хийсвэрлэсэн stub биш, жинхэнэ бүх middleware/rate-limiter/security-header stack.
- [autocannon](https://github.com/mcollina/autocannon) (npm пакет, гадаад binary шаардахгүй)-оор **50 зэрэгцээ холболт**, endpoint тус бүрт **15 секунд** үргэлжлэх ачаалал өгсөн.
- 3 endpoint шалгасан: `/health/live` (DB рүү хандахгүй, зөвхөн middleware), `/health/ready` (жинхэнэ `SELECT 1` DB round-trip орсон), `/openapi.json` (том JSON payload үүсгэлт/сериализаци).

## Үр дүн

| Endpoint                        | req/s | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | Алдаа |
| ------------------------------- | ----: | -------: | -------: | -------: | -------: | ----: |
| `/health/live`                  | 4,564 |       10 |       14 |       16 |       58 |     0 |
| `/health/ready` (DB round-trip) | 2,018 |       24 |       31 |       34 |      203 |     0 |
| `/openapi.json`                 | 2,260 |       21 |       31 |       35 |       58 |     0 |

Гүйцэтгэсэн орчин: Node v22.23.2, Windows x64, 68,450–33,900 хүсэлт endpoint тус бүр дээр, нийт алдаа/timeout/non-2xx = 0.

Одоогийн `phase11PerformanceTargets.apiP95Ms = 250ms` босготой харьцуулахад 50 зэрэгцээ хэрэглэгчийн дор ч p95 хэвээр 14-31ms — өөрөөр хэлбэл нэг хөгжүүлэлтийн машин дээр API middleware/DB round-trip 50 concurrent connection дор ~10x зай (margin) үлдээж байна.

## Хамрахгүй зүйл (яагаад энэ нь "Full release gate"-ийн шаардлагыг бүрэн хангахгүй)

Энэ тест **нэг хөгжүүлэлтийн машин дээрх localhost** хэмжилт хэвээр байгаа тул `NFR-05`-ийг **PARTIAL** гэж тэмдэглэнэ (DONE биш):

- Клиент-сервер хооронд жинхэнэ сүлжээний latency (WAN/VPN/CDN) байхгүй.
- Удирдлагатай/managed production DB биш, local Docker Postgres дээр ажилласан.
- Олон instance/load balancer-ийн ард биш, дан процесс.
- Бодит хэрэглэгчийн auth/session-той urlсан хэсгүүд (жишээ нь `/v1/projects`, `/v1/rules`) биш зөвхөн health/openapi endpoint — учир нь concurrent тест нь seeded tenant/user өгөгдөл шаарддаг production-ижил authenticated урсгалыг одоохондоо хамрахгүй.

Эдгээрийг хамгийн чухал нь **бодит deployed орчинд** (Docker/K8s, удирдлагатай Postgres, олон instance) ажиллуулж баталгаажуулах ёстой — энэ бол TODO-NEXT-STEPS.md 4-р шатны "Full release gate" хэсэгт үлдэнэ.

## Давтах

```powershell
cd agents
pnpm run loadtest:local
# Concurrency/duration тохируулах:
$env:LOADTEST_CONNECTIONS=100; $env:LOADTEST_DURATION_SEC=30; pnpm run loadtest:local
```
