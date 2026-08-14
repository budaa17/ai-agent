# BuildWatch v2.2 — Phase 2 operational simulation

- Төлөв: COMPLETE
- Огноо: 2026-07-31
- Roadmap: `../BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md`
- Contract суурь: `phase-1-buildwatch-v2.2-contracts.md`

`PHASE 2 EXIT GATE: PASS`

## 1. Зорилго

Phase 2 нь A5 daily planning, progress verification, rolling forecast болон
recovery logic-ийг frontend/backend, database, OpenAI-гаас тусгаарлан шалгах
canonical deterministic dataset болон hidden answer key үүсгэнэ.

Хуучин `BuildWatchSimulationV1` болон түүний 48-work-item analysis snapshot
өөрчлөгдөөгүй. Шинэ operational өргөтгөл нь тусдаа
`BuildWatchOperationalSimulationV1` package байна.

## 2. Public/private/answer-key хил

Package гурван тусдаа хэсэгтэй:

1. `agentDataset` — agent болон deterministic engine-д өгч болох public data;
2. `privateFixture` — өөр tenant/project-ийн isolation test fixture;
3. `answerKey` — evaluation дууссаны дараа л comparator ашиглах hidden expected
   result.

`agentDataset` дотор `TENANT-PRIVATE-ONLY`, hidden case ID болон expected answer
байхыг schema/test хориглоно. Generation script эдгээрийг гурван тусдаа JSON
файл болгон хадгална.

## 3. Хэрэгжүүлсэн contract

`src/simulation/buildwatch-v22-contracts.ts`:

- 20 scenario-ийн stable enum;
- positive, negative, boundary control;
- planning rule болон evidence rule;
- photo metadata, exact/perceptual duplicate lineage;
- hidden answer case-ийн заавал байх expected талбарууд;
- public source catalog;
- cross-tenant private fixture;
- minimum 40–60 work item, 30 planning day, 100 decision gate;
- aggregate ID, source catalog, plan/snapshot, photo/check, forecast/productivity,
  recovery/forecast referential integrity;
- tenant/project scope validation.

Answer case бүр дараах талбартай:

```text
expectedEligible
expectedPriority
expectedDailyTarget
expectedConflicts
expectedCompletionStatus
expectedVariance
expectedForecastStatus
expectedDrivers
expectedSourceIds
```

## 4. Canonical dataset

`src/simulation/buildwatch-v22-operational-simulation.ts` дараах deterministic
өгөгдлийг үүсгэнэ:

| Хэмжүүр                     | Тоо |
| --------------------------- | --: |
| Work item                   |  48 |
| Operational snapshot        |  40 |
| Planning day                |  40 |
| Plan item decision          | 120 |
| Photo metadata              | 117 |
| Progress verification draft |  39 |
| Rolling forecast            |  10 |
| Hidden answer case          |  20 |

Operational snapshot бүр:

- zone, planned/remaining quantity, canonical unit;
- crew ба productivity catalog version;
- equipment availability;
- material availability/reservation;
- zone capacity;
- inspection status;
- approved blocker;
- weather restriction;
- approved actual lineage;
- baseline/schedule/calendar/policy version;
- tenant/project-scoped source reference агуулна.

## 5. Scenario coverage

Planning:

- predecessor unfinished;
- material shortage;
- crew unavailable;
- equipment double-booking;
- zone conflict;
- heavy rain restriction;
- inspection pending;
- critical work omitted;
- partial target;
- approved blocker.

Verification/photo:

- missing report;
- blurry/dark photo;
- duplicate photo;
- previous-day reused photo;
- report/photo mismatch;
- false `COMPLETED`.

Forecast/recovery:

- insufficient productivity data;
- critical delay;
- recovery resource/dependency conflict;
- healthy positive control.

## 6. Deterministic ownership

- Random model output ашиглахгүй.
- OpenAI/Gemini API дуудахгүй.
- `OPENAI_API_KEY` байхгүй үед generation болон evaluation хэвийн ажиллана.
- `deterministic: true`, `llmRequired: false`.
- Target, variance, conflict, completion, forecast status, driver болон source
  lineage нь code/schema-аар үүснэ.
- Same seed нь byte-for-byte ижил package гаргана.

## 7. Replay

`replayBuildWatchOperationalSimulation()` нь сонгосон `asOfDate` хүртэл:

- analysis snapshot;
- operational snapshot;
- daily plan;
- photo metadata;
- verification draft;
- rolling productivity;
- forecast;
- recovery proposal;
- зөвхөн ашиглагдсан source catalog entry

буцаана. Replay count буурахгүй бөгөөд буцаасан aggregate бүр strict Phase 1
schema-аар дахин шалгагдана.

## 8. Dataset үүсгэх

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd run simulation:v22:generate
```

Өөр output/seed:

```powershell
pnpm.cmd run simulation:v22:generate -- --output data/simulation/buildwatch-v22-custom --seed demo-seed
```

Үүсэх файл:

```text
data/simulation/buildwatch-v22/
├── agent-dataset.json
├── private-fixture.json
├── answer-key.json
└── manifest.json
```

`answer-key.json` болон `private-fixture.json`-ийг agent input-д өгч болохгүй.

## 9. Test ба gate

Targeted simulation regression:

```powershell
pnpm.cmd run test:simulation:v22
```

Phase 2 бүрэн gate:

```powershell
pnpm.cmd run phase2:v22:gate
```

Gate дараахыг хамтад нь ажиллуулна:

1. v2.2 documentation validation;
2. strict TypeScript check;
3. Phase 1 shared contract regression;
4. хуучин simulation regression;
5. шинэ operational scenario/replay/security/LLM-off regression.

## 10. Exit gate

- [x] Existing `BuildWatchSimulationV1` contract өөрчлөгдөөгүй.
- [x] `BuildWatchOperationalSimulationV1` strict schema pass.
- [x] 48 work item буюу 40–60 хязгаарт.
- [x] 40 planning day буюу minimum 30-аас их.
- [x] 120 plan item decision буюу minimum 100-аас их.
- [x] 117 photo metadata буюу vision boundary хангалттай.
- [x] 20 required scenario hidden answer key-д бүрэн.
- [x] Positive, negative, boundary control бүртэй.
- [x] Cross-tenant private fixture public agent data-аас тусдаа.
- [x] Expected source ID бүр public source catalog-д бодитоор байна.
- [x] Replay aggregate бүр strict schema pass, count monotonic.
- [x] Same seed byte-for-byte deterministic.
- [x] OpenAI key байхгүй LLM-off test pass.
- [x] TypeScript check pass.
- [x] Хуучин болон шинэ simulation test pass.

## 11. Дараагийн phase

Phase 3 нь энэ answer key-г ашиглан A5 eligibility, priority, daily target болон
conflict detection algorithm-ийг implementation-аар бодитоор гаргаж, generated
expected result-тэй харьцуулна.
