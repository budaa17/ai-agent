import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import sharp from "sharp";
import { renderHtmlToPdfBytes } from "../reporting/pdf.js";
import {
  MATERIALS,
  PROJECT_METADATA,
  WORK_PACKAGES,
  buildEstimateLines,
  estimateTotals,
  materialFactor,
} from "./khan-uul-fixture.js";

/**
 * Real bytes for the files a client would hand over: architectural and
 * structural drawings, the bill of quantities workbook, the specification, and
 * site photos. The local object store verifies size and SHA-256 on every read,
 * so these have to be genuine files rather than placeholders.
 */

export type DemoArtifact = {
  readonly key: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly body: Buffer;
  readonly sha256: string;
};

function artifact(key: string, fileName: string, mediaType: string, body: Buffer): DemoArtifact {
  return {
    key,
    fileName,
    mediaType,
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
  };
}

const SHEET_STYLE = `
  @page { size: A3 landscape; margin: 8mm; }
  body { font-family: "Noto Sans", "Segoe UI", sans-serif; color: #10151c; margin: 0; }
  .frame { border: 2px solid #10151c; padding: 0; height: 285mm; display: flex; flex-direction: column; }
  .sheet { flex: 1; display: flex; }
  .canvas { flex: 1; padding: 6mm; }
  .stamp { width: 62mm; border-left: 2px solid #10151c; padding: 4mm; font-size: 8pt; }
  .stamp h1 { font-size: 11pt; margin: 0 0 3mm; }
  .stamp dt { font-weight: 600; margin-top: 2mm; }
  .stamp dd { margin: 0; }
  .legend { font-size: 8pt; margin-top: 4mm; }
  .legend td { padding: 0.6mm 2mm; border: 1px solid #566; }
  h2 { font-size: 12pt; margin: 0 0 3mm; }
`;

function titleBlock(sheetCode: string, sheetTitle: string, revision: string): string {
  return `
    <div class="stamp">
      <h1>${PROJECT_METADATA.name}</h1>
      <dl>
        <dt>Захиалагч</dt><dd>Номад Билд ХХК</dd>
        <dt>Байршил</dt><dd>${PROJECT_METADATA.location}</dd>
        <dt>Хуудасны код</dt><dd>${sheetCode}</dd>
        <dt>Нэр</dt><dd>${sheetTitle}</dd>
        <dt>Хувилбар</dt><dd>${revision}</dd>
        <dt>Масштаб</dt><dd>1:100</dd>
        <dt>Зохиогч</dt><dd>Б. Ганзориг, архитектор</dd>
        <dt>Шалгасан</dt><dd>С. Отгонбаяр, ХБИ</dd>
      </dl>
      <table class="legend">
        <tr><td>——</td><td>Даацын хана</td></tr>
        <tr><td>▭</td><td>Багана 400×400</td></tr>
        <tr><td>╌╌</td><td>Тусгаарлах хана</td></tr>
      </table>
    </div>`;
}

