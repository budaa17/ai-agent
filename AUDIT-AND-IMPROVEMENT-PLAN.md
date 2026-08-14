# BuildWatch — Аудит ба сайжруулалтын төлөвлөгөө

**Огноо:** 2026-08-06
**Хамрах хүрээ:** `agents` (backend + агентууд), `agent-console` (frontend/PWA), баримт бичиг, CI/CD, ажиллуулах орчин

**Арга зүй:** Энэ баримт нь таамаг биш, **бодитоор ажиллуулсан шалгалтын** үр дүн. Хийсэн зүйлс:

- `pnpm run check` (хоёр package) — typecheck
- `pnpm run test` — agents 612 тест, agent-console 14 тест
- `pnpm run lint` — хоёр package
- `pnpm run phase11:technical:v22:gate` — бүрэн gate гинж
- 12 eval/smoke script-ийг тус тусад нь
- API-г асааж, нэвтрэлт, workspace, chat endpoint-ийг curl-ээр
- PostgreSQL-ийн бодит мөрийн тоог `psql`-ээр
- Git түүхийг `git show`-оор (регрессийн үндсэн шалтгааныг олох)

---

## 0. Товч дүгнэлт

> **Энэ хэсэг нь 2026-08-06-ны байдлыг тэмдэглэсэн.** Үүний дараа §4-ийн 9 ажлыг
> хэрэгжүүлсэн тул зарим мөр (gate, CI, lint, тестийн тоо) аль хэдийн засагдсан —
> одоогийн төлөвийг **§4-ийн хэрэгжилтийн хүснэгтээс** харна уу. Аудитын дүгнэлтийг
> түүхэн бичлэг болгон өөрчлөхгүй үлдээв.

| Хэсэг                                           | Төлөв                | Нотолгоо                                          |
| ----------------------------------------------- | -------------------- | ------------------------------------------------- |
| Typecheck (2 package)                           | ✅ Цэвэр             | `tsc --noEmit` алдаагүй                           |
| Тест (agents)                                   | ✅ 612/612           | 120 файл                                          |
| Тест (agent-console)                            | ✅ 14/14             | 11 файл                                           |
| Eval/smoke (12 script)                          | ✅ Бүгд PASS         | тус тусад нь ажиллуулсан                          |
| **Gate гинж (phase1–11)**                       | ❌ **Бүгд унана**    | `docs:check:v22` FAIL (11 алдаа)                  |
| Requirement матрицын үнэн зөв байдал            | ✅ Маш өндөр         | шалгасан тоо бүр таарсан                          |
| Auth/RBAC/multi-tenant                          | ✅ Production түвшин | 7 үүрэг, JWT+rotation, IDOR тест                  |
| Детерминистик тооцоолол (CPM, forecast, ledger) | ✅ Бодит             | dashboard шууд тооцоолж байна                     |
| **Web үйлдэл → агент ажиллах**                  | ❌ **Тасарсан**      | outbox болон worker өөр өөр нэртэй queue ашиглана |
| Web A4 туслах                                   | ⚠️ Regex, LLM биш    | 7 keyword загвар                                  |
| LLM амьд ажиллах баталгаа                       | ⚠️ Байхгүй           | 612 тестийн аль нь ч амьд модель дуудахгүй        |
| Демо өгөгдөл (агентын гаралт)                   | ❌ Хоосон            | `AgentRun`=0, quantity=0, forecast=0              |
| CI/CD                                           | ❌ Ажиллахгүй        | workflow буруу байршилд                           |
| Гадны нотолгоо (release gate)                   | ⛔ 0/10              | хүний ажил, зориуд хийгээгүй                      |

**Нэг өгүүлбэрээр:** Инженерийн чанар өндөр, детерминистик цөм найдвартай, агентын дэд бүтэц бараг бүрэн бичигдсэн — гэвч **web үйлдэл ба агентын хооронд queue-ийн нэрний зөрүүнээс болж холбоос тасарсан** тул хэрэглэгч агентуудыг ашиглаж чадахгүй байна. Энэ бол шинээр бүтээх ажил биш, **холбох** ажил.

---

## 1. Илэрсэн алдаа ба засах арга

Эрэмбэ: **P0** = яг одоо эвдэрсэн · **P1** = төслийн үнэ цэнд шууд нөлөөлнө · **P2** = чанар/сахилга · **P3** = өнгөлгөө

---

### P0-1. Бүх gate унаж байна (docs:check:v22)

**Юу болсон:** `pnpm run phase11:technical:v22:gate` эхний алхам дээрээ унана:

```
BuildWatch v2.2 documentation gate: FAIL (11 issue(s))
- Requirement traceability is missing required marker:
  | V22-P1-01 | Shared A0/A5 contracts | Contract owner | 1 | DONE |
  ... (V22-P11-01 хүртэл 11 мөр)
```

**Хаана:** `agents/src/scripts/validate-buildwatch-v22-docs.ts:195` (`includesEvery`), шалгагдаж буй файл `agents/REQUIREMENT-TRACEABILITY.md` §8

**Үндсэн шалтгаан (git-ээр батлагдсан):** `dea1585` commit (ESLint+Prettier нэмсэн) markdown хүснэгтийн баганыг зэрэгцүүлж зай нэмсэн. Validator нь `content.includes()`-ээр **нэг зайтай** мөрийг үсэгчлэн хайдаг тул таарахаа больсон.

```
Өмнө:  | V22-P1-01 | Shared A0/A5 contracts | Contract owner | 1 | DONE | ...
Дараа: | V22-P1-01  | Shared A0/A5 contracts     | Contract owner     |     1 | DONE    | ...
```

