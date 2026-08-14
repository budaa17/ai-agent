import { describe, expect, it } from "vitest";
import {
  a1RegistrationContent,
  a1RegistrationLifecycleStatus,
  a1RegistrationSourceHash,
} from "../../src/backend/a1-review.js";

const draft = {
  id: "draft-a1-001",
  tenantId: "tenant-alpha",
  projectId: "project-alpha-main",
  sourceSha256: "b".repeat(64),
  referenceDate: new Date("2026-08-10T00:00:00.000Z"),
  status: "READY_FOR_REVIEW" as const,
  rowVersion: 1,
  structuredData: { schemaVersion: 1, workItemCode: "BW-001", progressPercent: 35 },
  confidence: { overall: 0.91, level: "HIGH", fields: [] },
  validation: { valid: true, errorCount: 0, warningCount: 0, issues: [] },
  createdAt: new Date("2026-08-10T01:00:00.000Z"),
};

describe("A1 canonical review snapshot", () => {
  it("lifecycle metadata өөрчлөгдөхөд source hash өөрчлөгдөхгүй", () => {
    const original = a1RegistrationSourceHash(draft);
    expect(
      a1RegistrationSourceHash({ ...draft, status: "APPROVED", rowVersion: 1 }),
    ).toBe(original);
    expect(a1RegistrationContent(draft)).not.toHaveProperty("status");
  });

  it("human correction content өөрчлөгдвөл source hash өөрчлөгдөнө", () => {
    expect(
      a1RegistrationSourceHash({
        ...draft,
        rowVersion: 2,
        structuredData: { ...draft.structuredData, progressPercent: 40 },
      }),
    ).not.toBe(a1RegistrationSourceHash(draft));
  });

  it.each([
    ["PROCESSING", "DRAFT"],
    ["READY_FOR_REVIEW", "REVIEW_REQUIRED"],
    ["NEEDS_CORRECTION", "REVIEW_REQUIRED"],
    ["APPROVED", "APPROVED"],
    ["APPLIED", "APPLIED"],
    ["REJECTED", "REJECTED"],
    ["FAILED", "CANCELLED"],
  ] as const)("%s status-ийг %s lifecycle болгоно", (status, lifecycle) => {
    expect(a1RegistrationLifecycleStatus(status)).toBe(lifecycle);
  });
});
