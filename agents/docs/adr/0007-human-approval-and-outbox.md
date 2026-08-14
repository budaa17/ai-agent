# ADR 0007: Human approval ба transactional outbox

- Төлөв: Accepted
- Огноо: 2026-07-29

## Нөхцөл

A1 зураг/текстээс буруу утга гаргаж болно. AI draft шууд үндсэн progress, attendance, material, cost хүснэгтэд write хийвэл засварлах, мөрдөх, rollback хийхэд эрсдэлтэй.

## Шийдвэр

- A1 үргэлж `requiresHumanReview: true` draft гаргана.
- Reviewer approve/edit/reject хийж, approve үед `ApprovedDailyReportCommandV1` үүсгэнэ.
- Production backend command-ийг нэг transaction дотор domain tables-д apply хийж, outbox event бичнэ.
- `idempotencyKey` давхардсан command-ийг дахин apply хийхгүй.
- Original AI draft, human edits, reviewer, timestamp-г audit trail-д хадгална.

## Үр дагавар

- AI өөрөө production system of record-ийг өөрчлөхгүй.
- Review алхам хэрэглэгчийн ажлыг бага зэрэг нэмэгдүүлнэ.
- Downstream A2/A3 agent зөвхөн approved event/data дээр ажиллана.
