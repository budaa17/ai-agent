# BuildWatch v2.2 — Phase 8 A0/A5 tool layer ба orchestration

**Төлөв:** `COMPLETE` — 2026-08-03  
**Gate:** `pnpm.cmd run phase8:v22:gate`  
**Numeric authority:** `DETERMINISTIC_SERVICES_ONLY`

## 1. Зорилго

Phase 8 нь Phase 3–7-д баталгаажсан deterministic domain service-үүдийг AI
agent-д шууд өгөлгүй, tenant-safe read-only tool boundary болон version-тэй
orchestration run-аар холбоно. Phase 9 хүртэл canonical database биш,
`InMemoryPhase8ReadRepository` болон simulation adapter ашиглана.

Authoritative дүрэм:

```text
authorized tool result эсвэл approved workflow state
→ deterministic service
→ source/number validation
→ human review queue
```

LLM нь тоо бодохгүй, approved baseline өөрчлөхгүй, зөвхөн ирээдүйн optional
explanation adapter байж болно. Golden gate бүхэлдээ `llmMode = OFF` ажиллана.

## 2. A0 read-only tool set — 11/11

| Tool                      | Үүрэг                               | Нэмэлт guard                        |
| ------------------------- | ----------------------------------- | ----------------------------------- |
| `getDesignDocuments`      | Design file metadata/classification | design permission + signed artifact |
| `getDrawingRevisions`     | Revision/effective/supersession     | design permission                   |
| `getDrawingPages`         | Page/source metadata                | design permission + signed artifact |
| `getVerifiedScale`        | Engineer-approved scale             | candidate/rejected scale final биш  |
| `getExtractedElements`    | Reviewed element/dimension          | source-backed artifact access       |
| `getQuantityTakeoff`      | Versioned approved quantity         | tenant/project/version/as-of        |
| `getMaterialNorms`        | Effective approved norm             | catalog scope                       |
| `getMaterialPrices`       | Effective approved price            | catalog + cost permission           |
| `getProductivityRates`    | Approved productivity               | catalog scope                       |
| `getScheduleDependencies` | Work template/dependency            | catalog scope                       |
| `getEstimateAssumptions`  | Tax/contingency/rounding policy     | catalog + cost permission           |

## 3. A5 read-only tool set — 15/15

| Tool                       | Үүрэг                            | Нэмэлт guard                |
| -------------------------- | -------------------------------- | --------------------------- |
| `getCurrentSchedule`       | Current operational schedule     | approved snapshot scope     |
| `getEligibleWorkItems`     | Eligibility/priority decision    | deterministic output        |
| `getRemainingQuantities`   | Remaining source-backed quantity | snapshot version            |
| `getCrewAvailability`      | Crew/productivity capacity       | resource source             |
| `getEquipmentAvailability` | Equipment capacity/window        | resource source             |
| `getMaterialAvailability`  | Available/reserved material      | ledger source               |
| `getWeatherConstraints`    | Weather/logistics restriction    | as-of source                |
| `getOpenBlockers`          | Open approved blocker            | project scope               |
| `getDailyPlan`             | Daily plan draft/version         | review state                |
| `getDailyActuals`          | Approved actual                  | report-text permission      |
| `getPhotoEvidence`         | Photo metadata                   | signed artifact permission  |
| `getProgressVerification`  | Deterministic verification       | approved source lineage     |
| `getRollingProductivity`   | 3/7/14-day pace snapshot         | approved-only samples       |
| `getLatestForecast`        | Projected finish/driver          | deterministic forecast      |
| `getRecoveryScenarios`     | Time/cost/resource impact        | baseline mutation forbidden |

## 4. Authorization boundary

`Phase8ToolGateway` дараах шалгалтыг tool бүр дээр хийдэг:

1. caller tenant нь authority;
2. project нь `allowedProjectIds`-д байх;
3. tool policy-д тохирох role байх;
4. `AGENT_READ` + A0/A5 permission байх;
5. design, cost, report-text permission тусдаа байх;
6. artifact бүхий record бүр valid, хугацаа дуусаагүй signed-read grant-тэй байх;
7. catalog version бүр explicit allow-list-д байх;
8. source бүр tenant/project scope-тэй таарах;
9. `versionId`, `asOf`, item `limit`, `sourceLimit` query-гээс хэтрэхгүй байх;
10. unauthorized record нь `rowCount` болон error message-ээр existence задруулахгүй байх.

