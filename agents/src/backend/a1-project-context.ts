import type { ProjectUpdateExtraction, ProjectUpdateField } from "../structuring/schema.js";
import {
  projectUpdateValidationSchema,
  type ProjectUpdateValidation,
} from "../structuring/validation.js";

type ContextIssue = {
  code: string;
  fields: ProjectUpdateField[];
  message: string;
};

function normalizeReference(value: string) {
  return value.trim().toLocaleUpperCase("en-US");
}

export function addA1ProjectContextValidation(input: {
  update: ProjectUpdateExtraction;
  validation: ProjectUpdateValidation;
  selectedProjectCode: string;
  knownWorkItemCodes: readonly string[];
}) {
  const issues: ContextIssue[] = [];
  const knownCodes = new Set(input.knownWorkItemCodes.map(normalizeReference));
  const addIssue = (issue: ContextIssue) => {
    if (!input.validation.issues.some((entry) => entry.code === issue.code)) {
      issues.push(issue);
    }
  };

  if (
    input.update.projectCode !== null &&
    normalizeReference(input.update.projectCode) !== normalizeReference(input.selectedProjectCode)
  ) {
    addIssue({
      code: "PROJECT_CODE_SCOPE_MISMATCH",
      fields: ["projectCode"],
      message: `Project code must match the selected project (${input.selectedProjectCode}).`,
    });
  }

  if (
    input.update.workItemCode !== null &&
    !knownCodes.has(normalizeReference(input.update.workItemCode))
  ) {
    addIssue({
      code: "UNKNOWN_WORK_ITEM",
      fields: ["workItemCode"],
      message: `Work item ${input.update.workItemCode} does not exist in the selected project.`,
    });
  }

  if (
    input.update.predecessorWorkItemCode !== null &&
    !knownCodes.has(normalizeReference(input.update.predecessorWorkItemCode))
  ) {
    addIssue({
      code: "UNKNOWN_PREDECESSOR_WORK_ITEM",
      fields: ["predecessorWorkItemCode"],
      message: `Predecessor ${input.update.predecessorWorkItemCode} does not exist in the selected project.`,
    });
  }

  if (
    input.update.workItemCode !== null &&
    input.update.predecessorWorkItemCode !== null &&
    normalizeReference(input.update.workItemCode) ===
      normalizeReference(input.update.predecessorWorkItemCode)
  ) {
    addIssue({
      code: "SELF_DEPENDENCY",
      fields: ["workItemCode", "predecessorWorkItemCode"],
      message: "A work item cannot depend on itself.",
    });
  }

  const mergedIssues = [
    ...input.validation.issues,
    ...issues.map((issue) => ({ ...issue, severity: "ERROR" as const })),
  ];
  const errorCount = mergedIssues.filter((issue) => issue.severity === "ERROR").length;
  return projectUpdateValidationSchema.parse({
    valid: errorCount === 0,
    errorCount,
    warningCount: mergedIssues.length - errorCount,
    issues: mergedIssues,
  });
}
