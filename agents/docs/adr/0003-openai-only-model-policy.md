# ADR 0003: OpenAI-only model policy

- Төлөв: Accepted
- Огноо: 2026-07-29

## Нөхцөл

Олон provider зэрэг дэмжих нь prompt, schema, multimodal behavior, quota, telemetry-ийн ялгааг нэмэгдүүлнэ. Төслийн одоогийн сонголт нь зөвхөн OpenAI API ашиглах.

## Шийдвэр

- Production agent runtime зөвхөн `@ai-sdk/openai` provider хэрэглэнэ.
- Model ID-г environment-оос тохируулна; кодонд API key болон бодит secret хадгалахгүй.
- Structured output, tool calling, image input-ийг provider-specific adapter дотор тусгаарлана.
- Offline deterministic тест API дуудлага хийхгүй.
- Live evaluation-ийг тусдаа command, cost/quota анхааруулгатай ажиллуулна.

## Үр дагавар

- Runtime болон evaluation-ийн ялгаа багасна.
- Provider fallback байхгүй; quota тасарвал `AI_UNAVAILABLE` controlled status буцаана.
- Model солих үед golden evaluation болон prompt compatibility gate заавал ажиллана.