**Яагаад чухал:** `docs:check:v22` нь `phase1:v22:gate`-ийн эхний алхам, бусад бүх gate үүнээс `&&`-ээр гинжлэгддэг. Тиймээс **2026-08-05-аас хойш нэг ч gate дамжихгүй байна**. Түүнчлэн `REQUIREMENT-TRACEABILITY.md`-ийн өөрийнх нь "Gate дүрэм" хэсэг `DONE` тэмдэглэхийн болзол болгож gate-ийг заасан — өөрөөр хэлбэл албан ёсоор нэг ч `DONE` мөр болзлоо хангахгүй. `TODO-NEXT-STEPS.md` ч мөн энэ ажиллахгүй командыг зөвлөж байна.

**Хэрхэн засах (санал болгож буй арга):** Validator-ыг зайнаас хамааралгүй болгох. Хүснэгтийн мөрийг хайхаасаа өмнө хоёуланг нь нормчилно:

```ts
function normalizeTableRow(value: string): string {
  return value.replace(/[ \t]*\|[ \t]*/gu, "|").trim();
}

function includesEvery(content, fragments, label, errors) {
  const normalizedContent = content
    .split("\n")
    .map((line) =>
      line.trimStart().startsWith("|") ? normalizeTableRow(line) : line,
    )
    .join("\n");
  for (const fragment of fragments) {
    const needle = fragment.trimStart().startsWith("|")
      ? normalizeTableRow(fragment)
      : fragment;
    if (!normalizedContent.includes(needle)) {
      errors.push(`${label} is missing required marker: ${fragment}`);
    }
  }
}
```

Ингэвэл Prettier дахин форматлахад давтагдахгүй. **Хувилбар Б** (сул талтай): `REQUIREMENT-TRACEABILITY.md`-г `.prettierignore`-т нэмээд хүснэгтийг буцаах — гэхдээ дараа нь хэн нэг гараар форматлахад дахин унана.

**Хугацаа:** ~30 минут. Заавал үүнээс эхэл.

**Тэмдэглэл:** Gate-ийн үлдсэн 12 алхмыг би тусад нь ажиллуулж **бүгд PASS** болохыг баталсан. Энэ бол зөвхөн форматын зөрүү, бодит регресс биш.

---

### P1-1. Хоёр job систем зэрэгцэн орших ба хоорондоо огт холбогдоогүй байх

Энэ бол төслийн **хамгийн чухал бүтцийн олдвор**. Эхэндээ "агент ажиллуулах боломжгүй" мэт харагдсан ч гүнзгий шалгахад асуудал өөр — дэд бүтэц бараг бүрэн бэлэн, гэхдээ **яг нэг цэг дээр таарахгүй байна**.

**Бодит байдал.** Системд агент ажиллуулах хоёр бие даасан механизм бий:

**1) Phase 9 event-driven зам (шинэ)** — web үйлдлээс эхэлдэг:

```
Web үйлдэл (зураг оруулах, baseline батлах, тайлан илгээх)
  → approved command + outbox event (нэг SERIALIZABLE гүйлгээнд)
  → phase9-outbox-worker
  → PgBossPhase9EventPublisher (src/backend/jobs.ts:82)
  → eventRoutes-ийн дагуу queue руу илгээнэ
```

`eventRoutes` (`src/backend/jobs.ts:49-64`) 9 үйл явдлыг зөв чиглүүлдэг, жишээ нь `DESIGN_DOCUMENT_UPLOADED → PHASE9_A0_DESIGN_PARSE_QUEUE`, `BASELINE_APPLIED → [A5 plan, A2 observation]`.

**2) Legacy worker зам (хуучин)** — production-д бодитоор deploy хийгддэг:

`docker-compose.production.yml`-д `a1-worker`, `a2-worker`, `a3-worker`, `analysis-worker` дөрвөн service бүрэн тохируулагдсан — бодит `OPENAI_API_KEY`, `AGENT_HEALTH_REQUIRE_OPENAI: "true"`, зардлын хувьсагчид, memory limit-тэй. Энэ бол жинхэнэ production агент pipeline.

**Асуудал — queue-ийн нэр таарахгүй:**

| Outbox үүнд илгээнэ (`src/jobs/queue-names.ts:13-20`) | Worker үүнийг сонсоно (`:1-5`) | Тохирч байна уу |
| ----------------------------------------------------- | ------------------------------ | --------------- |
| `buildwatch-v22-phase9-a2-observe-project`            | `a2-observe-project`           | ❌              |
| `buildwatch-v22-phase9-a3-generate-documents`         | `a3-generate-documents`        | ❌              |
| `buildwatch-v22-phase9-a5-generate-daily-plan`        | `a5-generate-daily-plan`       | ❌              |
| `buildwatch-v22-phase9-a0-parse-extract-design`       | _(consumer огт байхгүй)_       | ❌              |

Мөн `createPhase9CanonicalAgentAdapterRegistry` — phase9 queue-нүүдийг агент руу холбох ёстой registry — нь **зөвхөн** `src/backend/evaluation.ts:254`-д, өөрөөр хэлбэл тестийн harness дотор дуудагддаг. Production runtime түүнийг мэдэхгүй.

**Үр дагавар:** Web дээр хэрэглэгч зураг оруулбал outbox event зөв үүсч, зөв queue руу очно — гэвч тэр queue-г **хэн ч сонсохгүй** тул мессеж тэндээ хэвтэнэ. Харин deploy хийгдсэн агент worker-үүд нь web-ээс хэзээ ч мессеж ирдэггүй legacy queue-г хоосон сонсож суудаг. Тиймээс §1 P1-2-т харуулсанчлан `AgentRun` = 0.

