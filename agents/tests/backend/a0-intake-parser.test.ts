import JSZip from "jszip";
import { parsePhase10A0Package, type Phase10A0ArtifactRole } from "../../src/backend/index.js";

async function workbook(
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean)[])[],
): Promise<Buffer> {
  const zip = new JSZip();
  const cell = (value: string | number | boolean, column: number, row: number) => {
    const reference = `${String.fromCharCode(65 + column)}${row}`;
    if (typeof value === "number") return `<x:c r="${reference}" t="n"><x:v>${value}</x:v></x:c>`;
    if (typeof value === "boolean")
      return `<x:c r="${reference}" t="b"><x:v>${value ? 1 : 0}</x:v></x:c>`;
    return `<x:c r="${reference}" t="str"><x:v>${value}</x:v></x:c>`;
  };
  const sheetRows = [headers, ...rows]
    .map(
      (values, rowIndex) =>
        `<x:row r="${rowIndex + 1}">${values
          .map((value, columnIndex) => cell(value, columnIndex, rowIndex + 1))
          .join("")}</x:row>`,
    )
    .join("");
  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0"?><x:workbook xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheets><x:sheet name="${sheetName}" sheetId="1" r:id="R1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></x:sheets></x:workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml" Id="R1"/></Relationships>`,
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${sheetRows}</x:sheetData></x:worksheet>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

describe("A0 role-specific workbook parser", () => {
  it("reports expected and found sheet names for an incompatible workbook", async () => {
    const files = new Map<Phase10A0ArtifactRole, Buffer>([
      ["BOQ_WORK_ITEMS", await workbook("boq", ["boq_id", "quantity"], [["BOQ-1", 1]])],
      [
        "MATERIAL_NORMS",
        await workbook("material_norm", ["norm_id", "work_code"], [["N-1", "W-1"]]),
      ],
      [
        "MATERIAL_PRICE_CATALOG",
        await workbook("Үнийн каталог", ["PriceCode", "Материал"], [["P-1", "Цемент"]]),
      ],
      [
        "WBS_DEPENDENCIES",
        await workbook("wbs_dependencies", ["wbs_code", "duration_days"], [["1.1", 2]]),
      ],
    ]);

    await expect(parsePhase10A0Package(files)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "Workbook does not contain a supported A0 sheet",
      details: {
        expectedSheets: expect.arrayContaining(["BOQ", "Material_Norms", "Price_Catalog", "WBS"]),
        foundSheets: expect.any(Array),
      },
    });
  });

  it("parses namespaced OOXML and keeps explicit source rows", async () => {
    const files = new Map<Phase10A0ArtifactRole, Buffer>([
      [
        "BOQ_WORK_ITEMS",
        await workbook(
          "BOQ",
          [
            "boq_code",
            "floor",
            "work_code",
            "work_name",
            "unit",
            "quantity",
            "unit_cost_mnt",
            "total_cost_mnt",
            "quantity_source",
            "review_status",
          ],
          [["BW-001", "L1", "WALL", "Хана", "m2", 10, 5000, 50000, "BOQ", "NEEDS_REVIEW"]],
        ),
      ],
      [
        "MATERIAL_NORMS",
        await workbook(
          "Material_Norms",
          [
            "norm_code",
            "work_code",
            "work_name",
            "work_unit",
            "material_code",
            "material_unit",
            "base_qty_per_work_unit",
            "waste_rate",
            "effective_qty",
          ],
          [["N-WALL", "WALL", "Хана", "m2", "MAT-01", "pcs", 8, 0.05, 8.4]],
        ),
      ],
      [
        "MATERIAL_PRICE_CATALOG",
        await workbook(
          "Price_Catalog",
          [
            "material_code",
            "material_name_mn",
            "specification",
            "unit",
            "unit_price_mnt",
            "vat_included",
            "region",
            "effective_date",
            "source_type",
            "source_note",
            "status",
          ],
          [
            [
              "MAT-01",
              "Блок",
              "200mm",
              "pcs",
              12000,
              true,
              "УБ",
              "2026-08-01",
              "QUOTE",
              "Q-1",
              "ACTIVE",
            ],
          ],
        ),
      ],
      [
        "WBS_DEPENDENCIES",
        await workbook(
          "WBS",
          [
            "task_id",
            "task_group",
            "task_name_mn",
            "floor",
            "duration_days",
            "predecessor_ids",
            "status",
          ],
          [
            ["WBS-01", "Start", "Эхлэл", "ALL", 2, "", "NOT_STARTED"],
            ["WBS-02", "Wall", "Хана", "L1", 3, "WBS-01", "NOT_STARTED"],
          ],
        ),
      ],
    ]);
    const parsed = await parsePhase10A0Package(files);
    expect(parsed.boq).toHaveLength(1);
    expect(parsed.boq[0]).toMatchObject({ boqCode: "BW-001", sourceRow: 2 });
    expect(parsed.boq[0]?.totalCostMnt.toFixed(2)).toBe("50000.00");
    expect(parsed.norms[0]).toMatchObject({ normCode: "N-WALL", materialCode: "MAT-01" });
    expect(parsed.prices[0]).toMatchObject({ materialCode: "MAT-01", active: true });
    expect(parsed.wbs[1]).toMatchObject({ taskId: "WBS-02", predecessorIds: ["WBS-01"] });
  });

  it("rejects a BOQ cached total that does not match quantity × unit price", async () => {
    const files = new Map<Phase10A0ArtifactRole, Buffer>();
    files.set(
      "BOQ_WORK_ITEMS",
      await workbook(
        "BOQ",
        [
          "boq_code",
          "floor",
          "work_code",
          "work_name",
          "unit",
          "quantity",
          "unit_cost_mnt",
          "total_cost_mnt",
          "quantity_source",
          "review_status",
        ],
        [["BW-001", "L1", "WALL", "Хана", "m2", 10, 5000, 49999, "BOQ", "NEEDS_REVIEW"]],
      ),
    );
    files.set(
      "MATERIAL_NORMS",
      await workbook(
        "Material_Norms",
        [
          "norm_code",
          "work_code",
          "work_name",
          "work_unit",
          "material_code",
          "material_unit",
          "base_qty_per_work_unit",
          "waste_rate",
          "effective_qty",
        ],
        [["N-WALL", "WALL", "Хана", "m2", "MAT-01", "pcs", 8, 0.05, 8.4]],
      ),
    );
    files.set(
      "MATERIAL_PRICE_CATALOG",
      await workbook(
        "Price_Catalog",
        [
          "material_code",
          "material_name_mn",
          "specification",
          "unit",
          "unit_price_mnt",
          "vat_included",
          "region",
          "effective_date",
          "source_type",
          "source_note",
          "status",
        ],
        [
          [
            "MAT-01",
            "Блок",
            "200mm",
            "pcs",
            12000,
            true,
            "УБ",
            "2026-08-01",
            "QUOTE",
            "Q-1",
            "ACTIVE",
          ],
        ],
      ),
    );
    files.set(
      "WBS_DEPENDENCIES",
      await workbook(
        "WBS",
        [
          "task_id",
          "task_group",
          "task_name_mn",
          "floor",
          "duration_days",
          "predecessor_ids",
          "status",
        ],
        [["WBS-01", "Start", "Эхлэл", "ALL", 2, "", "NOT_STARTED"]],
      ),
    );
    await expect(parsePhase10A0Package(files)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      status: 422,
      message: "BOQ total_cost_mnt does not equal quantity × unit_cost_mnt",
    });
  });
});
