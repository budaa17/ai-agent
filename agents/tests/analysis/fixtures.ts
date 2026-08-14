import { buildSeedData, SEED_AS_OF } from "../../prisma/seed-data.js";
import { projectAnalysisDataSchema, type ProjectAnalysisData } from "../../src/analysis/schema.js";

export function buildProjectAnalysisFixture(
  projectId: string,
  asOf = SEED_AS_OF.toISOString(),
): ProjectAnalysisData {
  const seed = buildSeedData();
  const project = seed.projects.find((candidate) => candidate.id === projectId);

  if (!project) {
    throw new Error(`Unknown seed project: ${projectId}`);
  }

  const cutoff = new Date(asOf).getTime();
  const workItems = seed.workItems
    .filter((workItem) => workItem.projectId === project.id)
    .sort(
      (left, right) =>
        left.plannedStart.getTime() - right.plannedStart.getTime() ||
        left.code.localeCompare(right.code),
    )
    .map((workItem) => ({
      id: workItem.id,
      tenantId: workItem.tenantId,
      projectId: workItem.projectId,
      code: workItem.code,
      name: workItem.name,
      status: workItem.status,
      priority: workItem.priority,
      plannedStart: workItem.plannedStart.toISOString(),
      plannedEnd: workItem.plannedEnd.toISOString(),
      actualStart: workItem.actualStart?.toISOString() ?? null,
      actualEnd: workItem.actualEnd?.toISOString() ?? null,
      progressPercent: workItem.progressPercent,
      budget: workItem.budget,
      actualCost: workItem.actualCost,
      isCritical: workItem.isCritical,
      snapshots: seed.snapshots
        .filter(
          (snapshot) =>
            snapshot.workItemId === workItem.id && snapshot.capturedAt.getTime() <= cutoff,
        )
        .sort(
          (left, right) =>
            left.capturedAt.getTime() - right.capturedAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map((snapshot) => ({
          id: snapshot.id,
          capturedAt: snapshot.capturedAt.toISOString(),
          status: snapshot.status,
          progressPercent: snapshot.progressPercent,
          actualCost: snapshot.actualCost,
        })),
      costEntries: seed.costEntries
        .filter((entry) => entry.workItemId === workItem.id && entry.occurredAt.getTime() <= cutoff)
        .sort(
          (left, right) =>
            left.occurredAt.getTime() - right.occurredAt.getTime() ||
            left.id.localeCompare(right.id),
        )
        .map((entry) => ({
          id: entry.id,
          occurredAt: entry.occurredAt.toISOString(),
          amount: entry.amount,
        })),
    }));

  return projectAnalysisDataSchema.parse({
    tenantId: project.tenantId,
    projectId: project.id,
    projectCode: project.code,
    projectName: project.name,
    projectPlannedStart: project.plannedStart.toISOString(),
    projectPlannedEnd: project.plannedEnd.toISOString(),
    asOf,
    workItems,
    dependencies: seed.dependencies
      .filter((dependency) => dependency.projectId === project.id)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((dependency) => ({
        id: dependency.id,
        predecessorId: dependency.predecessorId,
        successorId: dependency.successorId,
        type: dependency.type,
        lagDays: dependency.lagDays,
      })),
  });
}