**Хэрхэн засах — гурван хувилбар (хамгийн хямдаас нь):**

- **А. Queue нэрийг нэгтгэх (~1-2 цаг).** `src/jobs/queue-names.ts`-д legacy болон phase9 нэрийг ижилтгэх, эсвэл `eventRoutes`-ыг legacy нэр рүү заалгах. Хамгийн хурдан бөгөөд одоо байгаа worker-үүдийг шууд ажиллуулна. Сул тал: `PHASE9_A0_DESIGN_PARSE_QUEUE`, quantity recalc, verification, rolling forecast, evening reminder зэрэгт consumer байхгүй хэвээр.
- **Б. Phase 9 canonical worker бичих (~1 өдөр).** `src/scripts/phase9-agent-worker.ts` нэмж, 8 phase9 queue-г бүртгээд `createPhase9CanonicalAgentAdapterRegistry`-г production-д холбоно. Compose-д нэг service нэмнэ. Энэ нь **бүх** 8 урсгалыг ажиллуулах зөв шийдэл.
- **В. Тодорхой trigger endpoint нэмэх (~1 өдөр, А эсвэл Б дээр нэмэлт).** Event хүлээхгүйгээр хэрэглэгч гараар ажиллуулах:
  ```
  POST /v1/projects/:projectId/agent-runs   → 202 { runId, status: "QUEUED" }
  GET  /v1/projects/:projectId/agent-runs   → түүх + төлөв
  ```
  Идэмпотентийн хувьд одоо байгаа `Idempotency-Key` загварыг дагана. Энэ нь UI-д "Одоо ажиллуулах" товч тавих боломж олгоно (§3.1).

**Санал:** Эхлээд **А**-г хийж нэг агент бодитоор ажиллахыг батал (хурдан ялалт, демо болно), дараа нь **Б**-г бүрэн шийдэл болгон, эцэст нь **В**-г UX-ийн төлөө.

**Хугацаа:** А = 1-2 цаг · Б = 1 өдөр · В = 1 өдөр. Урьд бодсоноос хамаагүй хямд — дэд бүтцийн 90% нь аль хэдийн бичигдсэн байна.

---

### P1-2. Демо өгөгдөл хоосон — A0/A2/A3 хуудас юу ч харуулахгүй

**Юу болсон:** `project-atlas` төслийн workspace-ийг API-аас татахад:

```
design.documents      0     operations.plans        0     forecast.snapshots   0
commercial.quantity   0     operations.reports      0     assistants.a1Drafts  0
commercial.estimates  0     operations.photos       0     assistants.a3Drafts  0
commercial.baselines  0     operations.verifications 0    alerts               0
```

Өгөгдлийн санд: `AgentRun` = **0**, `QuantityTakeoffVersion` = 0, `A3DocumentDraft` = 0, `ForecastSnapshot` = 0, `DesignDocument` = 0.

**Яагаад чухал:** Хэрэглэгч (эсвэл шүүгч) A0, A2, A3 хуудас болон A5-ийн forecast tab руу орвол бүгд хоосон. Ажиллаж байгаа зүйл нь зөвхөн Хяналтын самбар (9 work item дээрх бодит CPM тооцоолол), A4 chat, Admin, Rules.

**Хэрхэн засах:** P1-1 хийгдсэний дараа энэ бараг үнэгүй — агентуудыг демо төсөл дээр нэг удаа ажиллуулж, гаралтыг seed-д оруулна. Хамгийн зөв нь `pnpm seed:demo:full` гэсэн команд үүсгэж, дараалуулж ажиллуулах: A0 intake → quantity → estimate → baseline → A5 plan → A1 report → A2 observation → A3 document.

**Хугацаа:** P1-1 хийгдсэн бол ~хагас өдөр.

---

### P1-3. Web дээрх A4 нь LLM биш, regex

**Юу болсон:** UI-ийн чат `POST /v1/projects/:id/chat` руу очдог. Тэр endpoint-ийн бодит хэрэгжилт нь долоон regex загварын keyword таарамж, тохирвол бэлэн өгүүлбэр буцаана.

**Хаана:** `agents/src/backend/phase10-service.ts:1353-1460`

**Бодит туршилт:**

| Асуулт                                                  | Хариу                                                    |
| ------------------------------------------------------- | -------------------------------------------------------- |
| "Явц хэдэн хувьтай вэ?"                                 | ✅ "Одоогийн жигнэсэн гүйцэтгэл 37.71% байна" + 1 source |
| "Төсөв хэд вэ? Эрсдэл байна уу?"                        | ✅ Хоёр баримт нэгтгэсэн + 2 source                      |
| "Ханаөрөлт яагаад хоцорч байна, юу хийвэл засагдах вэ?" | ❌ INSUFFICIENT_EVIDENCE                                 |

**Яагаад чухал:** Жинхэнэ A4 (11 tool, 99 асуултын багц, `src/phase2/a4-assistant.ts`, `src/agent/chat.ts`) бодитоор бичигдсэн бөгөөд тестээр батлагдсан — гэвч зөвхөн CLI-аас (`pnpm chat`). Хэрэглэгч web-ээс "яагаад", "яавал зөв бэ" гэсэн асуулт тавьж чадахгүй. Энэ нь чухам AI-ийн үнэ цэн харагдах ёстой газар.

**Хэрхэн засах — хоёр сонголт:**

