# ADR 0015: Photo duplicate, provenance болон privacy policy

- Төлөв: Accepted
- Огноо: 2026-07-31

## Нөхцөл

Daily progress зураг буруу project/work item-д холбогдох, өмнөх зураг дахин ашиглах,
blur/dark байх, metadata өөрчлөгдсөн байх, нүүр/машины дугаар/баримт агуулж болох
эрсдэлтэй. Near-duplicate vision model false positive гаргаж болно. Фотоноос exact
quantity таамаглах нь албан ёсны хэмжилтийг орлож болохгүй.

## Шийдвэр

- Upload үед original checksum, processed checksum, transform provenance, file type,
  dimensions, orientation, captured/uploaded timestamp хадгална.
- Exact duplicate нь SHA-256 checksum equality-гаар deterministic тогтоогдоно.
- Near-duplicate нь versioned perceptual/image similarity method ашигласан advisory
  signal байна; threshold болон model version persisted байна.
- Exact/near duplicate, previous-day reuse, suspicious metadata нь auto-approval
  блоклож review queue үүсгэнэ.
- Near-duplicate signal дангаараа report reject хийхгүй.
- Photo нь progress claim-ийг дэмжих, contradiction/stage/safety signal илрүүлэхэд
  ашиглагдана; exact quantity source биш.
- Project/work-item/report-date linkage болон required evidence rule заавал шалгана.
- Face, license plate, identity document болон sensitive text signal нь privacy review
  үүсгэнэ.
- Browser/public URL-аар original file ил гаргахгүй; authorized signed read ашиглана.
- Raw болон derivative artifact tenant/project access, retention, deletion, legal hold,
  audit policy-тэй байна.
- Real-image evaluation dataset нь data-owner consent, anonymization record, reviewer
  label болон allowed-use metadata шаардана.

## Үр дагавар

- Duplicate/quality model алдаа official actual-ийг автоматаар өөрчлөхгүй.
- Original/processed artifact хооронд provenance хадгалагдана.
- Privacy review болон retention operational ажил нэмнэ.
- Photo evidence metric нь real consented datasetгүйгээр production-ready гэж
  тооцогдохгүй.
