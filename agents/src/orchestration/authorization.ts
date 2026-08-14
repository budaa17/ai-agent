import type { SignedArtifactReadReferenceV1 } from "../artifacts/contracts.js";
import {
  phase8AuthorizationContextSchema,
  type Phase8AuthorizationContext,
  type Phase8ToolName,
  type Phase8ToolRecord,
} from "./contracts.js";

export class Phase8ToolAccessError extends Error {
  constructor() {
    super("Resource is not available in the authorized scope");
    this.name = "Phase8ToolAccessError";
  }
}

export type Phase8SignedArtifactVerifier = (reference: SignedArtifactReadReferenceV1) => boolean;

type ToolPolicy = Readonly<{
  permissions: readonly Phase8AuthorizationContext["permissions"][number][];
  roles: readonly Phase8AuthorizationContext["roles"][number][];
}>;

const a0DesignTools = new Set<Phase8ToolName>([
  "getDesignDocuments",
  "getDrawingRevisions",
  "getDrawingPages",
  "getVerifiedScale",
  "getExtractedElements",
]);
const a0CatalogTools = new Set<Phase8ToolName>([
  "getMaterialNorms",
  "getMaterialPrices",
  "getProductivityRates",
  "getScheduleDependencies",
  "getEstimateAssumptions",
]);
const a5Tools = new Set<Phase8ToolName>([
  "getCurrentSchedule",
  "getEligibleWorkItems",
  "getRemainingQuantities",
  "getCrewAvailability",
  "getEquipmentAvailability",
  "getMaterialAvailability",
  "getWeatherConstraints",
  "getOpenBlockers",
  "getDailyPlan",
  "getDailyActuals",
  "getPhotoEvidence",
  "getProgressVerification",
  "getRollingProductivity",
  "getLatestForecast",
  "getRecoveryScenarios",
]);

function policyFor(toolName: Phase8ToolName): ToolPolicy {
  if (a0DesignTools.has(toolName)) {
    return {
      permissions: ["AGENT_READ", "A0_READ", "DESIGN_DOCUMENT_READ"],
      roles: ["ENGINEER", "PROJECT_MANAGER", "SYSTEM_ADMIN"],
    };
  }
  if (toolName === "getQuantityTakeoff") {
    return {
      permissions: ["AGENT_READ", "A0_READ"],
      roles: ["ENGINEER", "ESTIMATOR", "PROJECT_MANAGER", "SYSTEM_ADMIN"],
    };
  }
  if (a0CatalogTools.has(toolName)) {
    const permissions: ToolPolicy["permissions"] = [
      "AGENT_READ",
      "A0_READ",
      "CATALOG_READ",
      ...(toolName === "getMaterialPrices" || toolName === "getEstimateAssumptions"
        ? (["COST_READ"] as const)
        : []),
    ];
    return {
      permissions,
      roles: ["ESTIMATOR", "PROJECT_MANAGER", "SYSTEM_ADMIN"],
    };
  }
  if (a5Tools.has(toolName)) {
    return {
      permissions: [
        "AGENT_READ",
        "A5_READ",
        ...(toolName === "getDailyActuals" ? (["REPORT_TEXT_READ"] as const) : []),
        ...(toolName === "getPhotoEvidence" ? (["ARTIFACT_SIGNED_READ"] as const) : []),
      ],
      roles: ["SITE_ENGINEER", "PROJECT_MANAGER", "SYSTEM_ADMIN"],
    };
  }
  throw new Phase8ToolAccessError();
}

export function authorizePhase8Tool(
  inputContext: Phase8AuthorizationContext,
  projectId: string,
  toolName: Phase8ToolName,
): Phase8AuthorizationContext {
  const context = phase8AuthorizationContextSchema.parse(inputContext);
  const policy = policyFor(toolName);
  if (
    !context.allowedProjectIds.includes(projectId) ||
    !policy.permissions.every((permission) => context.permissions.includes(permission)) ||
    !policy.roles.some((role) => context.roles.includes(role))
  ) {
    throw new Phase8ToolAccessError();
  }
  return context;
}

export function authorizePhase8AgentRun(
  inputContext: Phase8AuthorizationContext,
  projectId: string,
  agent: "A0" | "A5",
): Phase8AuthorizationContext {
  const context = phase8AuthorizationContextSchema.parse(inputContext);
  const permission = agent === "A0" ? "A0_RUN" : "A5_RUN";
  const roles =
    agent === "A0"
      ? ["ENGINEER", "ESTIMATOR", "PROJECT_MANAGER", "SYSTEM_ADMIN"]
      : ["SITE_ENGINEER", "PROJECT_MANAGER", "SYSTEM_ADMIN"];
  if (
    !context.allowedProjectIds.includes(projectId) ||
    !context.permissions.includes(permission) ||
    !context.roles.some((role) => roles.includes(role))
  ) {
    throw new Phase8ToolAccessError();
  }
  return context;
}

function signedArtifactGrant(
  context: Phase8AuthorizationContext,
  artifactId: string,
  projectId: string,
  verifier: Phase8SignedArtifactVerifier,
): boolean {
  return context.signedArtifactReads.some(
    (reference) =>
      reference.artifactId === artifactId &&
      reference.tenantId === context.tenantId &&
      reference.projectId === projectId &&
      Date.parse(reference.expiresAt) > Date.parse(context.requestedAt) &&
      verifier(reference),
  );
}

export function phase8RecordIsAuthorized(
  record: Phase8ToolRecord,
  context: Phase8AuthorizationContext,
  projectId: string,
  verifier: Phase8SignedArtifactVerifier,
): boolean {
  if (
    record.tenantId !== context.tenantId ||
    record.projectId !== projectId ||
    record.sourceRefs.some(
      (source) => source.tenantId !== context.tenantId || source.projectId !== projectId,
    )
  ) {
    return false;
  }
  if (
    record.catalogVersionIds.some(
      (versionId) => !context.allowedCatalogVersionIds.includes(versionId),
    )
  ) {
    return false;
  }
  return record.artifactIds.every((artifactId) =>
    signedArtifactGrant(context, artifactId, projectId, verifier),
  );
}
