import { describe, expect, it } from "vitest";
import {
  getAlertsCore,
  getAttendanceStatsCore,
  getBlockerHistoryCore,
  getConsumptionVsNormCore,
  getProductionProgressHistoryCore,
  getProductionWorkItemsCore,
  getProjectSummaryCore,
  getScheduleForecastCore,
  getStockStatusCore,
  getSubcontractorPerformanceCore,
  searchDailyReportsCore,
} from "../../src/production-tools/index.js";
import { authorizedContext, repository } from "./fixtures.js";

const projectId = "project-buildwatch-simulation";

describe("11 production read-only tool cores", () => {
  it("getProjectSummary returns scoped aggregate and forecast", async () => {
    const result = await getProjectSummaryCore(repository, authorizedContext, { projectId });

    expect(result.summary.projectCode).toBe("BW-SIM");
    expect(result.summary.workItemCount).toBe(48);
    expect(result.meta.toolName).toBe("getProjectSummary");
    expect(result.meta.sourceCatalog.length).toBeGreaterThan(0);
  });

  it("getWorkItems returns a bounded sample and total", async () => {
    const result = await getProductionWorkItemsCore(repository, authorizedContext, {
      projectId,
      limit: 3,
    });

    expect(result.items).toHaveLength(3);
    expect(result.meta.rowCount).toBe(48);
    expect(result.meta.truncated).toBe(true);
  });

  it("getProgressHistory returns approved progress evidence", async () => {
    const result = await getProductionProgressHistoryCore(repository, authorizedContext, {
      projectId,
      workItemIds: ["work-item-017"],
      limit: 5,
    });

    expect(result.items).toHaveLength(5);
    expect(result.items.every((entry) => entry.workItemId === "work-item-017")).toBe(true);
  });

  it("getStockStatus returns the intentional brick shortage", async () => {
    const result = await getStockStatusCore(repository, authorizedContext, {
      projectId,
      materialIds: ["material-brick"],
    });

    expect(result.items[0]?.status).toBe("CRITICAL");
    expect(result.items[0]?.coverageWorkingDays).toBeLessThan(7);
  });

  it("getConsumptionVsNorm returns the over-norm item", async () => {
    const result = await getConsumptionVsNormCore(repository, authorizedContext, {
      projectId,
      workItemIds: ["work-item-023"],
    });

    expect(result.items[0]?.status).toBe("OVER_NORM");
    expect(result.summary.overNormCount).toBe(1);
  });

  it("getAttendanceStats aggregates person-days and hours", async () => {
    const result = await getAttendanceStatsCore(repository, authorizedContext, {
      projectId,
      limit: 5,
    });

    expect(result.summary.totalPersonDays).toBeGreaterThan(0);
    expect(result.summary.totalHours).toBeGreaterThan(0);
    expect(result.items).toHaveLength(5);
  });

  it("getBlockerHistory identifies repeated supplier evidence", async () => {
    const result = await getBlockerHistoryCore(repository, authorizedContext, {
      projectId,
      supplierName: "Цемент Нийлүүлэлт",
    });

    expect(result.meta.rowCount).toBe(3);
    expect(result.summary.repeatedSupplierCount).toBe(1);
  });

  it("getAlerts returns deterministic alert lifecycle rows", async () => {
    const result = await getAlertsCore(repository, authorizedContext, {
      projectId,
      severities: ["CRITICAL", "HIGH"],
    });

    expect(result.meta.rowCount).toBeGreaterThan(0);
    expect(result.summary.bySeverity.CRITICAL).toBeGreaterThan(0);
  });

  it("getScheduleForecast exposes calendar-aware projection", async () => {
    const result = await getScheduleForecastCore(repository, authorizedContext, {
      projectId,
      limit: 4,
    });

    expect(result.items).toHaveLength(4);
    expect(result.summary.criticalWorkItemIds.length).toBeGreaterThan(0);
    expect(result.summary.projectedEndDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("getSubcontractorPerformance returns delayed contractor", async () => {
    const result = await getSubcontractorPerformanceCore(repository, authorizedContext, {
      projectId,
      subcontractorIds: ["subcontractor-facade"],
    });

    expect(result.items[0]?.performanceStatus).toBe("DELAYED");
    expect(result.items[0]?.actualCostMnt).toMatch(/^\d+\.\d{2}$/);
  });

  it("searchDailyReports returns untrusted text as evidence", async () => {
    const result = await searchDailyReportsCore(repository, authorizedContext, {
      projectId,
      query: "Өдрийн тайлан",
      limit: 3,
    });

    expect(result.items).toHaveLength(3);
    expect(result.summary.matchedReportCount).toBeGreaterThan(3);
    expect(result.meta.toolName).toBe("searchDailyReports");
  });
});
