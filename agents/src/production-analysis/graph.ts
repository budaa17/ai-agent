import type { ProjectAnalysisSnapshotV1 } from "../contracts/project-analysis-snapshot.js";

type SnapshotDependency = ProjectAnalysisSnapshotV1["dependencies"][number];

export class ProductionGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionGraphError";
  }
}

export function topologicalSort(
  workItemIds: readonly string[],
  dependencies: readonly SnapshotDependency[],
): string[] {
  if (new Set(workItemIds).size !== workItemIds.length) {
    throw new ProductionGraphError("Work item identifiers must be unique");
  }

  const allowed = new Set(workItemIds);
  const incomingCount = new Map(workItemIds.map((workItemId) => [workItemId, 0]));
  const successors = new Map(workItemIds.map((workItemId) => [workItemId, [] as string[]]));

  for (const dependency of dependencies) {
    if (
      !allowed.has(dependency.predecessorWorkItemId) ||
      !allowed.has(dependency.successorWorkItemId)
    ) {
      throw new ProductionGraphError(
        `Dependency ${dependency.dependencyId} is outside the executable work-item graph`,
      );
    }

    incomingCount.set(
      dependency.successorWorkItemId,
      incomingCount.get(dependency.successorWorkItemId)! + 1,
    );
    successors.get(dependency.predecessorWorkItemId)!.push(dependency.successorWorkItemId);
  }

  const ready = workItemIds.filter((workItemId) => incomingCount.get(workItemId) === 0).sort();
  const ordered: string[] = [];

  while (ready.length > 0) {
    const current = ready.shift()!;
    ordered.push(current);

    for (const successor of successors.get(current)!.sort()) {
      const remaining = incomingCount.get(successor)! - 1;
      incomingCount.set(successor, remaining);

      if (remaining === 0) {
        ready.push(successor);
        ready.sort();
      }
    }
  }

  if (ordered.length !== workItemIds.length) {
    const cycleMembers = workItemIds.filter((workItemId) => !ordered.includes(workItemId)).sort();
    throw new ProductionGraphError(`Dependency graph contains a cycle: ${cycleMembers.join(", ")}`);
  }

  return ordered;
}
