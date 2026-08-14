import { z } from "zod";
import { recommendationRiskPostureSchema } from "../recommendations/schema.js";
import { a3DocumentTypeSchema } from "./document.js";

export const A3_GOLDEN_SUITE = "a3-document-agent-v1";

export const a3ScoredFieldSchema = z.enum([
  "tenantId",
  "projectId",
  "asOf",
  "documentTypes",
  "workItemCount",
  "issueCount",
  "projectDurationDays",
  "riskPosture",
  "precision",
  "recall",
  "forecastErrorDays",
  "draftStatus",
  "numericNarrativeSafe",
]);

export const a3GoldenExpectedSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectId: z.string().trim().min(1),
    asOf: z.string().datetime(),
    documentTypes: z.array(a3DocumentTypeSchema).length(3),
    workItemCount: z.number().int().positive(),
    issueCount: z.number().int().nonnegative(),
    projectDurationDays: z.number().int().positive(),
    riskPosture: recommendationRiskPostureSchema,
    precision: z.number().min(0).max(1),
    recall: z.number().min(0).max(1),
    forecastErrorDays: z.number().int().nonnegative().nullable(),
    draftStatus: z.literal("PENDING_APPROVAL"),
    numericNarrativeSafe: z.literal(true),
  })
  .strict();

export const a3GoldenCaseSchema = z
  .object({
    id: z.string().regex(/^a3-[a-z0-9-]+$/),
    suite: z.literal(A3_GOLDEN_SUITE),
    locale: z.literal("mn"),
    inputText: z.string().trim().min(10),
    referenceDate: z.string().date(),
    expected: a3GoldenExpectedSchema,
    scoredFields: z.array(a3ScoredFieldSchema).min(1),
    tags: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export type A3ScoredField = z.infer<typeof a3ScoredFieldSchema>;
export type A3GoldenCase = z.infer<typeof a3GoldenCaseSchema>;

const documentTypes = ["PROJECT_REPORT", "EXECUTIVE_CONCLUSION", "OFFICIAL_LETTER"] as const;
const scoredFields = a3ScoredFieldSchema.options;

export const A3_GOLDEN_CASES: A3GoldenCase[] = [
  a3GoldenCaseSchema.parse({
    id: "a3-atlas-document-bundle",
    suite: A3_GOLDEN_SUITE,
    locale: "mn",
    inputText: "ATLAS төслийн тайлан, удирдлагын дүгнэлт, албан бичгийн батлуулах ноорог бэлтгэ.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      asOf: "2026-03-01T00:00:00.000Z",
      documentTypes,
      workItemCount: 9,
      issueCount: 5,
      projectDurationDays: 125,
      riskPosture: "CRITICAL",
      precision: 1,
      recall: 1,
      forecastErrorDays: 3,
      draftStatus: "PENDING_APPROVAL",
      numericNarrativeSafe: true,
    },
    scoredFields,
    tags: ["report", "conclusion", "official-letter", "risk"],
  }),
  a3GoldenCaseSchema.parse({
    id: "a3-river-no-risk-bundle",
    suite: A3_GOLDEN_SUITE,
    locale: "mn",
    inputText: "RIVER төслийн асуудалгүй төлөвийн тайлан болон батлуулах баримтуудыг бэлтгэ.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectId: "project-river",
      asOf: "2026-03-01T00:00:00.000Z",
      documentTypes,
      workItemCount: 2,
      issueCount: 0,
      projectDurationDays: 42,
      riskPosture: "NONE",
      precision: 1,
      recall: 1,
      forecastErrorDays: null,
      draftStatus: "PENDING_APPROVAL",
      numericNarrativeSafe: true,
    },
    scoredFields,
    tags: ["no-risk", "empty-recommendations", "approval"],
  }),
  a3GoldenCaseSchema.parse({
    id: "a3-private-tenant-bundle",
    suite: A3_GOLDEN_SUITE,
    locale: "mn",
    inputText:
      "Тусгаарлагдсан tenant-ийн PRIVATE төслийн баримтуудыг зөвхөн өөрийн хүрээнд бэлтгэ.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-isolation",
      projectId: "project-private",
      asOf: "2026-03-01T00:00:00.000Z",
      documentTypes,
      workItemCount: 1,
      issueCount: 0,
      projectDurationDays: 26,
      riskPosture: "NONE",
      precision: 1,
      recall: 1,
      forecastErrorDays: null,
      draftStatus: "PENDING_APPROVAL",
      numericNarrativeSafe: true,
    },
    scoredFields,
    tags: ["tenant-isolation", "official-letter", "approval"],
  }),
];

export function parseA3GoldenCases(cases: readonly unknown[] = A3_GOLDEN_CASES) {
  return cases.map((goldenCase) => a3GoldenCaseSchema.parse(goldenCase));
}
