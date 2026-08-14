export interface GraphDependency {
  id: string;
  predecessorId: string;
  successorId: string;
}

export class DependencyGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyGraphError";
  }
}

export class DependencyCycleError extends DependencyGraphError {
  readonly cycleWorkItemIds: string[];

  constructor(cycleWorkItemIds: string[]) {
    super(`Dependency cycle detected: ${cycleWorkItemIds.join(" -> ")}`);
    this.name = "DependencyCycleError";
    this.cycleWorkItemIds = cycleWorkItemIds;
  }
}

function findCycle(
  workItemIds: readonly string[],
  successorsByWorkItem: ReadonlyMap<string, readonly string[]>,
) {
  const state = new Map<string, "visiting" | "visited">();
  const stack: string[] = [];
  const stackIndex = new Map<string, number>();

  function visit(workItemId: string): string[] | null {
    state.set(workItemId, "visiting");
    stackIndex.set(workItemId, stack.length);
    stack.push(workItemId);

    for (const successorId of successorsByWorkItem.get(workItemId) ?? []) {
      const successorState = state.get(successorId);

      if (successorState === "visiting") {
        const cycleStart = stackIndex.get(successorId) ?? 0;
        return [...stack.slice(cycleStart), successorId];
      }

      if (successorState !== "visited") {
        const cycle = visit(successorId);

        if (cycle) {
          return cycle;
        }
      }
    }

    stack.pop();
    stackIndex.delete(workItemId);
    state.set(workItemId, "visited");
    return null;
  }

  for (const workItemId of workItemIds) {
    if (!state.has(workItemId)) {
      const cycle = visit(workItemId);

      if (cycle) {
        return cycle;
      }
    }
  }

  return [];
}

export function topologicalSortWorkItems(
  workItemIds: readonly string[],
  dependencies: readonly GraphDependency[],
) {
  const uniqueWorkItemIds = new Set(workItemIds);

  if (uniqueWorkItemIds.size !== workItemIds.length) {
    throw new DependencyGraphError("Work item IDs must be unique");
  }

  const inputOrder = new Map(workItemIds.map((workItemId, index) => [workItemId, index]));
  const inDegree = new Map(workItemIds.map((workItemId) => [workItemId, 0]));
  const successorsByWorkItem = new Map<string, string[]>(
    workItemIds.map((workItemId) => [workItemId, []]),
  );

  for (const dependency of dependencies) {
    if (
      !uniqueWorkItemIds.has(dependency.predecessorId) ||
      !uniqueWorkItemIds.has(dependency.successorId)
    ) {
      throw new DependencyGraphError(`Dependency ${dependency.id} references an unknown work item`);
    }

    successorsByWorkItem.get(dependency.predecessorId)!.push(dependency.successorId);
    inDegree.set(dependency.successorId, (inDegree.get(dependency.successorId) ?? 0) + 1);
  }

  const ready = workItemIds.filter((workItemId) => inDegree.get(workItemId) === 0);
  const sorted: string[] = [];

  while (ready.length > 0) {
    ready.sort((left, right) => (inputOrder.get(left) ?? 0) - (inputOrder.get(right) ?? 0));
    const workItemId = ready.shift()!;
    sorted.push(workItemId);

    for (const successorId of successorsByWorkItem.get(workItemId) ?? []) {
      const nextInDegree = (inDegree.get(successorId) ?? 0) - 1;
      inDegree.set(successorId, nextInDegree);

      if (nextInDegree === 0) {
        ready.push(successorId);
      }
    }
  }

  if (sorted.length !== workItemIds.length) {
    throw new DependencyCycleError(findCycle(workItemIds, successorsByWorkItem));
  }

  return sorted;
}
