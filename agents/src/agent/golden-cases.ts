import { z } from "zod";
import { a4SourceFactSchema } from "./grounding.js";
import { a4AnswerStatusSchema, a4ToolNameSchema } from "./schema.js";

export const A4_GOLDEN_SUITE = "a4-reference-assistant-v1";

export const a4ScoredFieldSchema = z.enum([
  "language",
  "answerStatus",
  "requiredToolCoverage",
  "requiredSourceCoverage",
  "forbiddenSourcesExcluded",
  "groundingValid",
]);

export const a4RequiredSourceSchema = a4SourceFactSchema.omit({ sourceType: true });

export const a4GoldenExpectedSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectIds: z.array(z.string().trim().min(1)).min(1).max(10),
    answerStatus: a4AnswerStatusSchema,
    requiredToolNames: z.array(a4ToolNameSchema).min(1),
    requiredSources: z.array(a4RequiredSourceSchema).min(1).max(20),
    forbiddenSourceIds: z.array(z.string().trim().min(1)).max(100),
    groundingValid: z.literal(true),
  })
  .strict()
  .superRefine((expected, context) => {
    for (const [field, values] of [
      ["projectIds", expected.projectIds],
      ["requiredToolNames", expected.requiredToolNames],
      ["forbiddenSourceIds", expected.forbiddenSourceIds],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: "custom",
          message: `${field} must be unique`,
          path: [field],
        });
      }
    }

    const sourceKeys = expected.requiredSources.map((source) =>
      [source.toolName, source.sourceId, source.field].join("\u0000"),
    );

    if (new Set(sourceKeys).size !== sourceKeys.length) {
      context.addIssue({
        code: "custom",
        message: "requiredSources must be unique",
        path: ["requiredSources"],
      });
    }

    const tools = new Set(expected.requiredToolNames);

    expected.requiredSources.forEach((source, sourceIndex) => {
      if (!tools.has(source.toolName)) {
        context.addIssue({
          code: "custom",
          message: "Every required source must use a required tool",
          path: ["requiredSources", sourceIndex, "toolName"],
        });
      }
    });
  });

export const a4GoldenCaseSchema = z
  .object({
    id: z.string().regex(/^a4-[a-z0-9-]+$/),
    suite: z.literal(A4_GOLDEN_SUITE),
    locale: z.literal("mn"),
    inputText: z.string().trim().min(10),
    referenceDate: z.string().date(),
    expected: a4GoldenExpectedSchema,
    scoredFields: z.array(a4ScoredFieldSchema).min(1),
    tags: z.array(z.string().trim().min(1)).min(1),
  })
  .strict();

export type A4ScoredField = z.infer<typeof a4ScoredFieldSchema>;
export type A4RequiredSource = z.infer<typeof a4RequiredSourceSchema>;
export type A4GoldenExpected = z.infer<typeof a4GoldenExpectedSchema>;
export type A4GoldenCase = z.infer<typeof a4GoldenCaseSchema>;

const scoredFields = a4ScoredFieldSchema.options;
const atlasForbidden = ["wi-private-analysis"];
const privateForbidden = [
  "wi-atlas-discovery",
  "wi-atlas-design",
  "wi-atlas-license",
  "wi-atlas-procurement",
  "wi-atlas-integration",
  "wi-atlas-migration",
  "wi-atlas-training",
  "wi-atlas-pilot",
  "wi-atlas-rollout",
];

