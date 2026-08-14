import { describe, expect, it } from "vitest";
import {
  approvedDailyReportCommandV1Schema,
  dailyReportDraftV1Schema,
} from "../../src/contracts/index.js";
import { buildDailyReportDraft } from "./fixtures.js";

describe("DailyReportDraftV1", () => {
  it("accepts a multi-entry human-review draft", () => {
    const result = dailyReportDraftV1Schema.parse(buildDailyReportDraft());

    expect(result.progressEntries).toHaveLength(1);
    expect(result.attendanceEntries).toHaveLength(1);
    expect(result.status).toBe("READY_FOR_REVIEW");
    expect(result.requiresHumanReview).toBe(true);
  });

  it("keeps an incomplete quantity in a reviewable draft", () => {
    const draft = buildDailyReportDraft();
    draft.progressEntries[0] = {
      ...draft.progressEntries[0],
      unit: null,
    };

    const result = dailyReportDraftV1Schema.safeParse(draft);

    expect(result.success).toBe(true);
  });

  it("rejects approval while a quantity has no unit", () => {
    const draft = buildDailyReportDraft();
    draft.progressEntries[0] = {
      ...draft.progressEntries[0],
      unit: null,
    };
    const result = approvedDailyReportCommandV1Schema.safeParse({
      schemaVersion: 1,
      commandType: "APPROVE_DAILY_REPORT",
      commandId: "command-quantity",
      idempotencyKey: "approve-draft-quantity",
      tenantId: draft.tenantId,
      projectId: draft.projectId,
      draftId: draft.draftId,
      reviewedBy: "user-manager",
      reviewedAt: "2026-03-31T11:00:00.000Z",
      approvedDraft: {
        ...draft,
        status: "APPROVED",
      },
      humanEditedFieldPaths: [],
      reviewNote: null,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a confidence level that conflicts with its score", () => {
    const draft = buildDailyReportDraft();
    draft.confidenceLevel = "LOW";

    const result = dailyReportDraftV1Schema.safeParse(draft);

    expect(result.success).toBe(false);
  });

  it("rejects an approval command whose tenant scope differs", () => {
    const approvedDraft = {
      ...buildDailyReportDraft(),
      status: "APPROVED" as const,
    };
    const result = approvedDailyReportCommandV1Schema.safeParse({
      schemaVersion: 1,
      commandType: "APPROVE_DAILY_REPORT",
      commandId: "command-001",
      idempotencyKey: "approve-draft-001",
      tenantId: "tenant-other",
      projectId: "project-atlas",
      draftId: "draft-001",
      reviewedBy: "user-manager",
      reviewedAt: "2026-03-31T11:00:00.000Z",
      approvedDraft,
      humanEditedFieldPaths: [],
      reviewNote: null,
    });

    expect(result.success).toBe(false);
  });
});
