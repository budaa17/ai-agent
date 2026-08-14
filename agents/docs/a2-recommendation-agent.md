# A2 — Ажиглагч агент

## Зорилго

A2 нь төслийн одоогийн өгөгдлийг зөвхөн уншиж:

- давтагдсан хэв маяг (`PATTERN`);
- нотолгоонд тулгуурласан үндсэн шалтгаан (`ROOT_CAUSE`);
- ахиц эсвэл зардлын чиг хандлага (`TREND`);
- төслийн эрсдэлийн ерөнхий төлөв;
- асуудал бүртэй холбогдсон зөвлөмжийн ноорог

гаргана.

A2 өөрөө төсөл, ажил, төлөв, төсөв өөрчилдөггүй. Гаралт нь шийдвэр гаргагчид зориулсан **read-only шинжилгээ ба зөвлөмжийн ноорог** юм.

## Хэзээ ажиллах вэ?

A2 гурван төрлийн trigger дэмжинэ.

| Trigger   | Хэзээ                         | Ажиллуулах хэлбэр     |
| --------- | ----------------------------- | --------------------- |
| `MANUAL`  | Хэрэглэгч хүссэн үед          | `pnpm.cmd recommend`  |
| `EVENT`   | Төслийн шинэ үйл явдал ирэхэд | `pnpm.cmd a2:enqueue` |
| `NIGHTLY` | Тохируулсан cron цагт         | `pnpm.cmd a2:worker`  |

`EVENT` болон `NIGHTLY` ажлууд PostgreSQL дээрх `pg-boss` queue-гаар дамжина. Event ID нь давхар job үүсэхээс хамгаалах idempotency key болдог.

## Ажиллах дараалал

1. Trigger нь `a2-observe-project` queue-д job оруулна эсвэл manual command шууд эхлүүлнэ.
2. Worker tenant, project, огнооны хүрээг баталгаажуулна.
3. A2-ийн судалгааны фаз `generateText` ашиглан өөрийн read-only tool-уудыг дуудна. Provider native tool-call-ийг үл хэрэгсвэл deterministic fallback дөрвөн tool-ийг локал read-only ажиллуулна.
4. Part 5 deterministic analyzer CPM болон дүрмийн таван төрлийн issue-г дахин тооцно.
5. Бүтэцлэх фаз `generateObject` ашиглан `RecommendationReport` гаргана.
6. Pure TypeScript grounding validator бүх ID, нэр, огноо, тоо, issue холбоос, source fact-ийг шалгана.
7. Зөв гаралт `COMPLETED`, нотолгооны зөрчилтэй гаралт `REJECTED`, техникийн алдаа `FAILED` төлөвтэй хадгалагдана.
8. `AgentRun` нь нийт run-ийг, `AgentToolCall` нь tool дуудлага бүрийн input/output-ийг хадгална.

## A2-ийн тусдаа tool багц

| Tool                    | Унших өгөгдөл                     | Яагаад хэрэглэдэг вэ?                                         |
| ----------------------- | --------------------------------- | ------------------------------------------------------------- |
| `inspectWorkItems`      | Ажил, төлөв, хугацаа, ахиц, төсөв | Хоцролт, critical ажил, нийт гүйцэтгэлийн хэв маягийг харах   |
| `inspectDependencies`   | Өмнөх/дараагийн ажлын холбоо      | Дараалал зөрчсөн эсэх болон боломжит үндсэн шалтгааныг нотлох |
| `inspectProgressTrends` | Явцын snapshot-ууд                | Ахиц сайжирч, тогтвортой эсвэл муудаж байгааг харьцуулах      |
| `inspectCostVariance`   | Төсөв, бодит зардал, ledger       | Төсөв хэтрэлт болон ledger зөрүүг илрүүлэх                    |

Tool бүр tenant болон project scope-той. A2 өөр tenant-ийн мэдээллийг унших эрхгүй.

## Гаралтын бүтэц

`RecommendationReport` дараах үндсэн хэсэгтэй.

- `executiveSummary` — тоо, огноогүй чанарын товч дүгнэлт.
- `riskBrief.posture` — `CRITICAL`, `HIGH`, `MEDIUM`, `LOW`, эсвэл `NONE`.
- `riskBrief.observations` — `PATTERN`, `ROOT_CAUSE`, `TREND` ажиглалтууд.
- `recommendations` — deterministic issue бүртэй `impactRef`-ээр холбогдсон зөвлөмжийн ноорог.
- `sources` — өгөгдлийн сан болон Part 5 шинжилгээний яг хуулсан fact-ууд.

