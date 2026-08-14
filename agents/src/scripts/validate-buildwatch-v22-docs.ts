import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const agentsRoot = path.resolve(scriptDirectory, "../..");
const workspaceRoot = path.resolve(agentsRoot, "..");

const catalogPath = path.join(agentsRoot, "docs", "buildwatch-v2.2-requirement-catalog.md");
const architectureFreezePath = path.join(
  agentsRoot,
  "docs",
  "phase-0-buildwatch-v2.2-architecture-freeze.md",
);
const phase1ContractsPath = path.join(agentsRoot, "docs", "phase-1-buildwatch-v2.2-contracts.md");
const phase2SimulationPath = path.join(agentsRoot, "docs", "phase-2-buildwatch-v2.2-simulation.md");
const phase3PlanningPath = path.join(
  agentsRoot,
  "docs",
  "phase-3-buildwatch-v2.2-daily-planning.md",
);
const phase41A1IntegrationPath = path.join(
  agentsRoot,
  "docs",
  "phase-4.1-buildwatch-v2.2-a1-integration.md",
);
const phase42PhotoEvidencePath = path.join(
  agentsRoot,
  "docs",
  "phase-4.2-buildwatch-v2.2-photo-evidence.md",
);
const phase4ProgressVerificationPath = path.join(
  agentsRoot,
  "docs",
  "phase-4-buildwatch-v2.2-progress-verification.md",
);
const phase5ForecastPath = path.join(
  agentsRoot,
  "docs",
  "phase-5-buildwatch-v2.2-forecast-recovery.md",
);
const phase6DesignIntakePath = path.join(
  agentsRoot,
  "docs",
  "phase-6-buildwatch-v2.2-design-intake.md",
);
const phase7BaselineGenerationPath = path.join(
  agentsRoot,
  "docs",
  "phase-7-buildwatch-v2.2-baseline-generation.md",
);
const phase8OrchestrationPath = path.join(
  agentsRoot,
  "docs",
  "phase-8-buildwatch-v2.2-orchestration.md",
);
const phase9BackendPath = path.join(agentsRoot, "docs", "phase-9-buildwatch-v2.2-backend.md");
const phase10FrontendPath = path.join(
  agentsRoot,
  "docs",
  "phase-10-buildwatch-v2.2-frontend-pwa.md",
);
const phase11ProductionPath = path.join(
  agentsRoot,
  "docs",
  "phase-11-buildwatch-v2.2-production-release.md",
);
const roadmapPath = path.join(agentsRoot, "BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md");
const traceabilityPath = path.join(agentsRoot, "REQUIREMENT-TRACEABILITY.md");
const requirementSourcePath = path.join(workspaceRoot, "buildwatch.md");
const packageJsonPath = path.join(agentsRoot, "package.json");

const requiredAdrFiles = [
  "0009-buildwatch-v22-extension-boundary.md",
  "0010-a0-candidate-not-authoritative.md",
  "0011-a5-deterministic-orchestrator.md",
  "0012-vector-pdf-before-ifc.md",
  "0013-quantity-unit-and-rounding-policy.md",
  "0014-operational-snapshot-boundary.md",
  "0015-photo-duplicate-and-privacy-policy.md",
] as const;

const requirementIdPattern =
  /^(?:BW-CORE|A0|A5|DET-GEO|DET-PLAN|DET-VERIFY|DET-FORECAST|UI-DESIGN|UI-PLAN|BE-DESIGN|BE-PLAN|QA-V22|P|PE|G)-\d{2,3}$/;

const requiredPrefixes = [
  "BW-CORE-",
  "A0-",
  "A5-",
  "DET-GEO-",
  "DET-PLAN-",
  "DET-VERIFY-",
  "DET-FORECAST-",
  "UI-DESIGN-",
  "UI-PLAN-",
  "BE-DESIGN-",
  "BE-PLAN-",
  "QA-V22-",
  "P-",
  "PE-",
  "G-",
] as const;

const allowedPriorities = new Set(["MUST", "SHOULD", "LATER"]);

type RequirementRecord = {
  id: string;
  priority: string;
  owner: string;
  phase: string;
  source: string;
  line: number;
};

export type BuildWatchV22DocumentationValidation = {
  valid: boolean;
  requirementCount: number;
  prefixCounts: Record<string, number>;
  errors: string[];
};