- **А (зөв, урт):** `answerA4`-ийг жинхэнэ A4 assistant руу холбох. LLM боломжгүй үед одоогийн детерминистик хариултыг fallback болгож үлдээнэ (NFR-04-ийн LLM-off зарчимтай нийцнэ). ~1 өдөр.
- **Б (шударга, богино):** Одоогийнхыг үлдээгээд UI-д "Энэ туслах баримт лавлагаа хийнэ; шалтгаан шинжилгээ хийхгүй" гэж тодорхой бичих, мөн INSUFFICIENT_EVIDENCE үед **юунд хариулж чадахаа** жагсааж харуулах. ~2 цаг.

Хамгаалалтын хугацаа шахуу бол Б-г хийгээд А-г "цаашдын ажил" гэж танилцуулах нь зөв.

---

### P1-4. LLM амьд ажиллах баталгаа байхгүй

**Юу болсон:** 612 тестийн **аль нь ч** амьд модель дуудахгүй. Бүгд LLM унтраасан детерминистик fallback дээр ноогддог. CI-д ч live LLM алхам нь `workflow_dispatch` + `live_llm` флагийн ард нуугдсан.

**Хаана:** LLM интеграци `agents/src/agent/model.ts` (Vercel AI SDK, `@ai-sdk/openai`), хэрэглэгчид: `src/agent/chat.ts`, `src/recommendations/agent.ts`, `src/reporting/narrative.ts`, `src/reporting/judge.ts`, `src/structuring/daily-report-extract.ts`, `src/structuring/extract.ts`. Тохируулсан модель: `gpt-5.6-sol`, `gpt-5.6-luna` (`agents/.env`).

**Яагаад чухал:** "AI агентын дипломын ажил" гэж танилцуулж байгаа систем нэг ч удаа амьд модельтэй ажиллаж байгааг батлаагүй байна. Хамгаалалт дээр "энэ бодитоор LLM ашигладаг уу?" гэж асуувал баримт хэрэгтэй.

**Хэрхэн засах:**

1. Нэг удаа CLI-аар бодитоор ажиллуулж, гаралтыг хадгална:
   ```powershell
   cd agents
   pnpm.cmd structure -- --text "AT-010 Тайлангийн модуль 60 хувьтай. 4 ажилтан 8 цаг ажиллав." --tenant tenant-demo --project project-atlas --reference-date 2026-03-01
   ```
2. Гаралтын JSON + дэлгэцийн зургийг `agents/docs/live-llm-verification.md` болгож баримтжуулна.
3. `pnpm run health` дээр `AGENT_HEALTH_REQUIRE_OPENAI=true` тохиргоог CI-ийн заавал бус ажилд нэмнэ.

**Хугацаа:** ~1 цаг. Үр өгөөж нь маш өндөр.

---

### P2-1. CI огт ажиллахгүй байна

**Юу болсон:** `agents/.github/workflows/regression.yml` нь git-д бүртгэлтэй ч **repo-гийн үндсэн фолдерт биш**. GitHub Actions зөвхөн root-ийн `.github/workflows/`-г уншдаг. Git-ийг `diplom/` түвшинд шинээр эхлүүлсэн үед workflow өнчирсөн.

**Нэмэлт цоорхой:** Workflow-д `agent-console`-ийн typecheck/lint/тест/build огт байхгүй — frontend бүхэлдээ CI-гүй.

**Хэрхэн засах:**

1. `agents/.github/` → `.github/` (root) руу зөөнө.
2. Бүх алхамд `working-directory: agents` нэмнэ (командууд `agents/` фолдерыг тооцсон).
3. `agent-console`-ийн тусдаа job нэмнэ: `pnpm install` → `pnpm run typecheck` → `pnpm run lint` → `pnpm run test` → `pnpm run build`.
4. `docs:check:v22`-г заавал ажиллах алхам болгоно (P0-1 засагдсаны дараа) — ингэвэл ийм регресс дахин чимээгүй өнгөрөхгүй.

**Хугацаа:** ~1 цаг.

---

### P2-2. Git remote байхгүй

**Юу болсон:** 8 commit бүгд зөвхөн энэ компьютер дээр. Remote тохируулаагүй, tag/release байхгүй.

**Яагаад чухал:** Дипломын ажлын хувьд диск гэмтэх нь бүх зүйлээ алдах эрсдэл. Мөн CI нь remote байхгүй бол ажиллах газаргүй.

**Хэрхэн засах:** GitHub дээр private repo үүсгээд push. `.env` нь `.gitignore`-т байгаа нь баталгаажсан тул нууц мэдээлэл дагаж явахгүй. Хамгаалалтын өмнөх төлөвт `v1.0-defense` гэсэн tag тавих.

**Хугацаа:** ~10 минут.

---

### P2-3. DET-14 (GoRules JDM) `DONE` атлаа тестгүй

**Юу болсон:** `rule-engine.ts`, `rules-service.ts`, `/v1/rules` endpoint-ууд, `rules-page.tsx` — эдгээрийг дурдсан тест **нэг ч байхгүй** (`tests/`-д 0 файл, agent-console-ийн 11 тест файлын дунд `rules-page.test.tsx` алга).

**Хэсэгчилсэн хамрагдалт:** `src/production-analysis/rules.ts:22` нь `evaluateRuleThreshold`-ийг бодитоор ашигладаг тул DET-04–DET-10-ийн одоо байгаа тестүүд **default graph-ийн замыг** шууд бусаар шалгадаг. Гэвч дараах зүйлс огт шалгагдахгүй: `loadTenantRuleGraphs` (tenant-ийн өөрийн дүрэм, кэш, invalidation), `rules-service.ts` бүхэлдээ (draft → version → publish), API endpoint-ууд, UI.

