# ADR 0012: MVP-д vector architectural PDF болон Excel-ийг IFC-ээс өмнө хэрэгжүүлэх

- Төлөв: Accepted
- Огноо: 2026-07-31

## Нөхцөл

BuildWatch v2.2 requirement PDF, raster image, IFC, XLSX, CSV, DOCX input дурдсан.
IFC, structural, MEP, clash болон revision impact-ийг нэг MVP-д хийх нь parser,
geometry semantics, unit, property-set, model-quality болон domain review-ийн хэмжээг
хэт өсгөнө.

Одоогийн төсөлд Excel fixture, artifact pipeline, image processing, deterministic
analysis байгаа тул narrower vertical slice-ийг батлах боломжтой.

## Шийдвэр

- MVP authoritative design input:
  - инженерийн 18-sheet XLSX workbook;
  - vector architectural PDF;
  - explicit engineer-verified scale.
- MVP element scope:
  - floor;
  - zone;
  - room;
  - wall;
  - door;
  - window.
- Raster drawing/image-ийг classification, preview, evidence-д ашиглаж болох ч metric
  geometry source гэж үзэхгүй.
- CSV болон technical description extraction нь `SHOULD`.
- IFC/BIM, structural, MEP, clash, automated revision impact нь `LATER`.
- A0 contract нь future IFC source нэмэхэд source type-аар өргөжих боловч quantity,
  source, approval contract-ийг солихгүй байна.

## Үр дагавар

- End-to-end baseline vertical slice эрт шалгагдана.
- IFC-ийн advanced чадвар MVP release-ийг блоклохгүй.
- Vector PDF чанар муу, scale байхгүй тохиолдолд quantity blocked болно.
- Post-MVP IFC adapter approved candidate/quantity boundary-г дахин ашиглана.
