import { describe, expect, it } from "vitest";
import { renderProjectReportHtml } from "../../src/reporting/render.js";
import { buildProjectReportFixture } from "./fixtures.js";

describe("project report HTML", () => {
  it("renders deterministic tables and embeds the supplied font", async () => {
    const fixture = buildProjectReportFixture();
    const html = await renderProjectReportHtml(fixture.projectReport, {
      fontBase64: Buffer.from("font-fixture").toString("base64"),
    });

    expect(html).toContain("Noto Sans Embedded");
    expect(html).toContain(Buffer.from("font-fixture").toString("base64"));
    expect(html).toContain("ERP шинэчлэлийн төсөл");
    expect(html).toContain("AT-001");
    expect(html).toContain("100.00%");
    expect(html).toContain("run-a2-fixture");
  });
});
