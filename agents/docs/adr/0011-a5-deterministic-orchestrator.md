# ADR 0011: A5 нь deterministic operational orchestrator байна

- Төлөв: Accepted
- Огноо: 2026-07-31

## Нөхцөл

Daily target, resource conflict, completion status, productivity, remaining duration,
critical path, projected finish болон recovery impact нь audit хийж дахин бодож болох
тоон шийдвэрүүд. Эдгээрийг LLM-д даатгавал ижил input-д ялгаатай үр дүн, fabricated
тоо болон production outage үед core ажиллагаа зогсох эрсдэлтэй.

Мөн A1, A2, A5-ийн үүргийг салгахгүй бол нэг өгөгдлийг олон агент өөр өөрөөр бодно.

## Шийдвэр

- A1 нь text/photo actual intake, normalization, evidence, duplicate suspicion,
  clarification хариуцна.
- A5 нь approved snapshot дээр daily plan, progress verification, rolling forecast,
  recovery workflow-г orchestration хийнэ.
- A2 нь A5/deterministic output дээр trend, root cause, recommendation тайлбарлах ба
  quantity/cost/duration-г дахин бодохгүй.
- Eligible selection, priority, target, conflict, status, variance, productivity,
  remaining duration, CPM, confidence болон scenario impact-г deterministic service
  бодно.
- LLM нь clarification, explanation, narrative, candidate mapping-д л ашиглагдана.
- LLM unavailable эсвэл budget exceeded үед deterministic plan/verification/forecast/
  alert үргэлжилнэ.
- Plan болон verification үргэлж draft; эрх бүхий хүн approve хийсний дараа apply
  хийнэ.
- Schedule нь project timezone 05:00 job, manual request, relevant approved event-ээр
  trigger хийгдэнэ.

## Үр дагавар

- Тоон үр дүн reproducible, testable, source-backed байна.
- A5 orchestration code нь олон deterministic service болон state transition удирдана.
- Narrative quality муудсан ч core operation зогсохгүй.
- Ownership давхцахгүй тул evaluation болон incident analysis тодорхой болно.
