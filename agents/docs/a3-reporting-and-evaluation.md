# A3 — Баримт бичгийн агент ба үнэлгээ

## Зорилго

A3 нь Part 5-ийн deterministic шинжилгээ болон A2-ийн баталгаажсан гаралтыг ашиглан хүний батлах ёстой баримт бичгийн ноорог бэлтгэнэ.

A3 нэг хүсэлтээр дараах гурван баримтыг үүсгэнэ.

| Төрөл                  | Гаралт                               |
| ---------------------- | ------------------------------------ |
| `PROJECT_REPORT`       | Төслийн хяналтын тайлан              |
| `EXECUTIVE_CONCLUSION` | Удирдлагын дүгнэлт, шийдвэрийн санал |
| `OFFICIAL_LETTER`      | Албан бичгийн батлуулах ноорог       |

Агент өөрөө баримт батлахгүй. Шинээр үүссэн бүх draft PostgreSQL-д `PENDING_APPROVAL` төлөвтэй хадгалагдана.

## Ажиллах дараалал

1. On-demand command, request queue эсвэл schedule A3 урсгалыг эхлүүлнэ.
2. `collectReportEvidence` tool tenant/project хүрээнд өгөгдөл, CPM болон issue-г ачаална.
3. Latest `COMPLETED` A2 run байвал зөвлөмжийг нь ашиглана.
4. A2 run байхгүй бөгөөд fallback зөвшөөрсөн бол analysis-only тайлан үүсгэнэ.
5. Бүх тоо, огноо, хувь, CPM болон хэмжүүрийг deterministic өгөгдлөөс авна.
6. LLM ашигласан үед зөвхөн тоогүй чанарын тайлбарын догол мөр бичнэ.
7. Handlebars template HTML гаргаж, Noto Sans фонтыг base64-аар embed хийнэ.
8. Puppeteer HTML-ийг A4 PDF болгоно.
9. Тайлан, дүгнэлт, албан бичгийг `A3DocumentDraft` хүснэгтэд хадгална.
10. Хүн draft бүрийг тусад нь approve эсвэл reject хийнэ.

## A3-ийн tool багц

| Tool                           | Үүрэг                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `collectReportEvidence`        | Tenant scope-той project data, Part 5 CPM, issue болон metrics-ийн эх өгөгдөл цуглуулах |
| `inspectApprovalDrafts`        | A3 draft-ууд болон approval төлөвийг read-only харах                                    |
| Handlebars renderer            | Тоон хүснэгт, тайлангийн HTML үүсгэх                                                    |
| Puppeteer renderer             | Embedded Noto Sans фонттой PDF үүсгэх                                                   |
| `diff` + `fastest-levenshtein` | AI draft болон хүний засварыг харьцуулах                                                |

## On-demand тайлан

A2-ийн хамгийн сүүлийн баталгаажсан run-ийг ашиглах:

```powershell
cd C:\Users\user\Desktop\diplom\agents
pnpm.cmd report -- --project project-atlas --as-of 2026-03-01
```

A2 API quota эсвэл A2 run шаардахгүй offline хэлбэр:

```powershell
pnpm.cmd report -- --project project-atlas --as-of 2026-03-01 --analysis-only
```

PDF алгасах:

```powershell
pnpm.cmd report -- --project project-atlas --as-of 2026-03-01 --analysis-only --no-pdf
```

Гаралтын хавтаст дараах файлууд орно.

- үндсэн JSON artifact;
- project report HTML;
- embedded-font PDF;
- `project-report.md`;
- `executive-conclusion.md`;
- `official-letter.md`;
- `ai-draft.md`;
- `metrics.md`;
- сонгосон үед diff болон judge artifact.

Command дуусахдаа A3 run ID болон гурван draft ID-г хэвлэнэ.

## Scheduled ба request worker

`.env` тохиргоо:

```dotenv
A3_SCHEDULE_CRON="0 7 * * 1"
A3_TIMEZONE="Asia/Ulaanbaatar"
A3_SCHEDULE_PROJECTS="project-atlas"
A3_NO_PDF="false"
A3_AUTOMATION_OUTPUT_ROOT="data/reports/automated"
```

Worker эхлүүлэх:

```powershell
pnpm.cmd a3:worker
```

Өөр terminal-оос хүсэлт queue-д оруулах:

```powershell
pnpm.cmd a3:enqueue -- --project project-atlas --as-of 2026-03-01 --request-id atlas-weekly-report-001
```

