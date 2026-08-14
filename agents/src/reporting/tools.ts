import { A3DocumentDraftStatus, PrismaClient } from "@prisma/client";
import { tool } from "ai";
import { z } from "zod";
import { analyzeProjectData, projectAnalysisResultSchema } from "../analysis/analyze.js";
import { loadProjectAnalysisData } from "../analysis/analyze.js";
import { projectAnalysisDataSchema } from "../analysis/schema.js";
import { prisma } from "../prisma.js";
import { resolveProjectScope, toolContextSchema, type ToolContext } from "../tools/context.js";

export const collectA3ReportEvidenceInputSchema = z
  .object({
    projectRef: z.string().trim().min(1),
    asOf: z.string().datetime(),
  })
  .strict();

export const a3ReportEvidenceSchema = z
  .object({
    data: projectAnalysisDataSchema,
    analysis: projectAnalysisResultSchema,
  })
  .strict();

export const inspectA3ApprovalDraftsInputSchema = z
  .object({
    projectIds: z.array(z.string().trim().min(1)).min(1).optional(),
    statuses: z.array(z.nativeEnum(A3DocumentDraftStatus)).min(1).optional(),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

const a3ApprovalDraftSummarySchema = z
  .object({
    id: z.string(),
    requestId: z.string(),
    projectId: z.string(),
    type: z.enum(["PROJECT_REPORT", "EXECUTIVE_CONCLUSION", "OFFICIAL_LETTER"]),
    status: z.nativeEnum(A3DocumentDraftStatus),
    title: z.string(),
    sourceAsOf: z.string().datetime(),
    createdAt: z.string().datetime(),
  })
  .strict();

export const inspectA3ApprovalDraftsResultSchema = z
  .object({
    drafts: z.array(a3ApprovalDraftSummarySchema),
    total: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

export async function collectA3ReportEvidenceCore(
  context: ToolContext,
  input: z.input<typeof collectA3ReportEvidenceInputSchema>,
  client: PrismaClient = prisma,
) {
  const params = collectA3ReportEvidenceInputSchema.parse(input);
  const scope = resolveProjectScope(context, [params.projectRef]);
  const data = await loadProjectAnalysisData(
    {
      tenantId: scope.tenantId,
      projectRef: params.projectRef,
      asOf: params.asOf,
    },
    client,
  );

  return a3ReportEvidenceSchema.parse({
    data,
    analysis: analyzeProjectData(data),
  });
}

export async function inspectA3ApprovalDraftsCore(
  context: ToolContext,
  input: z.input<typeof inspectA3ApprovalDraftsInputSchema> = {},
  client: PrismaClient = prisma,
) {
  const params = inspectA3ApprovalDraftsInputSchema.parse(input);
  const scope = resolveProjectScope(context, params.projectIds);
  const where = {
    tenantId: scope.tenantId,
    projectId: { in: scope.projectIds },
    status: params.statuses ? { in: params.statuses } : undefined,
  };
  const [drafts, total] = await Promise.all([
    client.a3DocumentDraft.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: params.limit,
    }),
    client.a3DocumentDraft.count({ where }),
  ]);

  return inspectA3ApprovalDraftsResultSchema.parse({
    drafts: drafts.map((draft) => ({
      id: draft.id,
      requestId: draft.requestId,
      projectId: draft.projectId,
      type: draft.type,
      status: draft.status,
      title: draft.title,
      sourceAsOf: draft.sourceAsOf.toISOString(),
      createdAt: draft.createdAt.toISOString(),
    })),
    total,
    truncated: total > drafts.length,
  });
}

export const a3DocumentTools = {
  collectReportEvidence: tool({
    description:
      "Collect authorized deterministic project, CPM, issue, progress, and cost evidence for an A3 document.",
    inputSchema: collectA3ReportEvidenceInputSchema,
    outputSchema: a3ReportEvidenceSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => collectA3ReportEvidenceCore(context, input),
  }),
  inspectApprovalDrafts: tool({
    description: "List authorized A3 document drafts and their human-approval status.",
    inputSchema: inspectA3ApprovalDraftsInputSchema,
    outputSchema: inspectA3ApprovalDraftsResultSchema,
    contextSchema: toolContextSchema,
    execute: (input, { context }) => inspectA3ApprovalDraftsCore(context, input),
  }),
} as const;

export function createA3DocumentToolsContext(context: ToolContext) {
  const parsed = toolContextSchema.parse(context);

  return {
    collectReportEvidence: parsed,
    inspectApprovalDrafts: parsed,
  };
}
