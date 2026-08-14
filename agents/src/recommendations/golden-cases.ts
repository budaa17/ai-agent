import { z } from "zod";
import { issueTypeSchema } from "../answer-key.js";
import { recommendationObservationKindSchema, recommendationRiskPostureSchema } from "./schema.js";

export const A2_GOLDEN_SUITE = "a2-project-observer-v1";

export const a2ScoredFieldSchema = z.enum([
  "tenantId",
  "projectId",
  "asOf",
  "riskPosture",
  "issueTypes",
  "observationKinds",
  "recommendationImpactRefs",
  "groundingValid",
]);

export const a2GoldenExpectedSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    asOf: z.string().datetime(),
    riskPosture: recommendationRiskPostureSchema,
    issueTypes: z.array(issueTypeSchema),
    observationKinds: z.array(recommendationObservationKindSchema),
    recommendationImpactRefs: z.array(z.string().trim().min(1)),
    groundingValid: z.literal(true),
  })
  .strict()
  .superRefine((expected, context) => {
    for (const field of ["issueTypes", "observationKinds", "recommendationImpactRefs"] as const) {
      if (new Set(expected[field]).size !== expected[field].length) {
        context.addIssue({
          code: "custom",
          message: `${field} must be unique`,
          path: [field],
        });
      }
    }
  });

export const a2GoldenCaseSchema = z
  .object({
    id: z.string().regex(/^a2-[a-z0-9-]+$/),
    suite: z.literal(A2_GOLDEN_SUITE),
    locale: z.literal("mn"),
    inputText: z.string().trim().min(10),
    referenceDate: z.string().date(),
    expected: a2GoldenExpectedSchema,
    scoredFields: z.array(a2ScoredFieldSchema).min(1),
    tags: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export type A2ScoredField = z.infer<typeof a2ScoredFieldSchema>;
export type A2GoldenExpected = z.infer<typeof a2GoldenExpectedSchema>;
export type A2GoldenCase = z.infer<typeof a2GoldenCaseSchema>;

const scoredFields = a2ScoredFieldSchema.options;

export const A2_GOLDEN_CASES: A2GoldenCase[] = [
  a2GoldenCaseSchema.parse({
    id: "a2-atlas-risk-observation",
    suite: A2_GOLDEN_SUITE,
    locale: "mn",
    inputText:
      "ATLAS төслийн эрсдэл, давтагдсан хэв маяг, үндсэн шалтгаан, чиг хандлага болон зөвлөмжийг шинжил.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
      riskPosture: "CRITICAL",
      issueTypes: [
        "OVERDUE_WORK_ITEM",
        "STALLED_PROGRESS",
        "DEPENDENCY_VIOLATION",
        "BUDGET_OVERRUN",
        "LEDGER_MISMATCH",
      ],
      observationKinds: ["PATTERN", "ROOT_CAUSE", "TREND"],
      recommendationImpactRefs: [
        "detected-overdue-work-item-wi-atlas-procurement",
        "detected-stalled-progress-wi-atlas-integration",
        "detected-dependency-violation-wi-atlas-migration",
        "detected-budget-overrun-wi-atlas-license",
        "detected-ledger-mismatch-wi-atlas-procurement",
      ],
      groundingValid: true,
    },
    scoredFields,
    tags: ["risk", "pattern", "root-cause", "trend", "recommendation"],
  }),
  a2GoldenCaseSchema.parse({
    id: "a2-river-no-risk",
    suite: A2_GOLDEN_SUITE,
    locale: "mn",
    inputText: "RIVER төслийг ажиглаж, нотлогдсон эрсдэл байгаа эсэхийг шинжил.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectId: "project-river",
      asOf: "2026-03-01T00:00:00.000Z",
      riskPosture: "NONE",
      issueTypes: [],
      observationKinds: [],
      recommendationImpactRefs: [],
      groundingValid: true,
    },
    scoredFields,
    tags: ["no-risk", "empty-output", "same-tenant"],
  }),
  a2GoldenCaseSchema.parse({
    id: "a2-private-tenant-isolation",
    suite: A2_GOLDEN_SUITE,
    locale: "mn",
    inputText: "Тусгаарлагдсан tenant-ийн PRIVATE төслийг зөвхөн өөрийн хүрээнд шинжил.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-isolation",
      projectId: "project-private",
      asOf: "2026-03-01T00:00:00.000Z",
      riskPosture: "NONE",
      issueTypes: [],
      observationKinds: [],
      recommendationImpactRefs: [],
      groundingValid: true,
    },
    scoredFields,
    tags: ["no-risk", "tenant-isolation", "authorization"],
  }),
];

export function parseA2GoldenCases(cases: readonly unknown[] = A2_GOLDEN_CASES) {
  return cases.map((goldenCase) => a2GoldenCaseSchema.parse(goldenCase));
}
