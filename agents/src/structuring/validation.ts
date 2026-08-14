import { z } from "zod";
import {
  isoDateSchema,
  projectUpdateExtractionSchema,
  projectUpdateFieldSchema,
  type ProjectUpdateExtraction,
  type ProjectUpdateField,
} from "./schema.js";

export const projectUpdateValidationSeveritySchema = z.enum(["ERROR", "WARNING"]);

export const projectUpdateValidationIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    severity: projectUpdateValidationSeveritySchema,
    fields: z.array(projectUpdateFieldSchema).min(1),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const projectUpdateValidationSchema = z
  .object({
    valid: z.boolean(),
    errorCount: z.number().int().nonnegative(),
    warningCount: z.number().int().nonnegative(),
    issues: z.array(projectUpdateValidationIssueSchema),
  })
  .strict();

export type ProjectUpdateValidation = z.infer<typeof projectUpdateValidationSchema>;

function dateValue(value: string) {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function moneyMinorUnits(value: string) {
  return BigInt(value.replace(".", ""));
}

export function validateProjectUpdateLogic(
  input: ProjectUpdateExtraction,
  referenceDateInput: string,
): ProjectUpdateValidation {
  const update = projectUpdateExtractionSchema.parse(input);
  const referenceDate = isoDateSchema.parse(referenceDateInput);
  const issues: z.infer<typeof projectUpdateValidationIssueSchema>[] = [];
  const issueCodes = new Set<string>();

  const addIssue = (
    code: string,
    severity: "ERROR" | "WARNING",
    fields: ProjectUpdateField[],
    message: string,
  ) => {
    if (issueCodes.has(code)) {
      return;
    }

    issueCodes.add(code);
    issues.push({ code, severity, fields, message });
  };

  if (
    update.plannedStartDate &&
    update.plannedEndDate &&
    dateValue(update.plannedStartDate) > dateValue(update.plannedEndDate)
  ) {
    addIssue(
      "PLANNED_DATE_ORDER",
      "ERROR",
      ["plannedStartDate", "plannedEndDate"],
      "Planned start date must not be after planned end date.",
    );
  }

  if (
    update.actualStartDate &&
    update.actualEndDate &&
    dateValue(update.actualStartDate) > dateValue(update.actualEndDate)
  ) {
    addIssue(
      "ACTUAL_DATE_ORDER",
      "ERROR",
      ["actualStartDate", "actualEndDate"],
      "Actual start date must not be after actual end date.",
    );
  }

  if (
    update.actualStartDate &&
    update.forecastEndDate &&
    dateValue(update.forecastEndDate) < dateValue(update.actualStartDate)
  ) {
    addIssue(
      "FORECAST_BEFORE_ACTUAL_START",
      "WARNING",
      ["actualStartDate", "forecastEndDate"],
      "Forecast end date is earlier than the actual start date.",
    );
  }

  if (
    update.status === "COMPLETED" &&
    update.progressPercent !== null &&
    update.progressPercent !== 100
  ) {
    addIssue(
      "COMPLETED_PROGRESS_MISMATCH",
      "ERROR",
      ["status", "progressPercent"],
      "Completed work must have 100 percent progress when progress is supplied.",
    );
  }

  if (
    update.progressPercent === 100 &&
    update.status !== null &&
    !["COMPLETED", "CANCELLED"].includes(update.status)
  ) {
    addIssue(
      "FULL_PROGRESS_STATUS_MISMATCH",
      "ERROR",
      ["status", "progressPercent"],
      "A 100 percent work item cannot remain planned, in progress, or blocked.",
    );
  }

  if (
    update.actualEndDate &&
    update.status !== null &&
    !["COMPLETED", "CANCELLED"].includes(update.status)
  ) {
    addIssue(
      "ACTUAL_END_STATUS_MISMATCH",
      "ERROR",
      ["actualEndDate", "status"],
      "An actual end date requires completed or cancelled status.",
    );
  }

  const issueTypes = new Set(update.issueTypes);

  if (update.budgetMnt && update.actualCostMnt) {
    const overBudget = moneyMinorUnits(update.actualCostMnt) > moneyMinorUnits(update.budgetMnt);

    if (overBudget && !issueTypes.has("BUDGET_OVERRUN")) {
      addIssue(
        "MISSING_BUDGET_OVERRUN",
        "ERROR",
        ["budgetMnt", "actualCostMnt", "issueTypes"],
        "Actual cost exceeds budget but BUDGET_OVERRUN is missing.",
      );
    } else if (!overBudget && issueTypes.has("BUDGET_OVERRUN")) {
      addIssue(
        "CONTRADICTORY_BUDGET_OVERRUN",
        "WARNING",
        ["budgetMnt", "actualCostMnt", "issueTypes"],
        "BUDGET_OVERRUN conflicts with the supplied budget and actual cost.",
      );
    }
  }

  if (update.actualCostMnt && update.ledgerTotalMnt) {
    const mismatched =
      moneyMinorUnits(update.actualCostMnt) !== moneyMinorUnits(update.ledgerTotalMnt);

    if (mismatched && !issueTypes.has("LEDGER_MISMATCH")) {
      addIssue(
        "MISSING_LEDGER_MISMATCH",
        "ERROR",
        ["actualCostMnt", "ledgerTotalMnt", "issueTypes"],
        "Recorded actual cost differs from the ledger but LEDGER_MISMATCH is missing.",
      );
    } else if (!mismatched && issueTypes.has("LEDGER_MISMATCH")) {
      addIssue(
        "CONTRADICTORY_LEDGER_MISMATCH",
        "WARNING",
        ["actualCostMnt", "ledgerTotalMnt", "issueTypes"],
        "LEDGER_MISMATCH conflicts with equal supplied cost totals.",
      );
    }
  }

  if (
    update.daysWithoutProgress !== null &&
    update.daysWithoutProgress >= 7 &&
    !issueTypes.has("STALLED_PROGRESS")
  ) {
    addIssue(
      "MISSING_STALLED_PROGRESS",
      "WARNING",
      ["daysWithoutProgress", "issueTypes"],
      "Seven or more days without progress should be classified as STALLED_PROGRESS.",
    );
  }

  if (
    update.daysWithoutProgress !== null &&
    update.daysWithoutProgress < 7 &&
    issueTypes.has("STALLED_PROGRESS")
  ) {
    addIssue(
      "CONTRADICTORY_STALLED_PROGRESS",
      "WARNING",
      ["daysWithoutProgress", "issueTypes"],
      "STALLED_PROGRESS conflicts with fewer than seven supplied stalled days.",
    );
  }

  if (
    update.actualStartDate &&
    update.predecessorStatus &&
    !["COMPLETED", "CANCELLED"].includes(update.predecessorStatus) &&
    !issueTypes.has("DEPENDENCY_VIOLATION")
  ) {
    addIssue(
      "MISSING_DEPENDENCY_VIOLATION",
      "WARNING",
      ["actualStartDate", "predecessorStatus", "issueTypes"],
      "Work started while its predecessor was unfinished but DEPENDENCY_VIOLATION is missing.",
    );
  }

  const asOf = update.reportDate ?? referenceDate;
  if (
    update.plannedEndDate &&
    update.status !== null &&
    !["COMPLETED", "CANCELLED"].includes(update.status) &&
    dateValue(update.plannedEndDate) < dateValue(asOf) &&
    !issueTypes.has("OVERDUE_WORK_ITEM")
  ) {
    addIssue(
      "MISSING_OVERDUE_WORK_ITEM",
      "ERROR",
      ["plannedEndDate", "status", "issueTypes"],
      "Unfinished work is past its planned end date but OVERDUE_WORK_ITEM is missing.",
    );
  }

  const errorCount = issues.filter((issue) => issue.severity === "ERROR").length;
  const warningCount = issues.length - errorCount;

  return projectUpdateValidationSchema.parse({
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues,
  });
}