async function readRequiredFile(filePath: string, errors: string[]): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    errors.push(
      `Required file cannot be read: ${path.relative(workspaceRoot, filePath)} (${error instanceof Error ? error.message : String(error)})`,
    );
    return "";
  }
}

function parseRequirementRecords(catalog: string, errors: string[]): RequirementRecord[] {
  const records: RequirementRecord[] = [];

  for (const [index, line] of catalog.split(/\r?\n/u).entries()) {
    if (!line.startsWith("|")) {
      continue;
    }

    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const id = cells[0];

    if (!id || !requirementIdPattern.test(id)) {
      continue;
    }

    const priority = cells[2] ?? "";
    const owner = cells[3] ?? "";
    const phase = cells[4] ?? "";
    const source = cells[5] ?? "";

    if (!allowedPriorities.has(priority)) {
      errors.push(`${id} has invalid priority "${priority}" at catalog line ${index + 1}`);
    }
    if (!owner) {
      errors.push(`${id} has no owner at catalog line ${index + 1}`);
    }
    if (!phase) {
      errors.push(`${id} has no target phase at catalog line ${index + 1}`);
    }
    if (!source) {
      errors.push(`${id} has no source at catalog line ${index + 1}`);
    }

    records.push({
      id,
      priority,
      owner,
      phase,
      source,
      line: index + 1,
    });
  }

  return records;
}

function validateUniqueIds(records: readonly RequirementRecord[], errors: string[]): void {
  const firstLineById = new Map<string, number>();

  for (const record of records) {
    const firstLine = firstLineById.get(record.id);
    if (firstLine !== undefined) {
      errors.push(`Duplicate requirement ID ${record.id} at lines ${firstLine} and ${record.line}`);
      continue;
    }
    firstLineById.set(record.id, record.line);
  }
}

function isMarkdownTableRow(value: string): boolean {
  return value.trimStart().startsWith("|");
}

/**
 * Collapses the padding Prettier inserts when it aligns markdown table columns
 * so that `| A | B |` and `| A   | B      |` compare equal. Required markers
 * below are written in the unpadded form; without this a pure reformat of a
 * documentation table would fail the gate even though no content changed.
 */
function normalizeMarkdownTableRow(value: string): string {
  return value.replace(/[ \t]*\|[ \t]*/gu, "|").trim();
}

function normalizeForMarkerMatch(value: string): string {
  return value
    .split("\n")
    .map((line) => (isMarkdownTableRow(line) ? normalizeMarkdownTableRow(line) : line))
    .join("\n");
}

function includesEvery(
  content: string,
  fragments: readonly string[],
  label: string,
  errors: string[],
): void {
  const normalizedContent = normalizeForMarkerMatch(content);
  for (const fragment of fragments) {
    const needle = isMarkdownTableRow(fragment) ? normalizeMarkdownTableRow(fragment) : fragment;
    if (!normalizedContent.includes(needle)) {
      errors.push(`${label} is missing required marker: ${fragment}`);
    }
  }
}

