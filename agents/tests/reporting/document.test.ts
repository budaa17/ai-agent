import { describe, expect, it } from "vitest";
import {
  a3DocumentBundleSchema,
  createA3DocumentBundle,
  renderA3DocumentMarkdown,
} from "../../src/reporting/document.js";
import { buildProjectReportFixture } from "./fixtures.js";

describe("A3 document bundle", () => {
  it("creates report, conclusion, and official-letter drafts", () => {
    const fixture = buildProjectReportFixture();
    const bundle = createA3DocumentBundle(fixture.projectReport, {
      requestId: "request-a3-documents",
    });

    expect(bundle.documents.map((document) => document.type)).toEqual([
      "PROJECT_REPORT",
      "EXECUTIVE_CONCLUSION",
      "OFFICIAL_LETTER",
    ]);

    const conclusion = bundle.documents.find(
      (document) => document.type === "EXECUTIVE_CONCLUSION",
    )!;
    const letter = bundle.documents.find((document) => document.type === "OFFICIAL_LETTER")!;

    expect(conclusion.body).toContain("5 баталгаажсан асуудал");
    expect(conclusion.body).toContain("125 хоног");
    expect(letter.sourceIssueIds).toHaveLength(5);
    expect(renderA3DocumentMarkdown(letter)).toContain("Хүсэж буй шийдвэр");
  });

  it("rejects source IDs absent from the grounded project report", () => {
    const fixture = buildProjectReportFixture();
    const bundle = createA3DocumentBundle(fixture.projectReport, {
      requestId: "request-a3-invalid-source",
    });
    const conclusion = bundle.documents.find(
      (document) => document.type === "EXECUTIVE_CONCLUSION",
    )!;
    conclusion.sourceIssueIds.push("invented-issue");

    expect(() => a3DocumentBundleSchema.parse(bundle)).toThrow("Unknown A3 source issue");
  });
});
