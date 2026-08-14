import { describe, expect, it } from "vitest";
import { buildWorkspaceFixture } from "../test/workspace-fixture";
import { latestActionableReviews, reviewReadiness } from "./review-readiness";

const versions = {
  quantityVersions: [{ id: "quantity-v2", status: "REVIEW_REQUIRED", versionNumber: 2 }],
  estimateVersions: [
    {
      id: "estimate-v2",
      status: "REVIEW_REQUIRED",
      versionNumber: 2,
      quantityVersionId: "quantity-v2",
    },
  ],
  baselines: [
    {
      id: "baseline-v2",
      status: "REVIEW_REQUIRED",
      versionNumber: 2,
      quantityVersionId: "quantity-v2",
      estimateVersionId: "estimate-v2",
      scheduleVersionId: "schedule-v2",
    },
  ],
  scheduleVersions: [{ id: "schedule-v2", status: "REVIEW_REQUIRED", versionNumber: 2 }],
};

describe("reviewReadiness", () => {
  it("estimate-ийг quantity батлагдахаас өмнө хаана", () => {
    const workspace = buildWorkspaceFixture({
      commercial: {
        ...buildWorkspaceFixture().commercial,
        quantityVersions: versions.quantityVersions,
        estimateVersions: versions.estimateVersions,
        baselines: versions.baselines,
      },
      schedule: { ...buildWorkspaceFixture().schedule, versions: versions.scheduleVersions },
    });

    const result = reviewReadiness(workspace, {
      targetType: "ESTIMATE",
      targetId: "estimate-v2",
    });
    expect(result.ready).toBe(false);
    expect(result.unmet).toEqual([
      expect.objectContaining({ targetType: "QUANTITY_TAKEOFF", status: "REVIEW_REQUIRED" }),
    ]);
  });

  it("baseline-ийн бүх dependency батлагдсан үед зөвшөөрнө", () => {
    const workspace = buildWorkspaceFixture({
      commercial: {
        ...buildWorkspaceFixture().commercial,
        quantityVersions: [{ ...versions.quantityVersions[0], status: "APPROVED" }],
        estimateVersions: [{ ...versions.estimateVersions[0], status: "APPLIED" }],
        baselines: versions.baselines,
      },
      schedule: {
        ...buildWorkspaceFixture().schedule,
        versions: [{ ...versions.scheduleVersions[0], status: "APPROVED" }],
      },
    });

    expect(
      reviewReadiness(workspace, { targetType: "BASELINE", targetId: "baseline-v2" }).ready,
    ).toBe(true);
  });
});

describe("latestActionableReviews", () => {
  it("versioned task бүрийн зөвхөн хамгийн шинэ хувилбарыг дарааллаар харуулна", () => {
    const result = latestActionableReviews([
      { id: "baseline-v1", targetType: "BASELINE", targetVersion: 1 },
      { id: "schedule-v2", targetType: "SCHEDULE", targetVersion: 2 },
      { id: "estimate-v2", targetType: "ESTIMATE", targetVersion: 2 },
      { id: "baseline-v2", targetType: "BASELINE", targetVersion: 2 },
      { id: "estimate-v1", targetType: "ESTIMATE", targetVersion: 1 },
    ]);

    expect(result.map((task) => task.id)).toEqual(["estimate-v2", "schedule-v2", "baseline-v2"]);
  });
});
