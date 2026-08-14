# ADR 0001: GoRules-оос өмнө deterministic дүрмийг TypeScript-ээр хэрэгжүүлэх

- Төлөв: **Superseded by [ADR-0016](./0016-gorules-jdm-migration.md)** (2026-08-05) — доор заасан trigger нөхцөл хангагдсан тул 7 threshold дүрэм GoRules JDM руу шилжсэн. Энэ баримт анхны шийдвэрийн түүхэн context-д зориулж хадгалагдана.
- Огноо: 2026-07-26

## Нөхцөл

Төслийн эхний хувилбарт хугацаа хэтрэлт, ахиц зогсолт, dependency зөрчил, төсөв хэтрэлт, ledger зөрүү гэсэн таван дүрэм шаардлагатай. Бүх өгөгдөл PostgreSQL-д бүтэцтэй хадгалагдаж, үндсэн код TypeScript дээр байна. Энэ шатанд дүрмийг бизнес хэрэглэгч өөрөө засах UI болон олон зуун дүрмийн version management шаардлагагүй.

GoRules нь JDM decision model, дүрмийн тусдаа lifecycle болон business-friendly editor рүү шилжихэд тохиромжтой боловч одоо нэмбэл тусдаа runtime, deployment, integration test, monitoring гэсэн нэмэлт ачаалал үүсгэнэ.

## Шийдвэр

Эхний шатанд дүрмүүдийг цэвэр TypeScript функцээр хэрэгжүүлнэ.

- Дүрэм бүр ижил `ProjectAnalysisData` оролт авна.
- Гаралт нь JDM-тэй ойролцоо `decisionId`, `decisionVersion`, `hitPolicy: COLLECT`, `outputs` бүтэцтэй байна.
- Zod schema нь оролт, гаралтын contract-ийг runtime дээр шалгана.
- Мөнгөний тооцоог floating point ашиглахгүй, хоёр орны нарийвчлалтай string-ийг `bigint` цент рүү хөрвүүлж бодно.
- CPM болон дүрмүүд LLM дуудахгүй тул ижил оролтод үргэлж ижил үр дүн гаргана.
- Өдөр тутмын үндсэн урсгал нь `pnpm.cmd analyze -- --project=<id-or-code>` байна.
- `pg-boss` queue болон worker нь background execution-д зориулсан араг яс байна.

## Үр дагавар

Эерэг тал:

- Нэг хэл, нэг test runner, нэг deployment хэвээр үлдэнэ.
- Дүрэм бүрийг fixture болон answer-key-тэй шууд Vitest-ээр шалгана.
- Алдааг TypeScript stack trace болон deterministic input-оор давтан гаргана.
- A2 агент дараагийн хэсэгт баталгаатай CPM болон issue үр дүн хэрэглэнэ.

Сөрөг тал:

- Дүрэм өөрчлөхөд одоогоор кодын өөрчлөлт, review, deployment шаардлагатай.
- Business хэрэглэгчид зориулсан visual rule editor байхгүй.
- Rule version history нь source control-оор хязгаарлагдана.

## GoRules руу шилжих нөхцөл

Дараахын аль нэг бодитоор шаардлагатай бол GoRules migration эхлүүлнэ:

- Дүрмийн тоо болон хувилбарын тоо кодоор удирдахад хүндрэлтэй болох.
- Бизнес хэрэглэгч developer-гүйгээр дүрэм засах шаардлагатай болох.
- Нэг дүрмийг олон үйлчилгээ төвлөрсөн байдлаар хэрэглэх.
- Decision audit болон approval workflow шаардагдах.

Migration үед `decisionId` нь JDM decision ID, `hitPolicy` нь decision table policy, `ProjectAnalysisData` нь input fact, `DetectedIssue` нь output fact болно. Иймээс domain contract болон answer-key тестүүдийг хэвээр үлдээж, зөвхөн rule executor-ийг солих боломжтой.