export async function validateBuildWatchV22Documentation(): Promise<BuildWatchV22DocumentationValidation> {
  const errors: string[] = [];
  const [
    catalog,
    architectureFreeze,
    phase1Contracts,
    phase2Simulation,
    phase3Planning,
    phase41A1Integration,
    phase42PhotoEvidence,
    phase4ProgressVerification,
    phase5Forecast,
    phase6DesignIntake,
    phase7BaselineGeneration,
    phase8Orchestration,
    phase9Backend,
    phase10Frontend,
    phase11Production,
    roadmap,
    traceability,
    requirementSource,
    packageJson,
  ] = await Promise.all([
    readRequiredFile(catalogPath, errors),
    readRequiredFile(architectureFreezePath, errors),
    readRequiredFile(phase1ContractsPath, errors),
    readRequiredFile(phase2SimulationPath, errors),
    readRequiredFile(phase3PlanningPath, errors),
    readRequiredFile(phase41A1IntegrationPath, errors),
    readRequiredFile(phase42PhotoEvidencePath, errors),
    readRequiredFile(phase4ProgressVerificationPath, errors),
    readRequiredFile(phase5ForecastPath, errors),
    readRequiredFile(phase6DesignIntakePath, errors),
    readRequiredFile(phase7BaselineGenerationPath, errors),
    readRequiredFile(phase8OrchestrationPath, errors),
    readRequiredFile(phase9BackendPath, errors),
    readRequiredFile(phase10FrontendPath, errors),
    readRequiredFile(phase11ProductionPath, errors),
    readRequiredFile(roadmapPath, errors),
    readRequiredFile(traceabilityPath, errors),
    readRequiredFile(requirementSourcePath, errors),
    readRequiredFile(packageJsonPath, errors),
  ]);

  const records = parseRequirementRecords(catalog, errors);
  validateUniqueIds(records, errors);

  if (records.length < 100) {
    errors.push(`Requirement catalog is unexpectedly small: ${records.length} records`);
  }

  const prefixCounts: Record<string, number> = {};
  for (const prefix of requiredPrefixes) {
    const count = records.filter((record) => record.id.startsWith(prefix)).length;
    prefixCounts[prefix] = count;
    if (count === 0) {
      errors.push(`Requirement catalog has no ID with prefix ${prefix}`);
    }
  }

  for (let section = 1; section <= 22; section += 1) {
    if (!catalog.includes(`| §${section} `)) {
      errors.push(`Source coverage table is missing buildwatch.md §${section}`);
    }
  }

  includesEvery(
    requirementSource,
    [
      "agents/docs/buildwatch-v2.2-requirement-catalog.md",
      "agents/docs/phase-0-buildwatch-v2.2-architecture-freeze.md",
      "agents/BUILDWATCH-V2.2-IMPLEMENTATION-ROADMAP.md",
    ],
    "buildwatch.md",
    errors,
  );
  includesEvery(
    architectureFreeze,
    [
      "PHASE 0 EXIT GATE: PASS",
      "ProjectAnalysisSnapshotV1",
      "OperationalPlanningSnapshotV1",
      "ROUND_HALF_UP",
      "Asia/Ulaanbaatar",
      "warningThresholdWorkingDays",
      "COLD_START_NORM",
      "3 × MAD",
    ],
    "Phase 0 architecture freeze",
    errors,
  );
  includesEvery(
    roadmap,
    [
      "# PHASE 0 — Requirement hardening ба architecture freeze",
      "**Төлөв:** `COMPLETE`",
      "# PHASE 1 — Shared contracts ба deterministic boundaries",
      "**Gate:** `pnpm.cmd run phase1:v22:gate`",
      "# PHASE 2 — Simulation болон answer-key foundation",
      "**Gate:** `pnpm.cmd run phase2:v22:gate`",
      "# PHASE 3 — A5 daily planning deterministic core",
      "**Gate:** `pnpm.cmd run phase3:v22:gate`",
      "# PHASE 4 — Evening actual ба progress verification",
      "**Phase 4.1 gate:** `pnpm.cmd run phase4.1:v22:gate`",
      "docs/phase-4.1-buildwatch-v2.2-a1-integration.md",
      "**Phase 4.2 gate:** `pnpm.cmd run phase4.2:v22:gate`",
      "docs/phase-4.2-buildwatch-v2.2-photo-evidence.md",
      "**Gate:** `pnpm.cmd run phase4:v22:gate`",
      "docs/phase-4-buildwatch-v2.2-progress-verification.md",
      "# PHASE 5 — Rolling productivity, forecast ба recovery",
      "**Gate:** `pnpm.cmd run phase5:v22:gate`",
      "docs/phase-5-buildwatch-v2.2-forecast-recovery.md",
      "# PHASE 6 — A0 narrow MVP: Excel + vector architectural PDF",
      "**Gate:** `pnpm.cmd run phase6:v22:gate`",
      "docs/phase-6-buildwatch-v2.2-design-intake.md",
      "# PHASE 7 — Quantity, material, estimate, WBS ба baseline",
      "**Gate:** `pnpm.cmd run phase7:v22:gate`",
      "docs/phase-7-buildwatch-v2.2-baseline-generation.md",
      "# PHASE 8 — A0/A5 tool layer, orchestration ба evaluation",
      "**Gate:** `pnpm.cmd run phase8:v22:gate`",
      "docs/phase-8-buildwatch-v2.2-orchestration.md",
      "# PHASE 9 — Canonical backend, database, auth ба event integration",
      "**Gate:** `pnpm.cmd run phase9:v22:gate`",
      "docs/phase-9-buildwatch-v2.2-backend.md",
      "# PHASE 10 — Production frontend ба PWA",
      "**Gate:** `pnpm.cmd run phase10:v22:gate`",
      "docs/phase-10-buildwatch-v2.2-frontend-pwa.md",
      "# PHASE 11 — Production hardening, deployment ба release",
      "**Төлөв:** `TECHNICAL_COMPLETE / RELEASE_EVIDENCE_PENDING`",
      "**Technical gate:** `pnpm.cmd run phase11:fast:v22:gate`",
      "docs/phase-11-buildwatch-v2.2-production-release.md",
      "docs/buildwatch-v2.2-requirement-catalog.md",
      "docs/phase-0-buildwatch-v2.2-architecture-freeze.md",
    ],
    "BuildWatch v2.2 roadmap",
    errors,
  );
  includesEvery(
    traceability,
    [
      "## 8. BuildWatch v2.2 extension",
      "V22-P0-01",
      "V22-P0-08",
      "| V22-P1-01 | Shared A0/A5 contracts | Contract owner | 1 | DONE |",
      "| V22-P2-01 | Operational simulation/answer key | QA owner | 2 | DONE |",
      "| V22-P3-01 | A5 deterministic daily planning | A5 owner | 3 | DONE |",
      "| V22-P4-01 | Evening verification/photo evidence | A5 owner | 4 | DONE |",
      "| V22-P5-01 | Rolling forecast/recovery | Forecast owner | 5 | DONE |",
      "| V22-P6-01 | A0 Excel/vector PDF extraction | A0 owner | 6 | DONE |",
      "| V22-P7-01 | Quantity/material/estimate/WBS/baseline | Domain owners | 7 | DONE |",
      "| V22-P8-01 | A0/A5 tools/orchestration/evaluation | AI platform | 8 | DONE |",
      "| V22-P9-01 | Canonical backend/database/auth/events | Backend owner | 9 | DONE |",
      "| V22-P10-01 | Production frontend/PWA | Frontend owner | 10 | DONE |",
      "| V22-P11-01 | Production hardening/release | Platform owner | 11 | PARTIAL |",
      "docs:check:v22",
    ],
    "Requirement traceability",
    errors,
  );
  includesEvery(
    phase1Contracts,
    [
      "PHASE 1 EXIT GATE: PASS",
      "DesignDocumentManifestV1",
      "QuantityTakeoffDraftV1",
      "OperationalPlanningSnapshotV1",
      "DailyWorkPlanDraftV1",
      "ProgressVerificationDraftV1",
      "OperationalForecastSnapshotV1",
      "pnpm.cmd run phase1:v22:gate",
    ],
    "Phase 1 contracts",
    errors,
  );
  includesEvery(
    phase2Simulation,
    [
      "PHASE 2 EXIT GATE: PASS",
      "BuildWatchOperationalSimulationV1",
      "48",
      "40",
      "120",
      "117",
      "20",
      "expectedEligible",
      "expectedSourceIds",
      "TENANT-PRIVATE-ONLY",
      "llmRequired: false",
      "pnpm.cmd run phase2:v22:gate",
    ],
    "Phase 2 operational simulation",
    errors,
  );
  includesEvery(
    phase3Planning,
    [
      "PHASE 3 EXIT GATE: PASS",
      "A5-001",
      "DET-PLAN-001",
      "50-work-item",
      "Eligible precision/recall `100% / 100%`",
      "Auto critical omission `0`",
      "Undetected resource conflict `0`",
      "Shortage-г feasible гэж ангилсан тоо `0`",
      "llmRequired: false",
      "pnpm.cmd run phase3:v22:gate",
    ],
    "Phase 3 deterministic planning",
    errors,
  );
  includesEvery(
    phase41A1Integration,
    [
      "PHASE 4.1 EXIT GATE: PASS",
      "ApprovedDailyReportCommandV1",
      "ApprovedA1ActualBundleV1",
      "APPROVED_COMMAND_ONLY",
      "REQUIRES_APPROVED_PROGRESS_VERIFICATION",
      "DET-VERIFY-010",
      "pnpm.cmd run phase4.1:v22:gate",
    ],
    "Phase 4.1 A1 approved actual integration",
    errors,
  );
  includesEvery(
    phase42PhotoEvidence,
    [
      "PHASE 4.2 EXIT GATE: PASS",
      "PhotoEvidencePolicyV1",
      "PE-01–PE-10 canonical mapping",
      "exactQuantityDerived = false",
      "Duplicate precision: `100.00%`",
      "Duplicate recall: `100.00%`",
      "Acceptance accuracy: `100.00%`",
      "pnpm.cmd run phase4.2:v22:gate",
    ],
    "Phase 4.2 deterministic photo evidence",
    errors,
  );
  includesEvery(
    phase4ProgressVerification,
    [
      "PHASE 4 EXIT GATE: PASS",
      "ProgressVerificationRequestV1",
      "ApprovedProgressVerificationCommandV1",
      "COMPLETED",
      "PARTIALLY_COMPLETED",
      "UNVERIFIABLE",
      "Completion classification accuracy: `100.00%`",
      "False `COMPLETED` rate: `0.00%`",
      "Duplicate precision: `100.00%`",
      "Duplicate recall: `100.00%`",
      "Unapproved forecast violation: `0`",
      "pnpm.cmd run phase4:v22:gate",
    ],
    "Phase 4 deterministic progress verification",
    errors,
  );
  includesEvery(
    phase5Forecast,
    [
      "PHASE 5 EXIT GATE: PASS",
      "OperationalForecastRequestV1",
      "ROLLING_ACTUAL",
      "COLD_START_NORM",
      "projectedCriticalPathWorkItemIds",
      "A5_DETERMINISTIC_ONLY",
      "Finish MAE: `0.00 working days`",
      "Critical-delay recall: `100.00%`",
      "Average early warning: `14.52 working days`",
      "False-alert rate: `0.00%`",
      "Source coverage: `100.00%`",
      "Baseline mutations: `0`",
      "pnpm.cmd run phase5:v22:gate",
    ],
    "Phase 5 deterministic forecast and recovery",
    errors,
  );
  includesEvery(
    phase6DesignIntake,
    [
      "PHASE 6 EXIT GATE: PASS",
      "intakeDesignFile",
      "importEngineeringWorkbook",
      "01_Project",
      "18_Approval_Matrix",
      "VerifiedDrawingScaleV1",
      "PDF_VECTOR_LABEL",
      "Element precision: `100.00%`",
      "Element recall: `100.00%`",
      "Unverified metric dimensions: `0`",
      "Source-less accepted elements: `0`",
      "pnpm.cmd run phase6:v22:gate",
    ],
    "Phase 6 deterministic design intake",
    errors,
  );
  includesEvery(
    phase7BaselineGeneration,
    [
      "PHASE 7 EXIT GATE: PASS",
      "phase7QuantityFormulaRegistry",
      "qty-area-net-openings-v1",
      "ApprovedBaselineCommandV1",
      "Formula accuracy: `100.00%`",
      "Quantity source coverage: `100.00%`",
      "Material source coverage: `100.00%`",
      "Estimate source coverage: `100.00%`",
      "Source-less final rows: `0`",
      "Unverified-scale final rows: `0`",
      "Missing-norm final rows: `0`",
      "Missing-price final rows: `0`",
      "Baseline mutations: `0`",
      "Adversarial cases: `7/7 PASS`",
      "pnpm.cmd run phase7:v22:gate",
    ],
    "Phase 7 deterministic baseline generation",
    errors,
  );
  includesEvery(
    phase8Orchestration,
    [
      "PHASE 8 EXIT GATE: PASS",
      "Phase8ToolGateway",
      "runA0Orchestration",
      "runA5Orchestration",
      "Tool coverage: `100.00%` (`26/26`)",
      "A0 tool coverage: `100.00%` (`11/11`)",
      "A5 tool coverage: `100.00%` (`15/15`)",
      "Numeric hallucinations: `0`",
      "Unauthorized sources: `0`",
      "Unauthorized object disclosures: `0`",
      "Tenant-isolation violations: `0`",
      "Unsigned artifact leaks: `0`",
      "Catalog-scope leaks: `0`",
      "Baseline mutations: `0`",
      "Golden cases: `10/10 PASS`",
      "Adversarial cases: `10/10 PASS`",
      "LLM-off core: `PASS`",
      "Run version persistence: `PASS`",
      "pnpm.cmd run phase8:v22:gate",
    ],
    "Phase 8 A0/A5 tool orchestration",
    errors,
  );
  includesEvery(
    phase9Backend,
    [
      "PHASE 9 EXIT GATE: PASS",
      "PrismaPhase9Store",
      "SERIALIZABLE",
      "seven-role RBAC",
      "Refresh rotation",
      "PROJECT_NOT_FOUND",
      "Idempotency-Key",
      "OpenAPI 3.1",
      "Signed artifact",
      "Transactional outbox",
      "pg-boss job `8/8`",
      "A0–A5 production adapters: `6/6`",
      "Backend tests: `25/25`",
      "Golden cases: `10/10 PASS`",
      "PostgreSQL smoke: `7/7 PASS`",
      "Migration нийт `18` invariant trigger",
      "Legacy\nA1–A5 queue нэртэй overlap `0`",
      "pnpm.cmd run phase9:v22:gate",
    ],
    "Phase 9 canonical backend",
    errors,
  );
  includesEvery(
    phase10Frontend,
    [
      "PHASE 10 EXIT GATE: PASS",
      "React 19",
      "TypeScript strict",
      "OpenAPI 3.1",
      "IndexedDB",
      "no-data-loss",
      "≤ 10",
      "A0",
      "A5",
      "A4",
      "Component tests: `7/7 PASS`",
      "Backend Phase 10 E2E: `6/6 PASS`",
      "PostgreSQL smoke: `7/7 PASS`",
      "pnpm.cmd run phase10:v22:gate",
    ],
    "Phase 10 production frontend and PWA",
    errors,
  );
  includesEvery(
    phase11Production,
    [
      "PHASE 11 TECHNICAL GATE: PASS",
      "PHASE 11 FULL RELEASE: PENDING_EXTERNAL_EVIDENCE",
      "ClamAV INSTREAM",
      "HMAC-SHA256",
      "SERIALIZABLE",
      "Prometheus",
      "Sentry",
      "Langfuse",
      "A1–A3/analysis",
      "pnpm.cmd run phase11:fast:v22:gate",
      "pnpm.cmd run phase11:technical:v22:gate",
      "pnpm.cmd run phase11:release:v22:gate",
      "ops/deploy.ps1",
      "ops/rollback.ps1",
    ],
    "Phase 11 production hardening",
    errors,
  );
  includesEvery(
    packageJson,
    [
      '"test:contracts:v22"',
      '"phase1:v22:gate"',
      '"simulation:v22:generate"',
      '"test:simulation:v22"',
      '"phase2:v22:gate"',
      '"plan:v22"',
      '"eval:planning:v22"',
      '"test:planning:v22"',
      '"phase3:v22:gate"',
      '"test:verification:v22"',
      '"phase4.1:v22:gate"',
      '"test:photo:v22"',
      '"eval:photo:v22"',
      '"phase4.2:v22:gate"',
      '"test:progress-verification:v22"',
      '"eval:verification:v22"',
      '"phase4:v22:gate"',
      '"test:forecasting:v22"',
      '"eval:forecasting:v22"',
      '"phase5:v22:gate"',
      '"test:design-intake:v22"',
      '"eval:design-intake:v22"',
      '"phase6:v22:gate"',
      '"baseline:v22"',
      '"test:baseline-generation:v22"',
      '"eval:baseline-generation:v22"',
      '"phase7:v22:gate"',
      '"orchestrate:v22"',
      '"test:orchestration:v22"',
      '"eval:orchestration:v22"',
      '"phase8:v22:gate"',
      '"api:v22"',
      '"worker:phase9"',
      '"bootstrap:phase9"',
      '"test:backend:v22"',
      '"eval:backend:v22"',
      '"smoke:postgres:v22"',
      '"phase9:v22:gate"',
      '"test:phase10:v22"',
      '"test:frontend:v22"',
      '"build:frontend:v22"',
      '"verify:frontend:v22"',
      '"smoke:phase10:postgres:v22"',
      '"phase10:v22:gate"',
      '"test:phase11:v22"',
      '"eval:performance:v22"',
      '"security:secrets:v22"',
      '"phase11:fast:v22:gate"',
      '"phase11:technical:v22:gate"',
      '"phase11:release:v22:gate"',
      "src/scripts/validate-buildwatch-v22-docs.ts",
    ],
    "package.json",
    errors,
  );

  const checkedExitGateItems = architectureFreeze.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedExitGateItems < 10) {
    errors.push(
      `Phase 0 architecture freeze has only ${checkedExitGateItems} checked exit-gate items`,
    );
  }

  const checkedPhase1GateItems = phase1Contracts.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase1GateItems < 11) {
    errors.push(
      `Phase 1 contract document has only ${checkedPhase1GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase2GateItems = phase2Simulation.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase2GateItems < 12) {
    errors.push(
      `Phase 2 simulation document has only ${checkedPhase2GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase3GateItems = phase3Planning.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase3GateItems < 14) {
    errors.push(
      `Phase 3 planning document has only ${checkedPhase3GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase41GateItems = phase41A1Integration.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase41GateItems < 15) {
    errors.push(
      `Phase 4.1 A1 integration document has only ${checkedPhase41GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase42GateItems = phase42PhotoEvidence.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase42GateItems < 19) {
    errors.push(
      `Phase 4.2 photo evidence document has only ${checkedPhase42GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase4GateItems = phase4ProgressVerification.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase4GateItems < 25) {
    errors.push(
      `Phase 4 progress verification document has only ${checkedPhase4GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase5GateItems = phase5Forecast.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase5GateItems < 25) {
    errors.push(
      `Phase 5 forecast document has only ${checkedPhase5GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase6GateItems = phase6DesignIntake.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase6GateItems < 25) {
    errors.push(
      `Phase 6 design intake document has only ${checkedPhase6GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase7GateItems = phase7BaselineGeneration.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase7GateItems < 30) {
    errors.push(
      `Phase 7 baseline generation document has only ${checkedPhase7GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase8GateItems = phase8Orchestration.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase8GateItems < 35) {
    errors.push(
      `Phase 8 orchestration document has only ${checkedPhase8GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase9GateItems = phase9Backend.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase9GateItems < 55) {
    errors.push(
      `Phase 9 canonical backend document has only ${checkedPhase9GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase10GateItems = phase10Frontend.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase10GateItems < 55) {
    errors.push(
      `Phase 10 frontend document has only ${checkedPhase10GateItems} checked exit-gate items`,
    );
  }

  const checkedPhase11GateItems = phase11Production.match(/^- \[x\]/gmu)?.length ?? 0;
  if (checkedPhase11GateItems < 45) {
    errors.push(
      `Phase 11 production document has only ${checkedPhase11GateItems} checked technical items`,
    );
  }

  const unfinishedMarker = /\b(?:TODO|TBD|OPEN_DECISION)\b/u;
  for (const [label, content] of [
    ["Requirement catalog", catalog],
    ["Phase 0 architecture freeze", architectureFreeze],
    ["Phase 1 contracts", phase1Contracts],
    ["Phase 2 operational simulation", phase2Simulation],
    ["Phase 3 deterministic planning", phase3Planning],
    ["Phase 4.1 A1 approved actual integration", phase41A1Integration],
    ["Phase 4.2 deterministic photo evidence", phase42PhotoEvidence],
    ["Phase 4 deterministic progress verification", phase4ProgressVerification],
    ["Phase 5 deterministic forecast and recovery", phase5Forecast],
    ["Phase 6 deterministic design intake", phase6DesignIntake],
    ["Phase 7 deterministic baseline generation", phase7BaselineGeneration],
    ["Phase 8 A0/A5 tool orchestration", phase8Orchestration],
    ["Phase 9 canonical backend", phase9Backend],
    ["Phase 10 production frontend and PWA", phase10Frontend],
    ["Phase 11 production hardening", phase11Production],
  ] as const) {
    if (unfinishedMarker.test(content)) {
      errors.push(`${label} contains an unfinished decision marker`);
    }
  }

  for (const adrFile of requiredAdrFiles) {
    const adrPath = path.join(agentsRoot, "docs", "adr", adrFile);
    const adr = await readRequiredFile(adrPath, errors);
    includesEvery(
      adr,
      ["- Төлөв: Accepted", "- Огноо: 2026-07-31", "## Шийдвэр"],
      `ADR ${adrFile}`,
      errors,
    );
  }

  return {
    valid: errors.length === 0,
    requirementCount: records.length,
    prefixCounts,
    errors,
  };
}

const validation = await validateBuildWatchV22Documentation();

if (!validation.valid) {
  console.error(`BuildWatch v2.2 documentation gate: FAIL (${validation.errors.length} issue(s))`);
  for (const error of validation.errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `BuildWatch v2.2 documentation gate: PASS (${validation.requirementCount} stable requirements, ${requiredAdrFiles.length} ADRs)`,
  );
}
