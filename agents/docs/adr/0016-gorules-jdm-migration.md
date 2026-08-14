# ADR 0016: GoRules ZEN/JDM runtime-д шилжих (DET-14)

- Төлөв: Accepted
- Огноо: 2026-08-05
- Хамааралтай: Supersedes [ADR-0001](./0001-typescript-rules-before-gorules.md); хадгална [ADR-0004](./0004-rules-engine-boundary.md)-ийн boundary-г

## Нөхцөл

ADR-0001-д GoRules руу шилжих гурван trigger нөхцөл заасан байсан:

- Дүрмийн тоо болон хувилбарын тоо кодоор удирдахад хүндрэлтэй болох.
- Бизнес хэрэглэгч developer-гүйгээр дүрэм засах шаардлагатай болох.
- Decision audit болон approval workflow шаардагдах.

`TODO-NEXT-STEPS.md` 3.1-д заасны дагуу эдгээр нөхцөл хангагдсан гэж үзэж (инженер/rule owner код дахин байршуулахгүйгээр threshold засах шаардлагатай), DET-14-ийг хэрэгжүүлэв.

## Шийдвэр

ADR-0001/0004-ийн тогтоосон boundary-г бүрэн хадгална: **мөнгөний тооцоо (bigint cents), CPM, forecast, scenario simulation бүгд TypeScript дээр хэвээр үлдэнэ.** Зөвхөн threshold-харьцуулалт + severity-шийдвэр хэсэг рүү JDM engine орно — учир нь яг энэ хэсэг л "дүрэм" (business policy), бусад нь алгоритм.

7 дүрэм тус бүр (`production-analysis/rules.ts`) дараах хэлбэрт хуваагдана:

1. **Fact тооцоолол (TS, өөрчлөгдөөгүй):** bigint мөнгө, CPM, календарийн тооцоог хийж, plain number fact гаргана (жишээ нь `lead`, `ratio`, `coverageDays`). Мөнгөний арифметик JDM-ийн expression давхаргад **огт орохгүй**.
2. **Threshold шийдвэр (шинэ, JDM):** тухайн fact-ыг `rule-engine.ts:evaluateRuleThreshold`-д дамжуулж, tenant-ийн идэвхтэй (эсвэл өгөгдмөл) JDM decision table-аас `{severity}` эсвэл `null` (deviation биш) авна.
3. **Deviation объект угсрах (TS, өөрчлөгдөөгүй):** гарчиг, тайлбар, sourceIds, dedupeKey — эдгээр нь business хэрэглэгчийн засах зүйл биш тул TS-д үлдэнэ.

### Яагаад async `ZenDecision.evaluate()`-г ашиглаагүй

`@gorules/zen-engine`-ийн бүрэн граф-гүйцэтгэгч (`ZenDecision.evaluate`) зөвхөн async Promise API-тай. Үүнийг ашиглавал `evaluateProductionRules`/`analyzeProjectSnapshot`-ыг async болгож, тэднийг дуудаж буй A2/A3 pipeline (`a2-observer.ts`, `a3-documents.ts`, `evaluation.ts`) болон тэдгээрийн бүх дуудагчийг мөн async болгох шаардлагатай болно — их хэмжээний, эрсдэлтэй cascade.

Оронд нь манай граф бүр үргэлж яг ижил энгийн хэлбэртэй (нэг inputNode → нэг decisionTableNode → нэг outputNode, hit policy "first", нэг expression-төрлийн input багана): иймд `evaluateExpressionSync`-ийг ашиглаж decision table-ийн rules массивыг гараар, синхрон explore хийж эхний тохирсон мөрийг буцаана (`rule-engine.ts:evaluateRuleThreshold`). Хадгалагдсан graph нь бүрэн стандарт JDM JSON хэвээр үлдэх тул `@gorules/jdm-editor` UI-аар нээж засах боломж бүрэн хадгалагдана — зөвхөн manай runtime evaluator нь хөнгөн, синхрон, cascade-гүй.

### Өгөгдлийн загвар

`RuleCatalog`/`RuleCatalogVersion` (Prisma) нь `NormCatalog`/`NormCatalogVersion` загварыг давтана: tenant-scoped, `VersionLifecycleStatus` (DRAFT → APPLIED → SUPERSEDED) ашиглана. Tenant хэдийд ч дүрмээ засаагүй бол `DEFAULT_RULE_GRAPHS` (өнөөгийн `PRODUCTION_RULE_THRESHOLDS`-аас үүсгэсэн seed graph) идэвхтэй хэвээр байна — өөрчлөлт заавал биш, зөвхөн боломж.

### API ба UI

`/v1/rules`, `/v1/rules/{ruleId}/versions`, `/v1/rules/{ruleId}/draft`, `/v1/rules/{ruleId}/publish` (`backend/rules-service.ts`), шинэ `RULES_MANAGE` permission-оор хамгаалагдсан (SUPER_ADMIN/COMPANY_ADMIN). `agent-console/pages/rules-page.tsx` нь `@gorules/jdm-editor`-г ашиглана (Ant Design суурьтай тул `/admin/rules` route-д lazy-import-оор тусгаарлагдсан, Tailwind-тай холилдохгүй).

## Үр дагавар

Эерэг тал:

- Инженер/rule owner threshold-ийг (жишээ нь `costLeadPercentagePoints`) код дахин байршуулахгүйгээр UI-аас засаж, хувилбарлаж, нийтэлж болно.
- Одоогийн 612 Vitest тест (fixture/answer-key) бүгд өөрчлөгдөөгүйгээр PASS үлджээ — migration зан төлөв 100% хадгалсныг батална.
- Мөнгөний тооцоо hiç хэзээ JDM-д орохгүй тул ADR-0001-ийн "no floating point" invariant код бүтцээрээ хадгалагдсан хэвээр.

Сөрөг тал:

- Custom synchronous walker нь GoRules-ийн бүх боломжит node төрлийг (Switch, Function, Decision node) дэмжихгүй — зөвхөн нэг decisionTableNode-той энгийн граф. Хэрэв ирээдүйд илүү нарийн олон-node граф хэрэгтэй болвол `ZenDecision.evaluate()` руу шилжиж, дээрх async cascade-ийг тусад нь шийдэх шаардлагатай болно.
- `MISSING_DAILY_REPORT`-д бодит threshold байхгүй тул граф нь нэг мөртэй trivial боловч тогтвортой байдлын үүднээс мөн JDM-ээр дамжуулсан.
- Одоогийн worker/job pipeline (`a2-observer.ts` гэх мэт) нь `analyzeProjectSnapshot`-ыг дуудахдаа өгөгдмөл `DEFAULT_RULE_GRAPHS`-ийг ашиглана; tenant-ийн нийтэлсэн хувилбарыг бодит цаг үед ашиглахын тулд дуудагч тал `rule-engine.ts:loadTenantRuleGraphs(prisma, tenantId)`-г урьдчилан дуудаж, `analysisInput` override параметрээр дамжуулах ёстой (энэ бол дараагийн, тусдаа ажил — DET-14-ийн хамрах хүрээ бол runtime+persistence бэлэн байх явдал).
