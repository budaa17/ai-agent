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

describe("required rule boundaries", () => {
  it("does not flag overdue when planned end equals as-of", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.workItems[0]!.plannedEnd = "2026-03-31";

    expect(evaluateOverdueRule(snapshot).status).toBe("NO_MATCH");
  });

  it("does not flag material use exactly at the 110% boundary", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.materialNorms[0]!.quantityPerWorkUnit = "1";
    snapshot.materialNorms[0]!.wastePercent = 0;
    snapshot.progressEntries[0]!.cumulativeQuantityDone = "100";
    snapshot.progressEntries[0]!.progressPercent = 50;
    snapshot.stockMovements = [
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "stock-receipt-boundary",
        quantity: "1000",
      },
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "stock-issue-boundary",
        kind: "ISSUE",
        quantity: "110",
        workItemId: "work-item-001",
        occurredAt: "2026-03-30T09:00:00.000Z",
        reference: "BOUNDARY-110",
      },
    ];

    expect(evaluateMaterialOveruseRule(snapshot).status).toBe("NO_MATCH");
  });

  it("does not flag stock with exactly 14 days of coverage", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.stockMovements = [
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "stock-receipt-coverage",
        quantity: "28",
        occurredAt: "2026-03-15T09:00:00.000Z",
      },
      {
        ...snapshot.stockMovements[0]!,
        stockMovementId: "stock-issue-coverage",
        kind: "ISSUE",
        quantity: "14",
        occurredAt: "2026-03-30T09:00:00.000Z",
        reference: "COVERAGE-14",
      },
    ];

    expect(evaluateStockShortageRule(snapshot).status).toBe("NO_MATCH");
  });

  it("does not flag productivity exactly at the 80% boundary", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const dates = enumerateWorkingDates(
      addWorkingDays("2026-03-31", -13, snapshot.activeBaseline.calendar),
      "2026-03-31",
      snapshot.activeBaseline.calendar,
    );
    snapshot.dailyReports = dates.map((date, index) => ({
      dailyReportId: `report-productivity-${index}`,
      date,
      reportedBy: "user-engineer",
      rawText: "Boundary",
      status: "APPROVED",
      submittedAt: `${date}T10:00:00.000Z`,
      approvedBy: "user-manager",
      approvedAt: `${date}T11:00:00.000Z`,
      rejectionReason: null,
      sourceDraftId: null,
    }));
    let cumulative = 0;
    snapshot.progressEntries = dates.map((date, index) => {
      const increment = index < 7 ? 10 : 8;
      cumulative += increment;
      return {
        progressEntryId: `progress-productivity-${index}`,
        dailyReportId: `report-productivity-${index}`,
        workItemId: "work-item-001",
        capturedAt: `${date}T10:00:00.000Z`,
        quantityDoneIncrement: String(increment),
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

  it("does not flag cost exactly 15 points ahead of progress", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.workItems[0]!.plannedQuantity = "100";
    snapshot.workItems[0]!.unitCostMnt = "100000.00";
    snapshot.progressEntries[0]!.progressPercent = 60;
    snapshot.costEntries = [
      {
        ...snapshot.costEntries[0]!,
        amountMnt: "7500000.00",
        occurredAt: "2026-03-30T10:00:00.000Z",
      },
    ];

    expect(evaluateCostAheadRule(snapshot).status).toBe("NO_MATCH");
  });

  it("does not flag subcontractor exactly 15 points behind", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    snapshot.subcontractors = [
      {
        subcontractorId: "subcontractor-001",
        code: "SUB-001",
        name: "Boundary ХХК",
        contractStart: "2026-03-01",
        contractEnd: "2026-06-30",
        contractValueMnt: "10000000.00",
      },
    ];
    snapshot.workItems[0]!.assigneeType = "SUBCONTRACTOR";
    snapshot.workItems[0]!.assigneeRef = "subcontractor-001";
    snapshot.workItems[0]!.subcontractorId = "subcontractor-001";
    snapshot.workItems[0]!.plannedEnd = "2026-03-31";
    snapshot.progressEntries[0]!.progressPercent = 85;

    expect(evaluateSubcontractorDeviationRule(snapshot).status).toBe("NO_MATCH");
  });

  it("does not flag reports when every expected workday is approved", () => {
    const snapshot = buildProjectAnalysisSnapshot();
    const dates = enumerateWorkingDates(
      addWorkingDays("2026-03-31", -13, snapshot.activeBaseline.calendar),
      "2026-03-31",
      snapshot.activeBaseline.calendar,
    );
    snapshot.dailyReports = dates.map((date, index) => ({
      dailyReportId: index === dates.length - 1 ? "report-001" : `report-complete-${index}`,
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
