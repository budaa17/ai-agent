import type { Workspace } from "../api/schemas";
import { entityNumber, entityString } from "./format";
import { targetTypeLabel } from "./review-target";

type Row = Record<string, unknown>;

const versionedTypes = new Set([
  "REGISTRATION_DRAFT",
  "QUANTITY_TAKEOFF",
  "ESTIMATE",
  "SCHEDULE",
  "BASELINE",
]);
const stageOrder: Readonly<Record<string, number>> = {
  QUANTITY_TAKEOFF: 0,
  ESTIMATE: 1,
  SCHEDULE: 2,
  BASELINE: 3,
};
const acceptedDependencyStatuses = new Set(["APPROVED", "APPLIED"]);

export type ReviewDependency = {
  readonly id: string;
  readonly targetType: string;
  readonly label: string;
  readonly status: string;
  readonly ready: boolean;
};

export type ReviewReadiness = {
  readonly ready: boolean;
  readonly dependencies: readonly ReviewDependency[];
  readonly unmet: readonly ReviewDependency[];
};

function versionRows(workspace: Workspace, targetType: string): readonly Row[] {
  if (targetType === "QUANTITY_TAKEOFF") return workspace.commercial.quantityVersions;
  if (targetType === "ESTIMATE") return workspace.commercial.estimateVersions;
  if (targetType === "SCHEDULE") return workspace.schedule.versions;
  if (targetType === "BASELINE") return workspace.commercial.baselines;
  return [];
}

function dependency(workspace: Workspace, targetType: string, id: string): ReviewDependency {
  const version = versionRows(workspace, targetType).find(
    (candidate) => entityString(candidate, "id") === id,
  );
  const status = version === undefined ? "NOT_FOUND" : entityString(version, "status");
  return {
    id,
    targetType,
    label: targetTypeLabel(targetType),
    status,
    ready: acceptedDependencyStatuses.has(status),
  };
}

export function reviewReadiness(workspace: Workspace, task: Row): ReviewReadiness {
  const targetType = entityString(task, "targetType");
  const targetId = entityString(task, "targetId");
  const target = versionRows(workspace, targetType).find(
    (candidate) => entityString(candidate, "id") === targetId,
  );
  let dependencies: ReviewDependency[] = [];

  if (targetType === "ESTIMATE" && target !== undefined) {
    dependencies = [
      dependency(workspace, "QUANTITY_TAKEOFF", entityString(target, "quantityVersionId")),
    ];
  } else if (targetType === "BASELINE" && target !== undefined) {
    dependencies = [
      dependency(workspace, "QUANTITY_TAKEOFF", entityString(target, "quantityVersionId")),
      dependency(workspace, "ESTIMATE", entityString(target, "estimateVersionId")),
      dependency(workspace, "SCHEDULE", entityString(target, "scheduleVersionId")),
    ];
  }

  const unmet = dependencies.filter((item) => !item.ready);
  return { ready: unmet.length === 0, dependencies, unmet };
}

export function latestActionableReviews(reviews: readonly Row[]): readonly Row[] {
  const latestVersion = new Map<string, number>();
  for (const task of reviews) {
    const targetType = entityString(task, "targetType");
    if (!versionedTypes.has(targetType)) continue;
    latestVersion.set(
      targetType,
      Math.max(latestVersion.get(targetType) ?? 0, entityNumber(task, "targetVersion") ?? 0),
    );
  }

  return reviews
    .filter((task) => {
      const targetType = entityString(task, "targetType");
      return (
        !versionedTypes.has(targetType) ||
        (entityNumber(task, "targetVersion") ?? 0) === latestVersion.get(targetType)
      );
    })
    .slice()
    .sort((left, right) => {
      const versionDifference =
        (entityNumber(right, "targetVersion") ?? 0) - (entityNumber(left, "targetVersion") ?? 0);
      if (versionDifference !== 0) return versionDifference;
      return (
        (stageOrder[entityString(left, "targetType")] ?? 99) -
        (stageOrder[entityString(right, "targetType")] ?? 99)
      );
    });
}