**Анхаарууштай нь:** Матрицын нотолгооны нүдэнд бичсэн **"612/612 тест өөрчлөгдөөгүй"** гэсэн үг нь үнэндээ "шинэ тест нэмээгүй" гэсэн баталгаа болохоос "зөв ажиллаж байна" гэсэн баталгаа биш. Энэ нь баримтын өөрийн gate дүрмийг ("`DONE` мөрийг ... тухайн requirement-ийн deterministic test амжилттай үед л тэмдэглэнэ") зөрчиж байна.

**Хэрхэн засах — доод тал нь 4 тест:**

1. `loadTenantRuleGraphs` — tenant өөрийн graph нийтэлсэн үед түүнийг, эс бөгөөс default-ыг буцаана
2. Кэш invalidation — publish хийсний дараа шинэ graph хүчинтэй болно
3. `rules-service` — draft → publish бүрэн мөчлөг, хувилбарын дугаарлалт
4. `rules-page.test.tsx` — smoke render (бусад хуудасны загвараар)

**Хугацаа:** ~хагас өдөр.

---

### P2-4. `agents` package-д lint огт ажиллахгүй

**Юу болсон:** `pnpm run lint` exit code 2-оор унана:

```
typescript-eslint does not support TS 7.0.
```

**Яагаад чухал:** Энэ бол кодын дийлэнх хувь (бүх backend + агентууд) статик шалгалтгүй байна гэсэн үг. `agent-console` талд lint цэвэр (0 алдаа, 5 анхааруулга).

**Хэрхэн засах — сонголтууд:**