Repository зөвхөн `list` read method-тэй. Буцаасан record бүр deep clone тул caller-ийн
mutation canonical in-memory state-д нөлөөлөхгүй.

## 5. A0 staged orchestration

`runA0Orchestration` дараах дараалалтай:

```text
CLASSIFY_DOCUMENTS
→ INSPECT_METADATA_AND_REVISIONS
→ VERIFY_SCALE_AND_ELEMENTS
→ DETERMINISTIC_QUANTITY
→ CATALOG_MAPPING_AND_ESTIMATE
→ WBS_SCHEDULE_AND_CPM
→ VALIDATE_SOURCES_AND_NUMBERS
→ HUMAN_REVIEW_QUEUE
```

- Verified scale tool result байхгүй бол quantity/estimate/schedule/baseline бүгд `null`.
- Candidate set tool result-тэй canonical hash-аар таарна.
- Quantity formula Phase 7 registry-ээр replay хийгдэж approved checkpoint-тэй таарна.
- Norm/price/productivity/policy зөвхөн authorized catalog tool-оос ирнэ.
- Estimate exact decimal engine-ээр replay хийгдэнэ.
- WBS, resource, calendar, FS/SS/FF/SF CPM Phase 7 service-ээр replay хийгдэнэ.
- Quantity, estimate, schedule, baseline нь автоматаар approve болохгүй.
- Review queue нь estimator/project-manager role matrix-тай.

Golden result:

- A0 status: `REVIEW_REQUIRED`;
- tool calls: `11/11`;
- review tasks: `4`;
- issues: `0`;
- metric quantity without verified scale: `0`.

## 6. A5 staged orchestration

`runA5Orchestration` дараах дараалалтай:

```text
LOAD_APPROVED_OPERATIONAL_SNAPSHOT
→ DETERMINISTIC_DAILY_PLAN
→ DETERMINISTIC_PROGRESS_VERIFICATION
→ ROLLING_FORECAST_AND_RECOVERY
→ VALIDATE_SOURCES_AND_NUMBERS
→ HUMAN_REVIEW_QUEUE
```

- Snapshot work item/resource/material/weather/blocker хэсэг tool result-тэй hash-аар таарна.
- `generateA5DailyPlan` eligibility, priority, target, conflict-ийг дахин бодно.
- Daily actual нь approved source, photo metadata нь signed-read boundary-гаар орно.
- Verification, rolling productivity, forecast, recovery нь Phase 4–5 deterministic artifact.
- Recovery proposal бүр `baselineChanged = false`.
- Optional explanation `null`; OpenAI quota шаардахгүй.
- Plan, verification, recovery бүгд human review queue-д орно.

Golden result:

- A5 status: `REVIEW_REQUIRED`;
- tool calls: `15/15`;
- photo/verification available;
- rolling forecast available;
- recovery scenario available;
- issues: `0`.

## 7. Run audit ба version persistence

Run бүр дараах metadata-г immutable output-д хадгална:

- `promptVersion`;
- `modelProvider`;
- `modelName`;
- `modelVersion`;
- `toolContractVersion`;
- `outputSchemaVersion`;
- deterministic service versions;
- input/output SHA-256 бүхий tool-call audit;
- returned record ID;
- source reference ID;
- `llmMode`;
- `numericAuthority`.

LLM-off golden run:

```text
modelProvider = NONE
modelName = DETERMINISTIC_ONLY
modelVersion = llm-off-v1
toolContractVersion = buildwatch-v22-phase8-tools-v1
outputSchemaVersion = 1
```

## 8. Evaluation

Golden suite:

1. A0 document classification;
2. A0 element candidate;
3. scale safety;
4. quantity source grounding;
5. A5 planning;
6. A5 photo/verification;
7. A5 forecast;
8. A5 recovery;
9. tenant isolation;
10. LLM-off fallback.

Adversarial suite:

1. unverified scale block;
2. cross-tenant non-disclosure;
3. project assignment denial;
4. role permission denial;
5. cost permission denial;
6. report-text permission denial;
7. unsigned artifact denial;
8. catalog scope denial;
9. version/as-of/source limit;
10. read-only repository mutation.

Үр дүн:

