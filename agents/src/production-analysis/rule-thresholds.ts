export const PRODUCTION_RULE_THRESHOLDS = {
  materialOveruseRatio: 1.1,
  criticalStockCoverageDays: 7,
  warningStockCoverageDays: 14,
  productivityRatio: 0.8,
  costLeadPercentagePoints: 15,
  subcontractorLagPercentagePoints: 15,
  missingReportLookbackWorkingDays: 14,
  stalledWorkingDays: 7,
} as const;