/** Axis grid plus rooms — enough structure for the intake parser to chew on. */
function floorPlanSvg(floorLabel: string, seed: number): string {
  const columns = 7;
  const rows = 4;
  const step = 90;
  const originX = 70;
  const originY = 60;
  const parts: string[] = [];

  for (let column = 0; column <= columns; column += 1) {
    const x = originX + column * step;
    parts.push(
      `<line x1="${x}" y1="${originY - 24}" x2="${x}" y2="${originY + rows * step + 24}" stroke="#8b98a5" stroke-width="0.8" stroke-dasharray="8 4 2 4" />`,
      `<circle cx="${x}" cy="${originY - 34}" r="11" fill="#fff" stroke="#10151c" stroke-width="1.2" />`,
      `<text x="${x}" y="${originY - 30}" text-anchor="middle" font-size="11">${column + 1}</text>`,
    );
  }
  for (let row = 0; row <= rows; row += 1) {
    const y = originY + row * step;
    const label = String.fromCharCode(65 + row);
    parts.push(
      `<line x1="${originX - 24}" y1="${y}" x2="${originX + columns * step + 24}" y2="${y}" stroke="#8b98a5" stroke-width="0.8" stroke-dasharray="8 4 2 4" />`,
      `<circle cx="${originX - 34}" cy="${y}" r="11" fill="#fff" stroke="#10151c" stroke-width="1.2" />`,
      `<text x="${originX - 34}" y="${y + 4}" text-anchor="middle" font-size="11">${label}</text>`,
    );
  }

  // Outer envelope
  parts.push(
    `<rect x="${originX}" y="${originY}" width="${columns * step}" height="${rows * step}" fill="none" stroke="#10151c" stroke-width="4" />`,
  );

  // Columns at every grid intersection
  for (let column = 0; column <= columns; column += 1) {
    for (let row = 0; row <= rows; row += 1) {
      const x = originX + column * step - 9;
      const y = originY + row * step - 9;
      parts.push(`<rect x="${x}" y="${y}" width="18" height="18" fill="#10151c" />`);
    }
  }

  // Apartment partitions, nudged by the seed so each floor differs
  const apartments = ["2 өрөө 58.4 м²", "3 өрөө 76.2 м²", "1 өрөө 42.1 м²", "2 өрөө 61.8 м²"];
  for (let index = 0; index < 4; index += 1) {
    const x = originX + index * step * 1.75;
    const width = step * 1.75;
    parts.push(
      `<line x1="${x + width}" y1="${originY}" x2="${x + width}" y2="${originY + rows * step}" stroke="#10151c" stroke-width="2.4" />`,
      `<text x="${x + width / 2}" y="${originY + rows * step - 18}" text-anchor="middle" font-size="12">${apartments[(index + seed) % apartments.length]}</text>`,
    );
  }

  // Core: stair and lift shaft
  const coreX = originX + step * 3;
  parts.push(
    `<rect x="${coreX}" y="${originY + step}" width="${step}" height="${step * 2}" fill="#eef2f6" stroke="#10151c" stroke-width="2.4" />`,
    `<text x="${coreX + step / 2}" y="${originY + step * 2}" text-anchor="middle" font-size="12">Шат / Цахилгаан шат</text>`,
  );

  parts.push(
    `<text x="${originX}" y="${originY + rows * step + 52}" font-size="16" font-weight="600">${floorPlanLabel(floorLabel)}</text>`,
    `<text x="${originX}" y="${originY + rows * step + 74}" font-size="11">Нийт талбай 742.6 м² · Ашигтай талбай 596.3 м² · Тэнхлэг хоорондын алхам 3600 мм</text>`,
  );

  return `<svg viewBox="0 0 760 480" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

function floorPlanLabel(floorLabel: string): string {
  return `${floorLabel} — план, масштаб 1:100`;
}

function sectionSvg(): string {
  const parts: string[] = [];
  const baseY = 430;
  const floorHeight = 30;
  for (let floor = 0; floor < 12; floor += 1) {
    const y = baseY - floor * floorHeight;
    parts.push(
      `<line x1="90" y1="${y}" x2="640" y2="${y}" stroke="#10151c" stroke-width="2.6" />`,
      `<text x="60" y="${y + 4}" font-size="10" text-anchor="end">+${(floor * 3.0).toFixed(2)}</text>`,
      `<text x="656" y="${y + 4}" font-size="10">${floor === 0 ? "Хонгил" : `${floor}-р давхар`}</text>`,
    );
  }
  parts.push(
    `<rect x="90" y="${baseY - 11 * floorHeight - 26}" width="550" height="26" fill="#dbe3ea" stroke="#10151c" stroke-width="2" />`,
    `<text x="365" y="${baseY - 11 * floorHeight - 8}" text-anchor="middle" font-size="11">Дээвэр — хучилтын хавтан 200мм + дулаалга 150мм</text>`,
    `<rect x="70" y="${baseY}" width="590" height="40" fill="#c9d4de" stroke="#10151c" stroke-width="3" />`,
    `<text x="365" y="${baseY + 26}" text-anchor="middle" font-size="11">Суурийн хавтан C25/30, зузаан 600мм</text>`,
    `<text x="90" y="40" font-size="16" font-weight="600">1-1 огтлол, масштаб 1:100</text>`,
    `<text x="90" y="62" font-size="11">Давхрын өндөр 3000мм · Барилгын нийт өндөр +36.00 · Багана 400×400 C30/37</text>`,
  );
  return `<svg viewBox="0 0 760 480" xmlns="http://www.w3.org/2000/svg">${parts.join("")}</svg>`;
}

function drawingHtml(
  pages: readonly { readonly code: string; readonly title: string; readonly svg: string }[],
  revision: string,
): string {
  const body = pages
    .map(
      (page, index) => `
        <div class="frame" style="${index > 0 ? "page-break-before: always;" : ""}">
          <div class="sheet">
            <div class="canvas">
              <h2>${page.title}</h2>
              ${page.svg}
            </div>
            ${titleBlock(page.code, page.title, revision)}
          </div>
        </div>`,
    )
    .join("");
  return `<!doctype html><html lang="mn"><head><meta charset="utf-8"><style>${SHEET_STYLE}</style></head><body>${body}</body></html>`;
}

export async function buildArchitectureDrawing(): Promise<DemoArtifact> {
  const html = drawingHtml(
    [
      { code: "AR-01/1", title: "1-р давхрын план", svg: floorPlanSvg("1-р давхар", 0) },
      {
        code: "AR-01/2",
        title: "Ердийн давхрын план (2-11)",
        svg: floorPlanSvg("Ердийн давхар", 1),
      },
      { code: "AR-01/3", title: "12-р давхрын план", svg: floorPlanSvg("12-р давхар", 2) },
      { code: "AR-01/4", title: "Дээврийн план", svg: floorPlanSvg("Дээвэр", 3) },
    ],
    "Rev.C",
  );
  const body = await renderHtmlToPdfBytes(html);
  return artifact("architecture", "AR-01-arkhitektur-plan-Rev-C.pdf", "application/pdf", body);
}

export async function buildStructureDrawing(): Promise<DemoArtifact> {
  const html = drawingHtml(
    [
      { code: "ST-01/1", title: "Суурийн план", svg: floorPlanSvg("Суурь", 1) },
      { code: "ST-01/2", title: "1-1 огтлол", svg: sectionSvg() },
      { code: "ST-01/3", title: "Каркасын угсралтын план", svg: floorPlanSvg("Каркас", 2) },
    ],
    "Rev.B",
  );
  const body = await renderHtmlToPdfBytes(html);
  return artifact("structure", "ST-01-butets-suuri-Rev-B.pdf", "application/pdf", body);
}

export async function buildSpecification(): Promise<DemoArtifact> {
  const rows = WORK_PACKAGES.map(
    (pkg) => `
      <tr>
        <td>${pkg.code}</td>
        <td>${pkg.name}</td>
        <td>${pkg.description}</td>
        <td>${pkg.norm === undefined ? "—" : (MATERIALS.find((m) => m.code === pkg.norm?.materialCode)?.specification.standard ?? "—")}</td>
      </tr>`,
  ).join("");
  const html = `<!doctype html><html lang="mn"><head><meta charset="utf-8"><style>
    body { font-family: "Noto Sans", "Segoe UI", sans-serif; font-size: 10pt; color: #10151c; }
    h1 { font-size: 15pt; } h2 { font-size: 12pt; margin-top: 8mm; }
    table { border-collapse: collapse; width: 100%; margin-top: 4mm; }
    th, td { border: 1px solid #94a3b1; padding: 2mm; text-align: left; vertical-align: top; }
    th { background: #eef2f6; }
  </style></head><body>
    <h1>Техникийн үзүүлэлт — ${PROJECT_METADATA.name}</h1>
    <p>${PROJECT_METADATA.description}</p>
    <h2>1. Ажлын багцын техникийн шаардлага</h2>
    <table><thead><tr><th>Код</th><th>Ажлын нэр</th><th>Тайлбар</th><th>Стандарт</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>2. Материалын жагсаалт</h2>
    <table><thead><tr><th>Код</th><th>Материал</th><th>Хэмжих нэгж</th><th>Стандарт</th></tr></thead><tbody>
      ${MATERIALS.map((material) => `<tr><td>${material.code}</td><td>${material.canonicalName}</td><td>${material.unit}</td><td>${material.specification.standard ?? "—"}</td></tr>`).join("")}
    </tbody></table>
  </body></html>`;
  const body = await renderHtmlToPdfBytes(html);
  return artifact("specification", "SP-01-tekhnikiin-uzuulelt.pdf", "application/pdf", body);
}

export async function buildBillOfQuantities(): Promise<DemoArtifact> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BuildWatch demo seed";
  workbook.created = new Date("2026-02-18T00:00:00.000Z");
  workbook.modified = new Date("2026-02-18T00:00:00.000Z");

  const boq = workbook.addWorksheet("BOQ");
  boq.columns = [
    { header: "Код", key: "code", width: 12 },
    { header: "Ажлын нэр", key: "name", width: 46 },
    { header: "Нэгж", key: "unit", width: 8 },
    { header: "Тоо хэмжээ", key: "quantity", width: 14 },
    { header: "Эхлэх", key: "start", width: 13 },
    { header: "Дуусах", key: "end", width: 13 },
  ];
  for (const pkg of WORK_PACKAGES) {
    boq.addRow({
      code: pkg.code,
      name: pkg.name,
      unit: pkg.unit,
      quantity: pkg.quantity,
      start: pkg.plannedStart,
      end: pkg.plannedEnd,
    });
  }

  const estimate = workbook.addWorksheet("Estimate");
  estimate.columns = [
    { header: "Мөрийн код", key: "lineCode", width: 14 },
    { header: "Ажлын код", key: "workCode", width: 12 },
    { header: "Ангилал", key: "category", width: 14 },
    { header: "Тайлбар", key: "description", width: 52 },
    { header: "Тоо хэмжээ", key: "quantity", width: 14 },
    { header: "Нэгж", key: "unit", width: 8 },
    { header: "Нэгж үнэ", key: "unitPrice", width: 16 },
    { header: "Дүн (₮)", key: "amount", width: 18 },
  ];
  const lines = buildEstimateLines();
  for (const line of lines) estimate.addRow(line);
  const totals = estimateTotals(lines);
  estimate.addRow({});
  estimate.addRow({ description: "Дүн", amount: totals.subtotal });
  estimate.addRow({
    description: "Урьдчилан тооцоолоогүй зардал 5%",
    amount: totals.contingencyAmount,
  });
  estimate.addRow({ description: "НӨАТ 10%", amount: totals.taxAmount });
  estimate.addRow({ description: "Нийт", amount: totals.totalAmount });

  const materials = workbook.addWorksheet("Materials");
  materials.columns = [
    { header: "Код", key: "code", width: 16 },
    { header: "Материал", key: "name", width: 46 },
    { header: "Нэгж", key: "unit", width: 8 },
    { header: "Нэгж үнэ (₮)", key: "price", width: 16 },
    { header: "Стандарт", key: "standard", width: 20 },
  ];
  for (const material of MATERIALS) {
    materials.addRow({
      code: material.code,
      name: material.canonicalName,
      unit: material.unit,
      price: material.unitPrice,
      standard: material.specification.standard ?? "",
    });
  }

  const norms = workbook.addWorksheet("Norms");
  norms.columns = [
    { header: "Ажлын код", key: "workCode", width: 12 },
    { header: "Материалын код", key: "materialCode", width: 18 },
    { header: "Нэгжид ногдох", key: "perOutput", width: 16 },
    { header: "Хаягдал %", key: "waste", width: 12 },
    { header: "Нийт итгэлцүүр", key: "factor", width: 16 },
  ];
  for (const pkg of WORK_PACKAGES) {
    if (pkg.norm === undefined) continue;
    norms.addRow({
      workCode: pkg.code,
      materialCode: pkg.norm.materialCode,
      perOutput: pkg.norm.quantityPerOutput,
      waste: pkg.norm.wastePercent,
      factor: Number(materialFactor(pkg).toFixed(6)),
    });
  }

  for (const sheet of [boq, estimate, materials, norms]) {
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  const body = Buffer.from(await workbook.xlsx.writeBuffer());
  return artifact(
    "boq",
    "BOQ-01-ajliin-too-khemjee.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body,
  );
}

const PHOTO_SUBJECTS: readonly { readonly caption: string; readonly tint: string }[] = [
  { caption: "Каркасын бетон цутгалт, 7-р давхар", tint: "#8d99a6" },
  { caption: "Арматурын угсралт, B-2 тэнхлэг", tint: "#a3714f" },
  { caption: "Хананы блокон өрлөг, зүүн жигүүр", tint: "#b3a894" },
  { caption: "Бетон дээж авалт, лабораторийн шалгалт", tint: "#6f7d8c" },
];

/** A deterministic site photo. Distinct bytes per index keep SHA-256 unique. */
export async function buildSitePhoto(index: number, capturedAt: string): Promise<DemoArtifact> {
  const subject = PHOTO_SUBJECTS[index % PHOTO_SUBJECTS.length];
  const bars = Array.from({ length: 9 }, (_, bar) => {
    const height = 120 + ((index * 37 + bar * 53) % 260);
    return `<rect x="${40 + bar * 90}" y="${560 - height}" width="66" height="${height}" fill="rgba(16,21,28,${0.18 + (bar % 4) * 0.12})" />`;
  }).join("");
  const svg = `<svg width="960" height="640" viewBox="0 0 960 640" xmlns="http://www.w3.org/2000/svg">
    <rect width="960" height="640" fill="${subject.tint}" />
    <rect y="380" width="960" height="260" fill="rgba(16,21,28,0.22)" />
    ${bars}
    <rect x="0" y="560" width="960" height="80" fill="rgba(10,14,18,0.72)" />
    <text x="24" y="596" font-family="sans-serif" font-size="26" fill="#f4f7fa">${subject.caption}</text>
    <text x="24" y="624" font-family="sans-serif" font-size="18" fill="#c6d2dd">${PROJECT_METADATA.code} · ${capturedAt} · GPS 47.8864, 106.8912</text>
  </svg>`;
  const body = await sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
  return artifact(
    `photo-${index}`,
    `site-${capturedAt}-${index + 1}.jpg`,
    "image/jpeg",
    Buffer.from(body),
  );
}