- Tool coverage: `100.00%` (`26/26`).
- A0 tool coverage: `100.00%` (`11/11`).
- A5 tool coverage: `100.00%` (`15/15`).
- Numeric hallucinations: `0`.
- Unauthorized sources: `0`.
- Unauthorized object disclosures: `0`.
- Tenant-isolation violations: `0`.
- Unsigned artifact leaks: `0`.
- Catalog-scope leaks: `0`.
- Baseline mutations: `0`.
- Golden cases: `10/10 PASS`.
- Adversarial cases: `10/10 PASS`.
- Deterministic replay: `PASS`.
- LLM-off core: `PASS`.
- Run version persistence: `PASS`.

## 9. Code ба test evidence

- Contracts: `src/orchestration/contracts.ts`
- Authorization: `src/orchestration/authorization.ts`
- Immutable repository: `src/orchestration/repository.ts`
- Tool gateway: `src/orchestration/tools.ts`
- AI SDK wrappers: `src/orchestration/wrappers.ts`
- A0 orchestration: `src/orchestration/a0.ts`
- A5 orchestration: `src/orchestration/a5.ts`
- Golden/private fixtures: `src/orchestration/fixtures.ts`
- Evaluation: `src/orchestration/evaluation.ts`
- Regression: `tests/orchestration/phase8.test.ts`
- Generated bundle: `data/buildwatch-v22/phase8-agent-orchestration-bundle.json`
- Evaluation report: `data/evaluations/buildwatch-v22-phase8-orchestration.json`

Requirement evidence: `A0-016`, `A5-001`–`A5-014`, `BE-DESIGN-008`,
`BE-PLAN-007`, `G-01`, `G-09`–`G-12`, `QA-V22-003`–`QA-V22-006`,
`QA-V22-019`.

## 10. Команд

```powershell
pnpm.cmd run orchestrate:v22
pnpm.cmd run test:orchestration:v22
pnpm.cmd run eval:orchestration:v22
pnpm.cmd run phase8:v22:gate
```

`orchestrate:v22` нь API key болон Docker шаардахгүй.

## 11. Phase boundary

Phase 8 нь agent/tool/orchestration logic-ийг production backend-ээс өмнө бүрэн
баталгаажуулсан. Phase 9-д энэ in-memory repository-г canonical database,
transaction/outbox/idempotency, auth/RBAC API, event/job adapter-аар солино. Phase 8
contract болон deterministic service-үүдийг дахин бичихгүй.

## 12. Exit gate

- [x] A0 read-only tool `11/11` бүртгэгдсэн.
- [x] A5 read-only tool `15/15` бүртгэгдсэн.
- [x] Нийт tool нэр давхардалгүй `26/26`.
- [x] Tool input нь version/as-of/item/source limit-тэй.
- [x] Tool output нь schema/tool contract version-тэй.
- [x] Tenant scope context-оос тогтоно.
- [x] Project assignment албадан шалгагдана.
- [x] Role policy tool бүр дээр шалгагдана.
- [x] Design-document permission тусдаа.
- [x] Cost permission тусдаа.
- [x] Report-text permission тусдаа.
- [x] Signed artifact grant хугацаа ба scope-оор шалгагдана.
- [x] Catalog source allow-list шалгагдана.
- [x] Unauthorized object existence задрахгүй.
- [x] Repository read-only, deep-clone isolation-тэй.
- [x] A0 document classification pass.
- [x] A0 revision/page inspection pass.
- [x] Verified scale байхгүй үед metric quantity `0`.
- [x] A0 element candidate grounding pass.
- [x] A0 deterministic quantity replay pass.
- [x] A0 norm/price/productivity mapping pass.
- [x] A0 deterministic estimate replay pass.
- [x] A0 WBS/schedule/CPM replay pass.
- [x] A0 baseline auto-approval `0`.
- [x] A0 human review queue pass.
- [x] A5 operational snapshot grounding pass.
- [x] A5 deterministic daily plan pass.
- [x] A5 photo/verification join pass.
- [x] A5 rolling forecast pass.
- [x] A5 recovery proposal pass.
- [x] A5 baseline mutation `0`.
- [x] Numeric hallucination `0`.
- [x] Unauthorized source `0`.
- [x] Tenant-isolation violation `0`.
- [x] Tool coverage `100.00%`.
- [x] Golden suite `10/10 PASS`.
- [x] Adversarial suite `10/10 PASS`.
- [x] Deterministic replay `PASS`.
- [x] LLM-off core `PASS`.
- [x] Prompt/model/tool/schema version persistence `PASS`.
- [x] Targeted regression `11/11 PASS`.

**PHASE 8 EXIT GATE: PASS**
