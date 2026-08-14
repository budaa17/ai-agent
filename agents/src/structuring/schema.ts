import { z } from "zod";
import { issueTypeSchema } from "../answer-key.js";

export const PROJECT_UPDATE_FIELDS = [
  "language",
  "projectCode",
  "workItemCode",
  "workItemName",
  "reportDate",
  "status",
  "priority",
  "progressPercent",
  "previousProgressPercent",
  "plannedStartDate",
  "plannedEndDate",
  "actualStartDate",
  "actualEndDate",
  "forecastEndDate",
  "budgetMnt",
  "actualCostMnt",
  "ledgerTotalMnt",
  "daysWithoutProgress",
  "predecessorWorkItemCode",
  "predecessorStatus",
  "issueTypes",
] as const;

export const projectUpdateFieldSchema = z.enum(PROJECT_UPDATE_FIELDS);
export const projectUpdateLanguageSchema = z.enum(["mn", "en", "mixed"]);
export const projectUpdateStatusSchema = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
]);
export const projectUpdatePrioritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");
export const moneyMntSchema = z
  .string()
  .regex(/^\d+\.\d{2}$/, "Money must be a decimal string such as 27000000.00");

const nullableReferenceSchema = z.string().trim().min(1).max(200).nullable();
const nullableDateSchema = isoDateSchema.nullable();
const nullableProgressSchema = z.number().int().min(0).max(100).nullable();

export const projectUpdateExtractionSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(1).describe("Schema version. Always 1."),
    language: projectUpdateLanguageSchema.describe(
      "Dominant language of the source: mn, en, or mixed.",
    ),
    projectCode: nullableReferenceSchema.describe(
      "Explicit project code or short project reference. Null when absent.",
    ),
    workItemCode: nullableReferenceSchema.describe("Explicit work-item code. Null when absent."),
    workItemName: nullableReferenceSchema.describe(
      "Explicit work-item name, preserving the source wording. Null when absent.",
    ),
    reportDate: nullableDateSchema.describe(
      "Explicit report date resolved to YYYY-MM-DD. Null when absent.",
    ),
    status: projectUpdateStatusSchema
      .nullable()
      .describe("Normalized explicit work status. Null when absent."),
    priority: projectUpdatePrioritySchema
      .nullable()
      .describe("Normalized explicit priority. Null when absent."),
    progressPercent: nullableProgressSchema.describe(
      "Current explicit completion percentage. Null when absent.",
    ),
    previousProgressPercent: nullableProgressSchema.describe(
      "Previous explicit completion percentage. Null when absent.",
    ),
    plannedStartDate: nullableDateSchema.describe("Explicit planned start date. Null when absent."),
    plannedEndDate: nullableDateSchema.describe("Explicit planned end date. Null when absent."),
    actualStartDate: nullableDateSchema.describe("Explicit actual start date. Null when absent."),
    actualEndDate: nullableDateSchema.describe(
      "Explicit actual completion date. Null when absent.",
    ),
    forecastEndDate: nullableDateSchema.describe(
      "Explicit forecast completion date. Null when absent.",
    ),
    budgetMnt: moneyMntSchema
      .nullable()
      .describe("Explicit budget in MNT as a two-decimal string. Null when absent."),
    actualCostMnt: moneyMntSchema
      .nullable()
      .describe("Explicit recorded actual cost in MNT as a two-decimal string. Null when absent."),
    ledgerTotalMnt: moneyMntSchema
      .nullable()
      .describe("Explicit ledger total in MNT as a two-decimal string. Null when absent."),
    daysWithoutProgress: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .nullable()
      .describe("Explicit number of days without progress. Null when absent."),
    predecessorWorkItemCode: nullableReferenceSchema.describe(
      "Explicit predecessor work-item code. Null when absent.",
    ),
    predecessorStatus: projectUpdateStatusSchema
      .nullable()
      .describe("Explicit normalized predecessor status. Null when absent."),
    issueTypes: z
      .array(issueTypeSchema)
      .max(5)
      .describe("Issue types directly stated or unambiguously supported by the supplied facts."),
  })
  .strict();

export const projectUpdateFieldConfidenceSchema = z
  .object({
    field: projectUpdateFieldSchema,
    score: z.number().min(0).max(1),
    evidence: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();

export const projectUpdateModelOutputSchema = z
  .object({
    update: projectUpdateExtractionSchema,
    confidence: z
      .object({
        fields: z.array(projectUpdateFieldConfidenceSchema).max(PROJECT_UPDATE_FIELDS.length),
      })
      .strict(),
  })
  .strict()
  .superRefine((output, context) => {
    const fields = new Set<ProjectUpdateField>();

    for (const [index, confidence] of output.confidence.fields.entries()) {
      if (fields.has(confidence.field)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate confidence field: ${confidence.field}`,
          path: ["confidence", "fields", index, "field"],
        });
      }

      fields.add(confidence.field);
    }

    for (const field of PROJECT_UPDATE_FIELDS) {
      const value = output.update[field];
      const populated = Array.isArray(value) ? value.length > 0 : value !== null;

      if (populated && !fields.has(field)) {
        context.addIssue({
          code: "custom",
          message: `Confidence is required for populated field: ${field}`,
          path: ["confidence", "fields"],
        });
      }
    }
  });

export const projectUpdateConfidenceLevelSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const projectUpdateConfidenceSchema = z
  .object({
    overall: z.number().min(0).max(1),
    level: projectUpdateConfidenceLevelSchema,
    fields: z.array(projectUpdateFieldConfidenceSchema).max(PROJECT_UPDATE_FIELDS.length),
  })
  .strict();

export type ProjectUpdateExtraction = z.infer<typeof projectUpdateExtractionSchema>;
export type ProjectUpdateField = z.infer<typeof projectUpdateFieldSchema>;
export type ProjectUpdateFieldConfidence = z.infer<typeof projectUpdateFieldConfidenceSchema>;
export type ProjectUpdateModelOutput = z.infer<typeof projectUpdateModelOutputSchema>;
export type ProjectUpdateConfidence = z.infer<typeof projectUpdateConfidenceSchema>;

export function makeProjectUpdate(
  overrides: Partial<ProjectUpdateExtraction> = {},
): ProjectUpdateExtraction {
  return projectUpdateExtractionSchema.parse({
    schemaVersion: 1,
    language: "mn",
    projectCode: null,
    workItemCode: null,
    workItemName: null,
    reportDate: null,
    status: null,
    priority: null,
    progressPercent: null,
    previousProgressPercent: null,
    plannedStartDate: null,
    plannedEndDate: null,
    actualStartDate: null,
    actualEndDate: null,
    forecastEndDate: null,
    budgetMnt: null,
    actualCostMnt: null,
    ledgerTotalMnt: null,
    daysWithoutProgress: null,
    predecessorWorkItemCode: null,
    predecessorStatus: null,
    issueTypes: [],
    ...overrides,
  });
}
