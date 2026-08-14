import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { calculateCriticalPath, cpmResultSchema } from "./cpm.js";
import { evaluateDeterministicRules } from "./rules.js";
import {
  detectedIssueSchema,
  projectAnalysisDataSchema,
  ruleEvaluationSchema,
  type ProjectAnalysisData,
} from "./schema.js";

const analysisDateSchema = z.string().datetime();

const issueCountsByTypeSchema = z
  .object({
    OVERDUE_WORK_ITEM: z.number().int().nonnegative(),
    STALLED_PROGRESS: z.number().int().nonnegative(),
    DEPENDENCY_VIOLATION: z.number().int().nonnegative(),
    BUDGET_OVERRUN: z.number().int().nonnegative(),
    LEDGER_MISMATCH: z.number().int().nonnegative(),
  })
  .strict();

const issueCountsBySeveritySchema = z
  .object({
    LOW: z.number().int().nonnegative(),
    MEDIUM: z.number().int().nonnegative(),
    HIGH: z.number().int().nonnegative(),
    CRITICAL: z.number().int().nonnegative(),
  })
  .strict();

export const projectAnalysisResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    tenantId: z.string().min(1),
    projectId: z.string().min(1),
    projectCode: z.string().min(1),
    projectName: z.string().min(1),
    asOf: analysisDateSchema,
    cpm: cpmResultSchema,
    ruleEvaluations: z.array(ruleEvaluationSchema),
    issues: z.array(detectedIssueSchema),
    summary: z
      .object({
        workItemCount: z.number().int().positive(),
        dependencyCount: z.number().int().nonnegative(),
        projectDurationDays: z.number().int().positive(),
        criticalWorkItemCount: z.number().int().positive(),
        criticalPathCount: z.number().int().positive(),
        issueCount: z.number().int().nonnegative(),
        issuesByType: issueCountsByTypeSchema,
        issuesBySeverity: issueCountsBySeveritySchema,
      })
      .strict(),
  })
  .strict();

export const loadProjectAnalysisInputSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    projectRef: z.string().trim().min(1),
    asOf: analysisDateSchema,
  })
  .strict();

export const analyzeProjectDatabaseInputSchema = loadProjectAnalysisInputSchema.extend({
  stalledThresholdDays: z.number().int().positive().optional(),
});

export type ProjectAnalysisResult = z.infer<typeof projectAnalysisResultSchema>;
export type LoadProjectAnalysisInput = z.input<typeof loadProjectAnalysisInputSchema>;
export type AnalyzeProjectDatabaseInput = z.input<typeof analyzeProjectDatabaseInputSchema>;

export class AnalysisProjectNotFoundError extends Error {
  constructor() {
    super("Project was not found inside the authorized tenant scope");
    this.name = "AnalysisProjectNotFoundError";
  }
}

function createIssueCountsByType() {
  return {
    OVERDUE_WORK_ITEM: 0,
    STALLED_PROGRESS: 0,
    DEPENDENCY_VIOLATION: 0,
    BUDGET_OVERRUN: 0,
    LEDGER_MISMATCH: 0,
  };
}

function createIssueCountsBySeverity() {
  return {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };
}

export function analyzeProjectData(
  input: ProjectAnalysisData,
  options: { stalledThresholdDays?: number } = {},
): ProjectAnalysisResult {
  const data = projectAnalysisDataSchema.parse(input);
  const cpm = calculateCriticalPath({
    projectStart: data.projectPlannedStart,
    workItems: data.workItems.map((workItem) => ({
      id: workItem.id,
      code: workItem.code,
      name: workItem.name,
      plannedStart: workItem.plannedStart,
      plannedEnd: workItem.plannedEnd,
    })),
    dependencies: data.dependencies,
  });
  const ruleResult = evaluateDeterministicRules(data, options);
  const issuesByType = createIssueCountsByType();
  const issuesBySeverity = createIssueCountsBySeverity();

  for (const issue of ruleResult.issues) {
    issuesByType[issue.type] += 1;
    issuesBySeverity[issue.severity] += 1;
  }

  return projectAnalysisResultSchema.parse({
    schemaVersion: 1,
    tenantId: data.tenantId,
    projectId: data.projectId,
    projectCode: data.projectCode,
    projectName: data.projectName,
    asOf: data.asOf,
    cpm,
    ruleEvaluations: ruleResult.evaluations,
    issues: ruleResult.issues,
    summary: {
      workItemCount: data.workItems.length,
      dependencyCount: data.dependencies.length,
      projectDurationDays: cpm.projectDurationDays,
      criticalWorkItemCount: cpm.criticalWorkItemIds.length,
      criticalPathCount: cpm.criticalPaths.length,
      issueCount: ruleResult.issues.length,
      issuesByType,
      issuesBySeverity,
    },
  });
}