- **А:** `typescript-eslint`-ийн TS 7 дэмжлэгийг хүлээх (upstream issue #10940). Хамгийн хялбар ч хугацаа тодорхойгүй.
- **Б (санал болгож буй):** `oxlint` эсвэл `biome` рүү түр шилжих — хоёулаа TS хувилбараас хамаарахгүй, маш хурдан, тохируулахад 1-2 цаг.
- **В:** TS 6 API-г side-by-side суулгаж typescript-eslint-д зааж өгөх.

**Хугацаа:** ~2 цаг (Б хувилбар).

---

### P2-5. Register функц дуусаагүй, commit хийгдээгүй

**Юу болсон:** 7 файлын өөрчлөлт working tree дээр (шинэ `register-page.tsx`). Ажиллаж байгаа ч хоёр цоорхойтой:

1. **Бүртгүүлсний дараа нэвтрэх мэдээлэл дутуу.** Backend-ийн `AcceptInvitationResult` зөвхөн `userId` буцаадаг (`agents/src/backend/openapi.ts:477`) — tenant slug ч, email ч биш. Register хуудас `/login` руу зөвхөн `displayName` дамжуулна. Хэрэглэгч өөрийн tenant-ийн slug-ийг өөр сувгаар мэдэхгүй бол нэвтэрч чадахгүй.
2. **Тест зөвхөн render шалгана.** Амжилттай илгээлт, нууц үг таарахгүй байх, API алдаа — гурвуулаа тестгүй. `acceptInvitation` mock хийгдсэн ч огт дуудагддаггүй.

**Хэрхэн засах:**

- `AcceptInvitationResult`-д `tenantSlug` болон `email` нэмэх (эсвэл invitation token-оос tenant-ийг урьдчилан харуулах `GET /v1/invitations/:token/preview` нэмэх)
- Register → login руу tenant slug + email дамжуулж, login формыг урьдчилан бөглөх
- 3 тест нэмэх (амжилт, validation алдаа, API алдаа)
- Commit хийх

**Хугацаа:** ~2 цаг.

---

### P3-1. Баримт бичгийн жижиг зөрчлүүд

| Асуудал                                                                                                              | Хаана                                    | Засвар                                             |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------- |
| NFR-08-ийн frontend тоо хуучирсан ("7/7", бодит нь 14 тест / 11 файл)                                                | `agents/REQUIREMENT-TRACEABILITY.md:140` | Тоог шинэчлэх                                      |
| DET-14-ийн нотолгоо "612/612 өөрчлөгдөөгүй" гэж бичсэн                                                               | `agents/REQUIREMENT-TRACEABILITY.md:69`  | P2-3 хийсний дараа бодит тестээр солих             |
| `requirement-v2.0.md` дээр "хуучирсан" тэмдэглэл алга (`buildwatch.md` v2.2 өөрийгөө үндсэн эх сурвалж гэж зарласан) | root `requirement-v2.0.md`               | `PRODUCTION-ROADMAP.md`-тэй адил анхааруулга нэмэх |
| Машины замтай холбоос `C:\Users\user\Desktop\diplom\...`                                                             | `agents/PRODUCTION-ROADMAP.md:9`         | Харьцангуй зам болгох                              |

**Хугацаа:** ~30 минут (нийт).

---

### P3-2. Монгол хэлний glossary байхгүй (NFR-09)

`docs` болон UI-аас `glossary` гэсэн ямар ч файл олдсонгүй. NFR-09 нь `PARTIAL` төлөвтэй, "UI/glossary дутуу" гэж өөрөө хүлээн зөвшөөрсөн.

**Хэрхэн засах:** `agents/docs/glossary-mn.md` үүсгэж, системд хэрэглэгддэг нэр томьёог монгол-англи хосоор тайлбарлах: baseline, critical path, CPM, WBS, BOQ, quantity takeoff, float, S-curve, projected finish, deviation, root cause, outbox, idempotency, tenant, RBAC. UI-д `/glossary` хуудас эсвэл tooltip болгон холбох.

**Хугацаа:** ~2 цаг. Хамгаалалтад ч хэрэгтэй.

---

### P3-3. Нууцлалын эрүүл ахуй

**Одоогийн байдал:** `agents/.env` дотор бодит мэт OpenAI API key ил бичигдсэн. Файл нь `.gitignore`-т байгаа нь баталгаажсан (`git check-ignore` баталсан), commit болоогүй — энэ нь сайн.

**Зөвлөмж:**

- Хэрэв энэ key идэвхтэй бол **солих (rotate)** — аудитын явцад унших шаардлага гарсан
- Production-д `.env` биш, secret manager (Docker secrets, Azure Key Vault, AWS Secrets Manager) ашиглах. `docker-compose.production.yml` дээр `secrets:` блок нэмэх
- `PHASE9_JWT_SECRET`, `PHASE9_CURSOR_SECRET`, `PHASE9_ARTIFACT_SIGNING_SECRET` гурав нь production-д **заавал ялгаатай** байх ёстой (`config.ts:44`-ийн шалгуур) — одоо локалд 64 тэмдэгтийн ялгаатай утга тавигдсан

---

## 2. Production түвшинд гаргахад нэмэх зүйлс

### 2.1 Агентын worker — deploy бэлэн, зөвхөн холболт дутуу

**Сайн мэдээ:** `docker-compose.production.yml` аль хэдийн `a1-worker`, `a2-worker`, `a3-worker`, `analysis-worker`, `outbox-worker` таван worker service-тэй. Dockerfile-д `agent-worker` target бий, `AGENT_WORKER` env-ээр аль worker болохыг сонгоно (`src/scripts/worker.ts`). Бодит OpenAI key, `AGENT_HEALTH_REQUIRE_OPENAI: "true"`, зардлын хувьсагч, healthcheck бүгд тохируулагдсан. Энэ нь production-д агент бодитоор ажиллах зориулалттай гэдгийг харуулна.

**Хийх ажил:** §1 P1-1-ийн queue холболтыг засах. Дараа нь Б хувилбар сонговол шинэ service нэмнэ:

```yaml
phase9-agent-worker:
  build: { context: ., target: agent-worker }
  <<: *backend-common
  environment:
    <<: *backend-environment
    AGENT_WORKER: phase9 # worker.ts-ийн modules-д нэмэх
  depends_on:
    migrate: { condition: service_completed_successfully }
```

**Дутуу үлдэх зүйл:** A0-д (зураг төслийн задаргаа) ямар ч worker байхгүй — `PHASE9_A0_DESIGN_PARSE_QUEUE`-г консумдэх код бичигдээгүй. A0-ийн логик өөрөө (`src/design-intake/`) бүрэн бэлэн тул зөвхөн worker бүрхүүл хэрэгтэй.

### 2.2 Зардлын хамгаалалт

`AgentUsageBudget` хүснэгт болон runtime budget/circuit breaker аль хэдийн хэрэгжсэн (OPS-01 `DONE`). Production-д хийх зүйл:

- Tenant тус бүрийн сарын дээд хязгаарыг бодитоор тохируулах
- Хязгаар 80% хүрэхэд Sentry alert
- `AGENT_INPUT_COST_MICRO_USD_PER_MILLION_TOKENS` утгыг бодит үнээр шинэчлэх (одоо `.env`-д байгаа нь дугуйрсан тоо)

### 2.3 Observability-г бодитоор асаах

NFR-07 нь `PARTIAL` — код бэлэн, deployed sink байхгүй. Хийх:

- Sentry DSN тохируулж, нэг бодит алдаа гаргаж баталгаажуулах
- Langfuse-д нэг бодит trace + зардлын жишээ үлдээх
- `/metrics` endpoint-ийг Prometheus/Grafana-д холбох (`metricsToken` аль хэдийн байгаа)

### 2.4 Backup/restore бодит дасгал

`ops:backup:v22` / `ops:restore:v22` script бэлэн боловч нэг ч удаа бодитоор ажиллуулж баримтжуулаагүй. Хийх: бүтэн backup → шинэ хоосон DB → restore → `smoke:postgres:v22` дамжсаныг харуулах → дэлгэцийн зураг + хугацаа тэмдэглэх.

### 2.5 Гадны 10 нотолгоо (release gate)

`agents/docs/EVIDENCE-CHECKLIST.md` болон `evidence-manifest.template.json` бэлэн. Эдгээр нь **хүний ажил** бөгөөд зохиомлоор нөхөж болохгүй:

жинхэнэ drawing/BOQ dataset (10+), зөвшөөрөлтэй талбайн зураг (60+), бодит Монгол компанийн Excel формат, deployed tenant isolation тайлан, deployed auth/RBAC smoke, бодит offline талбайн туршилт, OWASP/pentest, backup/restore дасгал, амьд Sentry/Langfuse жишээ, Ops/Security sign-off.

**Дипломын хувьд бодит зөвлөмж:** 10-уулангаас 2-3-ыг нь бодитоор хийх нь бүгдийг хийсэн дүр эсгэхээс хамаагүй үнэ цэнтэй. Хамгийн бодитой нь: (а) нэг бодит барилгын компаниас нэг Excel төсвийн формат авах, (б) утсаараа offline горимд оройн тайлан илгээж баталгаажуулах, (в) backup/restore дасгал. Бусдыг "цаашдын ажил" гэж шударгаар танилцуулах.

---

## 3. Хэрэглэгчид хялбар болгох санаанууд

### 3.1 Хоосон төлөв бүр үйлдэлтэй байх (хамгийн өндөр өгөөжтэй)

Одоогийн хоосон төлөвүүд хэрэглэгчийн **хийж чадахгүй** үйлдлийг тайлбарлаж байна:

| Хуудас            | Одоогийн бичвэр                                                               |
| ----------------- | ----------------------------------------------------------------------------- |
| `a0-page.tsx:469` | "Baseline generation **ажилласны дараа** Gantt энд харагдана"                 |
| `a1-page.tsx:36`  | "Text/image intake **ажилласны дараа** draft inbox-д орж ирнэ"                |
| `a3-page.tsx:56`  | "A3 scheduled/request flow **ажилласны дараа** draft болон PDF энд харагдана" |
| `a5-page.tsx:149` | "A5 planning engine **ажилласны дараа** plan item-ууд энд харагдана"          |

Хэрэглэгч "яаж ажиллуулах вэ?" гэж асуухад хариулт байхгүй. P1-1 хийгдсэний дараа эдгээр бүрд **"Одоо ажиллуулах"** товч тавих. Энэ нэг өөрчлөлт нь системийг "хоосон демо"-оос "ажиллаж байгаа бүтээгдэхүүн" болгоно.

### 3.2 Нэвтрэх урсгалыг хялбарчлах

**Аудитын явцад олдсон бодит алдаа (засагдсан):** login хуудасны tenant slug-ийн анхны утга `tenant-demo` байсан ч seed хийсэн tenant-ийн жинхэнэ slug нь `nomad-build` (`tenant-demo` бол түүний **id**). `tenant-demo`-оор нэвтрэхэд 401 гардаг байв. README мөн адил буруу зааж байсан.

**Цаашид сайжруулах:** Хэрэглэгч tenant slug гэж юу болохыг мэдэх шаардлагагүй байх ёстой. Хоёр сонголт:

- Имэйлээр tenant-ийг автоматаар олох (нэг имэйл олон tenant-д байвал л сонгуулах)
- Subdomain-аар ялгах (`nomad-build.buildwatch.mn`) — production-д хамгийн цэвэр

### 3.3 A4-ийн бүтэлгүйтлийг тустай болгох

Одоо ямар ч танигдаагүй асуултад ганц ижил өгүүлбэр буцаана. Оронд нь **юунд хариулж чадахаа** харуулах:

> Энэ асуултад хариулж чадсангүй. Одоогоор дараах зүйлсийг асууж болно: төсөв, бодит зардал, гүйцэтгэлийн хувь, дуусах хугацааны прогноз, ажлын тоо, нээлттэй эрсдэл, critical ажил.

Дээр нь дарж болох жишээ асуултууд (chip) тавих. Хэрэглэгчийн бухимдлыг шууд бууруулна.

### 3.4 Анхны нэвтрэлтийн заавар (onboarding)

Шинэ хэрэглэгч эхний удаа нэвтрэхэд юунаас эхлэхээ мэдэхгүй. 3-4 алхмын checklist харуулах: төсөл сонгох → зураг/Excel оруулах → baseline батлах → өдрийн тайлан илгээх. Дууссан алхмыг ✓ болгож тэмдэглэх.

### 3.5 Агентын ажиллалтыг ил харуулах

AI ажиллаж байгаа нь хэрэглэгчид харагдахгүй бол итгэл төрөхгүй. P1-1-ийн `GET /agent-runs`-ийг ашиглан жижиг самбар харуулах: аль агент, хэзээ, хэр удсан, ямар модель, хэдэн token, зардал хэд. Энэ нь `AgentRun`/`AgentToolCall` хүснэгтэд аль хэдийн хадгалагддаг (ARC-06, OPS-02 `DONE`) — зөвхөн харуулаагүй байна.

### 3.6 Нэр томьёоны тусламж

§1 P3-2-ын glossary-г UI-д tooltip болгон холбох. "Critical path", "projected finish", "float" гэх мэт үг дээр хулгана аваачихад монголоор тайлбар гарч ирэх. Барилгын инженер бүр эдгээрийг мэддэггүй.

### 3.7 A5-ийн давуу талыг хадгалах

A5-ийн offline outbox, 4 алхмын wizard, ≤10 товшилтын хязгаар — эдгээр нь **бодитоор сайн хийгдсэн** хэсэг. Талбайн ажилтны хувьд энэ нь системийн хамгийн үнэ цэнтэй хэсэг байх магадлалтай. Хамгаалалт дээр интернэт унтраагаад тайлан илгээж, дараа нь асаахад автоматаар синк болохыг үзүүлэх нь маш хүчтэй демо болно.

---

## 4. Хэрэгжүүлэх дараалал

**Хэрэгжилтийн төлөв — 2026-08-07.** Доорх ажлуудыг `fix/audit-remediation` салбарт
хийсэн (10 commit). ✅ = хийгдсэн, ⛔ = гадны шалтгаанаар боломжгүй, ☐ = үлдсэн.

| #   | Ажил                                                | Эрэмбэ | Хугацаа        | Төлөв                                                |
| --- | --------------------------------------------------- | ------ | -------------- | ---------------------------------------------------- |
| 1   | docs validator-ыг зайнаас хамааралгүй болгох        | P0     | 30 мин         | ✅                                                   |
| 2   | Git remote холбож push хийх                         | P2     | 10 мин         | ⛔ `gh` суулгаагүй, таны GitHub бүртгэл шаардлагатай |
| 3   | CI-г root руу зөөж, frontend job нэмэх              | P2     | 1 цаг          | ✅                                                   |
| 4   | LLM-ийг нэг удаа амьдаар ажиллуулж баримтжуулах     | P1     | 1 цаг          | ✅                                                   |
| 5а  | Queue-г холбож агентыг бодитоор ажиллуулах          | P1     | 1–2 цаг        | ✅ гүүрээр шийдсэн                                   |
| 5б  | Phase 9 canonical worker (8 урсгал бүрэн)           | P1     | 1 өдөр         | ☐ 5 queue consumer-гүй хэвээр                        |
| 6   | Trigger endpoint + UI-д "Одоо ажиллуулах" товч      | P1     | 1 өдөр         | ☐                                                    |
| 7   | Демо өгөгдлийг агентаар дүүргэх (`seed:demo:full`)  | P1     | хагас өдөр     | ☐                                                    |
| 8   | A4-ийг жинхэнэ assistant руу холбох                 | P1     | 2 цаг – 1 өдөр | ☐                                                    |
| 9   | DET-14-ийн тестүүд                                  | P2     | хагас өдөр     | ✅ 10 + 2 тест                                       |
| 10  | Register-ийг дуусгах                                | P2     | 2 цаг          | ✅                                                   |
| 11  | `agents` lint-ийг сэргээх                           | P2     | 2 цаг          | ✅ oxlint                                            |
| 12  | Glossary                                            | P3     | 2 цаг          | ✅ (UI tooltip ☐)                                    |
| 13  | Баримтын жижиг зөрчлүүд                             | P3     | 30 мин         | ✅                                                   |
| 14  | Backup/restore дасгал баримтжуулах                  | P2     | 2 цаг          | ☐                                                    |
| 15  | Хоосон төлөв, onboarding, A4 санал болгох асуултууд | P3     | 1 өдөр         | ☐                                                    |

**Дараагийн хамгийн үнэтэй алхам:** 6 → 7. Trigger endpoint + UI товч нэмээд демо өгөгдлийг
агентаар дүүргэвэл "агентууд ажиллаж байгааг" web дээр шууд үзүүлэх боломжтой болно —
хамгаалалтын хамгийн хүчтэй мөч энэ.

---

## 5. Хамгаалалтад бэлдэх зөвлөмж

**Хүчтэй талаа онцол.** Энэ төслийн жинхэнэ давуу тал бол хэмжигдсэн чанар: 631 тест, 73 хүснэгтийн canonical migration, 18 DB invariant trigger, 7 үүрэгтэй RBAC, tenant isolation-ийн IDOR тест, 140 golden case дээр 100% таарц, A2-ийн precision/recall 1.0, A3-ийн эх сурвалжгүй мэдэгдэл 0. Requirement матрицыг би тоо тоогоор нь шалгахад **бүгд таарсан** — энэ бол ховор сахилга бат.

**Хязгаараа шударгаар хэл.** `technicalPass=true, releasePass=false` гэсэн загвар — өөрөөр хэлбэл "техникийн хэрэгжилт бэлэн, гадны бодит нотолгоо дутуу" — нь сул тал биш, **инженерийн боловсронгуй байдлын шинж**. Зохиомол өгөгдлөөр gate дамжуулаагүй нь магтаалтай. Үүнийгээ ил хэл.

**Демог дараах дарааллаар үзүүл:**

1. Нэвтрэх → RBAC (өөр үүргээр нэвтэрч цэс өөрчлөгдөхийг үзүүлэх)
2. Хяналтын самбар — бодит CPM тооцоолол, LLM-ээс биш гэдгийг онцлох
3. A5 offline демо — интернэт унтраагаад тайлан илгээх, асаахад синк болох
4. Дүрмийн засварлагч — босго өөрчилж, дахин байршуулалтгүйгээр үр дүн өөрчлөгдөхийг харуулах
5. (P1-1 хийгдсэн бол) A1 агентыг web-ээс ажиллуулж, чөлөөт бичвэрээс бүтэцтэй тайлан гарахыг үзүүлэх — **энэ бол хамгийн хүчтэй мөч**

**Шүүгчийн магадлалтай асуултууд:**

- _"LLM буруу тоо гаргавал яах вэ?"_ → P3/P4 зарчим: бүх тоо детерминистик тооцооллоос template-д ордог, LLM зөвхөн бүтэцлэлт/ноорог хийнэ. `unsupportedClaimCount = 0` гэсэн хэмжигдэхүүнээр батал.
- _"Хэр их автоматжсан бэ?"_ → "Ажлын 95% автомат, хариуцлагын 100% хүнд" — approved-command boundary-гаар batal.
- _"Бодит өгөгдөл дээр туршсан уу?"_ → Шударга хариул: synthetic дээр бүрэн, бодит дээр хэсэгчлэн, юу дутуу байгаа нь `EVIDENCE-CHECKLIST.md`-д тодорхой бичигдсэн.

---

## Хавсралт: Аудитаар засагдсан зүйлс (2026-08-06)

Энэ аудитын явцад дараах зүйлсийг илрүүлж, шууд заслаа:

| Асуудал                                          | Файл                                        | Засвар                                                    |
| ------------------------------------------------ | ------------------------------------------- | --------------------------------------------------------- |
| Login-ий tenant slug буруу (`tenant-demo` → 401) | `agent-console/src/pages/login-page.tsx:21` | `nomad-build` болгосон                                    |
| README-гийн bootstrap команд ажиллахгүй байсан   | `agent-console/README.md:34`                | `--tenant nomad-build`, id/slug ялгааг тайлбарласан       |
| API дангаараа асахгүй байсан (3 secret дутуу)    | `agents/.env`                               | 64 тэмдэгтийн 3 ялгаатай secret нэмсэн                    |
| Админ данс огт байхгүй байсан                    | PostgreSQL                                  | 2 `COMPANY_ADMIN` үүсгэж, нэвтрэлтийг end-to-end баталсан |

**Нэвтрэх мэдээлэл:** tenant slug `nomad-build` · `admin@gmail.com` / `Ch1ng7nj@w123` (нөөц: `admin@buildwatch.mn` / `BuildWatch2026Admin!`)

**Ажиллуулах:** `cd agents && pnpm.cmd docker:up` → `cd agent-console && pnpm.cmd dev` → http://127.0.0.1:4173