export const A4_GOLDEN_CASES: A4GoldenCase[] = [
  a4GoldenCaseSchema.parse({
    id: "a4-atlas-work-item-count",
    suite: A4_GOLDEN_SUITE,
    locale: "mn",
    inputText: "ATLAS төсөл нийт хэдэн ажилтай вэ?",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
      answerStatus: "ANSWERED",
      requiredToolNames: ["lookupWorkItems"],
      requiredSources: [
        {
          toolName: "lookupWorkItems",
          sourceId: "lookupWorkItems:aggregate",
          field: "total",
          value: 9,
        },
      ],
      forbiddenSourceIds: atlasForbidden,
      groundingValid: true,
    },
    scoredFields,
    tags: ["aggregate", "work-items", "authorization"],
  }),
  a4GoldenCaseSchema.parse({
    id: "a4-atlas-procurement-status",
    suite: A4_GOLDEN_SUITE,
    locale: "mn",
    inputText: "AT-004 ажлын төлөв, явц, төлөвлөсөн дуусах огноог хэл.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
      answerStatus: "ANSWERED",
      requiredToolNames: ["lookupWorkItems"],
      requiredSources: [
        {
          toolName: "lookupWorkItems",
          sourceId: "wi-atlas-procurement",
          field: "status",
          value: "IN_PROGRESS",
        },
        {
          toolName: "lookupWorkItems",
          sourceId: "wi-atlas-procurement",
          field: "progressPercent",
          value: 75,
        },
        {
          toolName: "lookupWorkItems",
          sourceId: "wi-atlas-procurement",
          field: "plannedEnd",
          value: "2026-02-20T00:00:00.000Z",
        },
      ],
      forbiddenSourceIds: atlasForbidden,
      groundingValid: true,
    },
    scoredFields,
    tags: ["status", "progress", "date"],
  }),
  a4GoldenCaseSchema.parse({
    id: "a4-atlas-migration-dependency",
    suite: A4_GOLDEN_SUITE,
    locale: "mn",
    inputText: "AT-006 ажил AT-005-аас ямар хамааралтай, өмнөх ажил ямар төлөвтэй вэ?",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
      answerStatus: "ANSWERED",
      requiredToolNames: ["lookupDependencies"],
      requiredSources: [
        {
          toolName: "lookupDependencies",
          sourceId: "dep-atlas-006",
          field: "type",
          value: "FINISH_TO_START",
        },
        {
          toolName: "lookupDependencies",
          sourceId: "dep-atlas-006",
          field: "predecessor.code",
          value: "AT-005",
        },
        {
          toolName: "lookupDependencies",
          sourceId: "dep-atlas-006",
          field: "predecessor.status",
          value: "IN_PROGRESS",
        },
        {
          toolName: "lookupDependencies",
          sourceId: "dep-atlas-006",
          field: "successor.code",
          value: "AT-006",
        },
      ],
      forbiddenSourceIds: atlasForbidden,
      groundingValid: true,
    },
    scoredFields,
    tags: ["dependency", "status", "critical-path"],
  }),
  a4GoldenCaseSchema.parse({
    id: "a4-atlas-integration-stall",
    suite: A4_GOLDEN_SUITE,
    locale: "mn",
    inputText: "AT-005 ажлын сүүлийн явц хэд вэ, өмнөх бүртгэлээс хойш хэд хоног өнгөрсөн бэ?",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
      answerStatus: "ANSWERED",
      requiredToolNames: ["lookupProgressHistory"],
      requiredSources: [
        {
          toolName: "lookupProgressHistory",
          sourceId: "snapshot-integration-03",
          field: "progressPercent",
          value: 45,
        },
        {
          toolName: "lookupProgressHistory",
          sourceId: "snapshot-integration-03",
          field: "daysSincePrevious",
          value: 9,
        },
      ],
      forbiddenSourceIds: atlasForbidden,
      groundingValid: true,
    },
    scoredFields,
    tags: ["progress-history", "stall", "duration"],
  }),
  a4GoldenCaseSchema.parse({
    id: "a4-atlas-license-overrun",
    suite: A4_GOLDEN_SUITE,
    locale: "mn",
    inputText: "AT-003 лицензийн ажлын төсөв, бодит зардал, төсвийн зөрүүг хэл.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-demo",
      projectIds: ["project-atlas"],
      answerStatus: "ANSWERED",
      requiredToolNames: ["lookupCostLedger"],
      requiredSources: [
        {
          toolName: "lookupCostLedger",
          sourceId: "wi-atlas-license",
          field: "budget",
          value: "20000000.00",
        },
        {
          toolName: "lookupCostLedger",
          sourceId: "wi-atlas-license",
          field: "recordedActualCost",
          value: "27000000.00",
        },
        {
          toolName: "lookupCostLedger",
          sourceId: "wi-atlas-license",
          field: "budgetVariance",
          value: "7000000.00",
        },
      ],
      forbiddenSourceIds: atlasForbidden,
      groundingValid: true,
    },
    scoredFields,
    tags: ["cost", "budget", "decimal"],
  }),
  a4GoldenCaseSchema.parse({
    id: "a4-private-tenant-isolation",
    suite: A4_GOLDEN_SUITE,
    locale: "mn",
    inputText: "PRIVATE төслийн PR-001 ажлын төлөв, явцыг зөвхөн өөрийн tenant-ээс хэл.",
    referenceDate: "2026-03-01",
    expected: {
      tenantId: "tenant-isolation",
      projectIds: ["project-private"],
      answerStatus: "ANSWERED",
      requiredToolNames: ["lookupWorkItems"],
      requiredSources: [
        {
          toolName: "lookupWorkItems",
          sourceId: "wi-private-analysis",
          field: "status",
          value: "COMPLETED",
        },
        {
          toolName: "lookupWorkItems",
          sourceId: "wi-private-analysis",
          field: "progressPercent",
          value: 100,
        },
      ],
      forbiddenSourceIds: privateForbidden,
      groundingValid: true,
    },
    scoredFields,
    tags: ["tenant-isolation", "authorization", "work-items"],
  }),
];

export function parseA4GoldenCases(cases: readonly unknown[] = A4_GOLDEN_CASES) {
  return cases.map((goldenCase) => a4GoldenCaseSchema.parse(goldenCase));
}
