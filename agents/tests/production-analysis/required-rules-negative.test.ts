import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  enumerateWorkingDates,
  evaluateCostAheadRule,
  evaluateMaterialOveruseRule,
  evaluateMissingDailyReportRule,
  evaluateOverdueRule,
  evaluateProductivityDeclineRule,
  evaluateStockShortageRule,
  evaluateSubcontractorDeviationRule,
} from "../../src/production-analysis/index.js";
import { buildProjectAnalysisSnapshot } from "../contracts/fixtures.js";

describe("required rule healthy controls", () => {
  it("keeps completed work out of overdue deviations", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.asOf = "2026-05-01T23:59:59.000Z";
    snapshot.workItems[0]!.status = "COMPLETED";
    snapshot.progressEntries[0]!.status = "COMPLETED";
    snapshot.progressEntries[0]!.progressPercent = 100;

    expect(evaluateOverdueRule(snapshot).status).toBe("NO_MATCH");
  });

  it("accepts material consumption within norm", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.asOf = "2026-03-31T23:59:59.000Z";
    snapshot.materialNorms[0]!.quantityPerWorkUnit = "1";
    snapshot.materialNorms[0]!.wastePercent = 0;
    snapshot.progressEntries[0]!.cumulativeQuantityDone = "100";
    snapshot.stockMovements = [
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "healthy-receipt",
        quantity: "1000",
      },
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "healthy-issue",
        kind: "ISSUE",
        quantity: "100",
        workItemId: "work-item-001",
        occurredAt: "2026-03-30T09:00:00.000Z",
        reference: "HEALTHY-ISSUE",
      },
    ];

    expect(evaluateMaterialOveruseRule(snapshot).status).toBe("NO_MATCH");
  });

  it("accepts stock with more than 14 days of coverage", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.asOf = "2026-03-31T23:59:59.000Z";
    snapshot.stockMovements = [
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "healthy-stock-receipt",
        quantity: "114",
        occurredAt: "2026-03-15T09:00:00.000Z",
      },
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "healthy-stock-issue",
        kind: "ISSUE",
        quantity: "14",
        occurredAt: "2026-03-30T09:00:00.000Z",
        reference: "HEALTHY-STOCK",
      },
    ];

    expect(evaluateStockShortageRule(snapshot).status).toBe("NO_MATCH");
  });

  it("accepts stable productivity", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const dates = enumerateWorkingDates(
      addWorkingDays("2026-03-31", -13, snapshot.activeBaseline.calendar),
      "2026-03-31",
      snapshot.activeBaseline.calendar,
    );
    snapshot.dailyReports = dates.map((date, index) => ({
      dailyReportId: `healthy-report-${index}`,
      date,
      reportedBy: "user-engineer",
      rawText: "Stable",
      status: "APPROVED",
      submittedAt: `${date}T10:00:00.000Z`,
      approvedBy: "user-manager",
      approvedAt: `${date}T11:00:00.000Z`,
      rejectionReason: null,
      sourceDraftId: null,
    }));
    let cumulative = 0;
    snapshot.progressEntries = dates.map((date, index) => {
      cumulative += 10;
      return {
        progressEntryId: `healthy-progress-${index}`,
        dailyReportId: `healthy-report-${index}`,
        workItemId: "work-item-001",
        capturedAt: `${date}T10:00:00.000Z`,
        quantityDoneIncrement: "10",
        cumulativeQuantityDone: String(cumulative),
        progressPercent: Math.min(100, cumulative / 2),
        status: "IN_PROGRESS",
        blockerReason: null,
        note: null,
        aiConfidence: null,
        humanEdited: false,
      };
    });

    expect(evaluateProductivityDeclineRule(snapshot).status).toBe("NO_MATCH");
  });

  it("accepts cost aligned with physical progress", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.asOf = "2026-03-31T23:59:59.000Z";
    snapshot.workItems[0]!.plannedQuantity = "100";
    snapshot.workItems[0]!.unitCostMnt = "100000.00";
    snapshot.progressEntries[0]!.progressPercent = 60;
    snapshot.costEntries = [
      {
        ...snapshot.costEntries[0]!,
        amountMnt: "6000000.00",
        occurredAt: "2026-03-30T10:00:00.000Z",
      },
    ];

    expect(evaluateCostAheadRule(snapshot).status).toBe("NO_MATCH");
  });

  it("accepts subcontractor progress on plan", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.subcontractors = [
      {
        subcontractorId: "healthy-subcontractor",
        code: "HEALTHY-SUB",
        name: "Хэвийн Гүйцэтгэгч ХХК",
        contractStart: "2026-03-01",
        contractEnd: "2026-06-30",
        contractValueMnt: "10000000.00",
      },
    ];
    snapshot.workItems[0]!.assigneeType = "SUBCONTRACTOR";
    snapshot.workItems[0]!.assigneeRef = "healthy-subcontractor";
    snapshot.workItems[0]!.subcontractorId = "healthy-subcontractor";
    snapshot.progressEntries[0]!.progressPercent = 90;

    expect(evaluateSubcontractorDeviationRule(snapshot).status).toBe("NO_MATCH");
  });

  it("accepts a complete approved-report calendar", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const dates = enumerateWorkingDates(
      addWorkingDays("2026-03-31", -13, snapshot.activeBaseline.calendar),
      "2026-03-31",
      snapshot.activeBaseline.calendar,
    );
    snapshot.dailyReports = dates.map((date, index) => ({
      dailyReportId: index === dates.length - 1 ? "report-001" : `healthy-complete-report-${index}`,
      date,
      reportedBy: "user-engineer",
      rawText: "Өдрийн тайлан",
      status: "APPROVED",
      submittedAt: `${date}T10:00:00.000Z`,
      approvedBy: "user-manager",
      approvedAt: `${date}T11:00:00.000Z`,
      rejectionReason: null,
      sourceDraftId: null,
    }));

    expect(evaluateMissingDailyReportRule(snapshot).status).toBe("NO_MATCH");
  });
});
