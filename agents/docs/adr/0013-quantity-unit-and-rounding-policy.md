# ADR 0013: Quantity source, unit, currency, calendar болон rounding policy

- Төлөв: Accepted
- Огноо: 2026-07-31

## Нөхцөл

Drawing, Excel, catalog, daily report болон forecast өөр unit, precision, currency,
timezone, calendar ашиглавал quantity/cost/schedule зөрж, ижил input-д өөр үр дүн
гарна. JavaScript floating point болон эрт rounding нь санхүү, cumulative quantity-д
алдаа хуримтлуулна.

## Шийдвэр

- Contract numeric value plain base-10 decimal string байна.
- Database canonical numeric нь `Decimal`; money нь дор хаяж `Decimal(18,2)`.
- Currency нь `MNT`.
- Canonical unit: `m`, `m2`, `m3`, `kg`, `pcs`, `h`, `working_day`, `percent`.
- Original unit, conversion factor, source болон rule version persisted байна.
- Dimension mismatch болон unknown unit reject/clarification болно.
- Intermediate calculation high precision хадгалж, output boundary дээр
  `ROUND_HALF_UP` хэрэглэнэ.
- Approval display precision:
  - length `0.001 m`;
  - area `0.01 m2`;
  - volume `0.001 m3`;
  - mass `0.01 kg`;
  - hour `0.01 h`;
  - percentage point `0.01`;
  - money `0.01 MNT`.
- Instant UTC-аар хадгална; operational date/job/shift нь explicit project timezone-аар
  бодогдоно.
- `Asia/Ulaanbaatar` нь simulation/demo default; production project timezone explicit.
- Schedule/forecast нь versioned working calendar шаардана, implicit weekend calendar
  үүсгэхгүй.
- Quantity source priority:
  1. approved engineer quantity;
  2. verified vector geometry;
  3. approved Excel;
  4. raster image/photo нь exact source биш.
- Missing price нь 0₮ биш `PRICE_MISSING`.
- Forecast default warning/critical threshold нь 5/10 working day бөгөөд project
  setting/version snapshot-д хадгалагдана.
- 3-аас цөөн approved valid observation үед approved norm хэрэглэж confidence-г
  0.60-аар cap хийнэ; norm байхгүй бол `INSUFFICIENT_DATA`.
- Statistical outlier нь 7+ sample дээр `3 × MAD` candidate flag; автоматаар
  устгахгүй, reviewer include/exclude хийнэ.

## Үр дагавар

- Quantity, cost, calendar болон forecast reproducible байна.
- UI localized display хийж болох ч API/storage canonical value-г өөрчлөхгүй.
- Production project setup-д timezone/calendar/catalog дутуу бол computation block
  болно.
- Domain formula бүр unit/rounding boundary test шаардана.