export async function loadProjectAnalysisData(
  input: LoadProjectAnalysisInput,
  client: PrismaClient = prisma,
): Promise<ProjectAnalysisData> {
  const params = loadProjectAnalysisInputSchema.parse(input);
  const asOf = new Date(params.asOf);
  const project = await client.project.findFirst({
    where: {
      tenantId: params.tenantId,
      OR: [{ id: params.projectRef }, { code: params.projectRef }],
    },
    select: {
      id: true,
      tenantId: true,
      code: true,
      name: true,
      plannedStart: true,
      plannedEnd: true,
      workItems: {
        orderBy: [{ plannedStart: "asc" }, { code: "asc" }],
        select: {
          id: true,
          tenantId: true,
          projectId: true,
          code: true,
          name: true,
          status: true,
          priority: true,
          plannedStart: true,
          plannedEnd: true,
          actualStart: true,
          actualEnd: true,
          progressPercent: true,
          budget: true,
          actualCost: true,
          isCritical: true,
          snapshots: {
            where: { capturedAt: { lte: asOf } },
            orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              capturedAt: true,
              status: true,
              progressPercent: true,
              actualCost: true,
            },
          },
          costEntries: {
            where: { occurredAt: { lte: asOf } },
            orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              occurredAt: true,
              amount: true,
            },
          },
        },
      },
      dependencies: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          predecessorId: true,
          successorId: true,
          type: true,
          lagDays: true,
        },
      },
    },
  });

  if (!project) {
    throw new AnalysisProjectNotFoundError();
  }

  return projectAnalysisDataSchema.parse({
    tenantId: project.tenantId,
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    projectPlannedStart: project.plannedStart.toISOString(),
    projectPlannedEnd: project.plannedEnd.toISOString(),
    asOf: params.asOf,
    workItems: project.workItems.map((workItem) => ({
      ...workItem,
      plannedStart: workItem.plannedStart.toISOString(),
      plannedEnd: workItem.plannedEnd.toISOString(),
      actualStart: workItem.actualStart?.toISOString() ?? null,
      actualEnd: workItem.actualEnd?.toISOString() ?? null,
      budget: workItem.budget.toFixed(2),
      actualCost: workItem.actualCost.toFixed(2),
      snapshots: workItem.snapshots.map((snapshot) => ({
        ...snapshot,
        capturedAt: snapshot.capturedAt.toISOString(),
        actualCost: snapshot.actualCost.toFixed(2),
      })),
      costEntries: workItem.costEntries.map((entry) => ({
        ...entry,
        occurredAt: entry.occurredAt.toISOString(),
        amount: entry.amount.toFixed(2),
      })),
    })),
    dependencies: project.dependencies,
  });
}

export async function analyzeProjectFromDatabase(
  input: AnalyzeProjectDatabaseInput,
  client: PrismaClient = prisma,
): Promise<ProjectAnalysisResult> {
  const params = analyzeProjectDatabaseInputSchema.parse(input);
  const data = await loadProjectAnalysisData(
    {
      tenantId: params.tenantId,
      projectRef: params.projectRef,
      asOf: params.asOf,
    },
    client,
  );

  return analyzeProjectData(data, {
    stalledThresholdDays: params.stalledThresholdDays,
  });
}
