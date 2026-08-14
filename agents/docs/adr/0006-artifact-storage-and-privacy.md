# ADR 0006: Artifact storage ба нууцлал

- Төлөв: Accepted
- Огноо: 2026-07-29

## Нөхцөл

Өдрийн тайлангийн зураг, PDF, source text нь нууц болон их хэмжээтэй байж болно. Тэдгээрийг DB record, log, prompt-д бүхлээр нь давхар хадгалах нь эрсдэлтэй.

## Шийдвэр

- Artifact content-ийг production үед object storage-д, metadata/hash/storage key-г database-д хадгална.
- Agent contract зөвхөн `ContractArtifactReference` дамжуулна.
- Tenant prefix, signed URL, хугацаатай access, checksum, file type/size validation хэрэглэнэ.
- Prompt-д зөвхөн шаардлагатай artifact эсвэл redacted хэсгийг өгнө.
- Log, evaluation report, exception-д raw secret болон private image data бичихгүй.
- Phase 1 file harness нь зөвхөн anonymized local test artifact ашиглана.

## Үр дагавар

- DB хэмжээ болон privacy эрсдэл буурна.
- Phase 4-т object storage lifecycle, malware scanning, deletion policy нэмэгдэнэ.
- Artifact hash нь давхардал болон audit нотолгоо болно.
