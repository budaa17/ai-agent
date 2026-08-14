import { describe, expect, it } from "vitest";
import {
  a3DocumentTools,
  collectA3ReportEvidenceCore,
  createA3DocumentToolsContext,
} from "../../src/reporting/tools.js";

describe("A3 document tools", () => {
  it("exposes evidence and approval tools in tenant scope", () => {
    const scope = {
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
    };

    expect(Object.keys(a3DocumentTools)).toEqual([
      "collectReportEvidence",
      "inspectApprovalDrafts",
    ]);
    expect(createA3DocumentToolsContext(scope)).toEqual({
      collectReportEvidence: scope,
      inspectApprovalDrafts: scope,
    });
  });

  it("collects deterministic A3 evidence", async () => {
    const evidence = await collectA3ReportEvidenceCore(
      {
        tenantId: "tenant-demo",
        projectIds: ["project-atlas"],
      },
      {
        projectRef: "project-atlas",
        asOf: "2026-03-01T00:00:00.000Z",
      },
    );

    expect(evidence.analysis.summary).toMatchObject({
      issueCount: 5,
      workItemCount: 9,
    });
  });
});
