# ADR 0010: A0 output нь candidate бөгөөд authoritative биш

- Төлөв: Accepted
- Огноо: 2026-07-31

## Нөхцөл

Зураг төслийн revision, scale, OCR/vector extraction, element classification болон
catalog mapping алдаатай байж болно. AI candidate-г шууд quantity, estimate, schedule
эсвэл baseline болговол төслийн төсөв, худалдан авалт, хугацаанд өндөр эрсдэл үүснэ.

## Шийдвэр

- A0 зөвхөн candidate/draft, confidence, source reference, clarification, validation
  issue гаргана.
- Verified scale байхгүй үед metric geometry/quantity contract validation дээр
  блоклогдоно.
- Source reference-гүй quantity item reject болно.
- Quantity takeoff-г Engineer review хийж Estimator approve хийнэ.
- Estimate-г Estimator review хийж ProjectManager approve хийнэ.
- Baseline change-г Engineer review хийж ProjectManager approve хийнэ.
- Approved record immutable; edit нь шинэ draft revision/version үүсгэнэ.
- Approved command л idempotent transaction/outbox boundary давж canonical data-г
  өөрчилнө.
- Missing norm, price, productivity-г A0 зохиохгүй; typed missing-information issue
  үүсгэнэ.

## Үр дагавар

- Human review нь latency нэмнэ.
- Candidate болон official record хоёрын ялгаа audit-аар нотлогдоно.
- Model солигдсон ч approved business data автоматаар өөрчлөгдөхгүй.
- Source/scale/approvalгүй demo output-ийг official BOQ эсвэл estimate гэж нэрлэхгүй.