A2 run зориуд ашиглахгүй бол:

```powershell
pnpm.cmd a3:enqueue -- --project project-atlas --as-of 2026-03-01 --analysis-only
```

`request-id` нь queue болон DB persistence-ийн idempotency key болно. Ижил ID-тай хүсэлт draft-ийг давхар үүсгэхгүй.

## Approval урсгал

Хүлээгдэж буй draft-ууд:

```powershell
pnpm.cmd a3:drafts
```

Draft батлах:

```powershell
pnpm.cmd a3:review -- --draft <draft-id> --approve --reviewer "Төслийн менежер"
```

Draft буцаах:

```powershell
pnpm.cmd a3:review -- --draft <draft-id> --reject --reviewer "Төслийн менежер" --note "Эх баримтыг дахин нягтална уу"
```

Төлөвийн шилжилт:

```text
PENDING_APPROVAL -> APPROVED
PENDING_APPROVAL -> REJECTED
```

Нэг шийдвэрийг дахин илгээхэд idempotent хариу өгнө. Эсрэг шийдвэрээр аль хэдийн reviewed draft-ийг өөрчлөхгүй.

## LLM тайлбар ба judge

OpenAI ашиглан чанарын тайлбар үүсгэх:

```powershell
pnpm.cmd report -- --project project-atlas --analysis-only --narrative llm
```

LLM-as-judge хамт ажиллуулах:

```powershell
pnpm.cmd report -- --project project-atlas --analysis-only --narrative llm --judge
```

Narrative болон judge нь тусдаа `generateObject` дуудлага. Judge-ийн rubric бүр `1–5` оноо, шалтгаантай бөгөөд `temperature: 0`.

LLM narrative-д тоо, огноо, хувь, мөнгөн дүн орохыг pure TypeScript guard хориглоно. Тоон мэдээлэл зөвхөн deterministic template-ээс гарна.

## AI draft ба хүний засвар

`ai-draft.md`-ийг зассаны дараа:

```powershell
pnpm.cmd report -- --project project-atlas --analysis-only --edited-draft edited-draft.md
```

Гаралт:

- word-level нэмэгдсэн/хасагдсан хэсэг;
- Levenshtein edit distance;
- normalized similarity;
- нэмэгдсэн болон хасагдсан token count.

## Golden dataset

A3 өөрийн `a3-document-agent-v1` suite-тэй.

- ATLAS — бүх эрсдэл, forecast error болон гурван баримт;
- RIVER — issue-гүй зөв гаралт;
- PRIVATE — tenant isolation.

Golden case-уудыг PostgreSQL-д шинэчлэх:

```powershell
pnpm.cmd run seed:a3-eval
```

API ашиглахгүй deterministic үнэлгээ:

```powershell
pnpm.cmd eval:a3
```

Үнэлгээ нь document types, ажил/issue count, CPM duration, risk posture, precision, recall, forecast error, narrative guard, initial approval status-ийг шалгана.

## Part 7 хэмжилт

```powershell
pnpm.cmd eval:agents -- --project project-atlas
```

Гарах хэмжүүр:

- precision;
- recall;
- F1;
- detection lag;
- effective-date MAE;
- CPM forecast error.

## Regression CI

`.github/workflows/regression.yml` нь:

- `workflow_dispatch`-аар гараар;
- prompt агуулсан agent файл өөрчлөгдөхөд;
- default үед API quota ашиглахгүй;
- хүссэн үед `live_llm` сонголтоор OpenAI narrative/judge

ажиллуулна.

## Шалгах команд

```powershell
pnpm.cmd run check
pnpm.cmd exec vitest run tests/reporting
pnpm.cmd eval:a3
pnpm.cmd run seed:verify
pnpm.cmd test
```

## A3 бүрэн болсон шалгуур

- Тайлан, дүгнэлт, албан бичиг үүсгэнэ.
- On-demand, request queue, timezone-aware schedule ажиллана.
- A3 өөрийн evidence/approval tool багцтай.
- HTML, embedded Noto Sans PDF болон Markdown artifact гарна.
- Draft бүр PostgreSQL-д pending approval төлөвтэй хадгалагдана.
- Хүний approve/reject шийдвэр tenant scope-той хадгалагдана.
- AI draft diff болон LLM-as-judge ажиллана.
- Part 7 metrics болон Markdown measurement гарна.
- A3 өөрийн golden dataset/evaluator-той.
- Regression CI default үед төлбөртэй API ашиглахгүй.