`TREND` нь дор хаяж хоёр snapshot эсвэл cost entry ашиглана. `ROOT_CAUSE` нь issue-гээс гадна хамаарал, ажил, snapshot зэрэг бодит эх сурвалжтай байна.

## Manual ажиллуулах

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd recommend -- --project project-atlas --as-of 2026-03-01
```

Нэмэлт сонголт:

```powershell
pnpm.cmd recommend -- --model gpt-5.6-sol --max-steps 8 --output data/recommendations/atlas.json
```

JSON artifact нь `data/recommendations` дотор, бүрэн run нь PostgreSQL-ийн `AgentRun` болон `AgentToolCall` хүснэгтэд хадгалагдана.

## Nightly worker

`.env` тохиргоо:

```dotenv
A2_NIGHTLY_CRON="0 1 * * *"
A2_TIMEZONE="Asia/Ulaanbaatar"
A2_SCHEDULE_PROJECTS="project-atlas"
```

Олон төсөл хуваарьлах бол таслалаар тусгаарлана:

```dotenv
A2_SCHEDULE_PROJECTS="project-atlas,project-river"
```

Worker эхлүүлэх:

```powershell
pnpm.cmd a2:worker
```

Worker ажиллаж байх хугацаанд event job болон nightly job хоёуланг боловсруулна.

## Event-ээр ажиллуулах

Эхлээд worker-ийг нэг terminal дээр ажиллуулна:

```powershell
pnpm.cmd a2:worker
```

Дараа нь өөр terminal-оос event оруулна:

```powershell
pnpm.cmd a2:enqueue -- --project project-atlas --event-type PROJECT_UPDATED --event-id project-atlas-update-001 --as-of 2026-03-01
```

Ижил `event-id`-тай event-ийг дахин илгээвэл singleton key нь давхар job-оос хамгаална.

## Golden dataset ба үнэлгээ

A2 нь өөрийн `a2-project-observer-v1` suite-тэй. Suite нь:

- бүх төрлийн эрсдэлтэй ATLAS;
- issue-гүй RIVER;
- өөр tenant-д байрлах PRIVATE

гэсэн гурван deterministic кейсээр risk posture, issue төрөл, observation төрөл, recommendation coverage, grounding-ийг шалгана.

Golden case-уудыг PostgreSQL-д шинэчлэх:

```powershell
pnpm.cmd run seed:a2-eval
```

Хамгийн сүүлийн хадгалсан A2 run-уудыг үнэлэх:

```powershell
pnpm.cmd eval:a2
```

Нэг кейс үнэлэх:

```powershell
pnpm.cmd eval:a2 -- --cases a2-atlas-risk-observation
```

Шинэ OpenAI гаралт үүсгээд үнэлэх:

```powershell
pnpm.cmd eval:a2 -- --live
```

`--live` нь дөрвөн read-only tool-ийг deterministic байдлаар локал ажиллуулаад нэг OpenAI structure call хийдэг. Ингэснээр provider native tool-call дэмжих эсэхээс хамаарахгүй, quota-г давхар зарцуулахгүй. Энгийн `eval:a2` нь хадгалсан run-ийг ашиглах тул шинэ API хүсэлт үүсгэхгүй.

Үнэлгээний JSON болон Markdown тайлан `data/evaluations/a2-latest.*` дотор хадгалагдана. Гол хэмжүүрүүд:

- field accuracy;
- grounding pass rate;
- observation precision/recall;
- recommendation impact precision/recall.

## Шалгах командууд

```powershell
pnpm.cmd run check
pnpm.cmd exec vitest run tests/recommendations
pnpm.cmd test
pnpm.cmd run seed:verify
```

Grounding тестүүд зохиомол тоо, огноо, буруу work item, буруу risk posture, нотолгоогүй trend, нотолгоогүй root cause-ийг зориуд оруулж бүгдийг нь reject хийж байгааг шалгана.

## A2 бүрэн болсон шалгуур

- Manual, event, nightly trigger ажиллана.
- A2 өөрийн дөрвөн read-only tool-той.
- Pattern, root cause, trend тусдаа бүтэцтэй гарна.
- Risk brief болон зөвлөмжийн ноорог гарна.
- Deterministic grounding заавал давна.
- Run, tool call, trigger metadata PostgreSQL-д хадгалагдана.
- A2 өөрийн golden dataset болон evaluator-той.
- A3 шинэ болон өмнөх A2 artifact-ийг унших backward compatibility-той.

OpenAI API түр unavailable эсвэл quota дууссан үед тухайн job `FAILED` болж retry хийгдэнэ. Энэ нь deterministic analyzer, queue, PostgreSQL, grounding болон хадгалсан run-ийг үнэлэх ажиллагаанд саад болохгүй.
