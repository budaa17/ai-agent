import {
  phase8AuthorizationContextSchema,
  phase8ToolNames,
  type Phase8AuthorizationContext,
  type Phase8ToolName,
} from "./contracts.js";
import { Phase8ToolAccessError } from "./authorization.js";
import { runA0Orchestration } from "./a0.js";
import { runA5Orchestration } from "./a5.js";
import { buildPhase8GoldenFixture, verifyPhase8FixtureSignedRead } from "./fixtures.js";
import { phase8Hash } from "./deterministic.js";
import { InMemoryPhase8ReadRepository } from "./repository.js";
import { Phase8ToolGateway } from "./tools.js";

export type Phase8EvaluationCase = Readonly<{
  caseId: string;
  category: "GOLDEN" | "ADVERSARIAL";
  passed: boolean;
  message: string;
}>;

export type Phase8EvaluationReport = Readonly<{
  schemaVersion: 1;
  evaluationType: "BUILDWATCH_V22_A0_A5_ORCHESTRATION";
  evaluatedAt: string;
  metrics: Readonly<{
    toolDefinitionCount: number;
    invokedToolCount: number;
    toolCoverage: number;
    a0ToolCoverage: number;
    a5ToolCoverage: number;
    numericHallucinationCount: number;
    unauthorizedSourceCount: number;
    unauthorizedObjectDisclosureCount: number;
    tenantIsolationViolationCount: number;
    unsignedArtifactLeakCount: number;
    catalogScopeLeakCount: number;
    baselineMutationCount: number;
    goldenPassCount: number;
    goldenCaseCount: number;
    adversarialPassCount: number;
    adversarialCaseCount: number;
    deterministicReplayPassed: boolean;
    versionAsOfLimitPassed: boolean;
    readOnlyMutationPassed: boolean;
    runVersionPersistencePassed: boolean;
    llmOffCorePassed: boolean;
  }>;
  cases: readonly Phase8EvaluationCase[];
  passed: boolean;
}>;

function withoutPermission(
  context: Phase8AuthorizationContext,
  permission: Phase8AuthorizationContext["permissions"][number],
): Phase8AuthorizationContext {
  return phase8AuthorizationContextSchema.parse({
    ...structuredClone(context),
    permissions: context.permissions.filter((value) => value !== permission),
  });
}

async function accessRejected(task: () => Promise<unknown>): Promise<boolean> {
  try {
    await task();
    return false;
  } catch (error) {
    return (
      error instanceof Phase8ToolAccessError &&
      error.message === "Resource is not available in the authorized scope"
    );
  }
}

function caseResult(
  caseId: string,
  category: Phase8EvaluationCase["category"],
  passed: boolean,
  message: string,
): Phase8EvaluationCase {
  return { caseId, category, passed, message };
}

export async function evaluatePhase8OrchestrationV22(): Promise<Phase8EvaluationReport> {
  const fixture = buildPhase8GoldenFixture();
  const a0 = await runA0Orchestration(fixture.a0Request, fixture.context, fixture.gateway);
  const a5 = await runA5Orchestration(fixture.a5Request, fixture.context, fixture.gateway);
  const replayA0 = await runA0Orchestration(fixture.a0Request, fixture.context, fixture.gateway);
  const replayA5 = await runA5Orchestration(fixture.a5Request, fixture.context, fixture.gateway);
  const invoked = new Set<Phase8ToolName>([
    ...a0.run.toolCalls.map((call) => call.toolName),
    ...a5.run.toolCalls.map((call) => call.toolName),
  ]);
  const goldenCases: Phase8EvaluationCase[] = [
    caseResult(
      "a0-document-classification",
      "GOLDEN",
      a0.workflow.some(
        (step) => step.stage === "CLASSIFY_DOCUMENTS" && step.status === "COMPLETED",
      ),
      "A0 classified authorized design documents through signed-read bounded tools.",
    ),
    caseResult(
      "a0-element-candidate",
      "GOLDEN",
      a0.workflow.some(
        (step) => step.stage === "VERIFY_SCALE_AND_ELEMENTS" && step.status === "COMPLETED",
      ),
      "A0 matched reviewed element candidates to the authorized extraction set.",
    ),
    caseResult(
      "a0-scale-safety",
      "GOLDEN",
      a0.quantityDraft !== null && a0.quantityDraft.content.scaleStatus === "VERIFIED",
      "Only engineer-verified scale reached deterministic metric quantity.",
    ),
    caseResult(
      "a0-quantity-source-grounding",
      "GOLDEN",
      a0.quantityDraft !== null && a0.safeguards.unauthorizedSourceCount === 0,
      "Quantity replay remained source-backed with zero unauthorized sources.",
    ),
    caseResult(
      "a5-planning",
      "GOLDEN",
      a5.planResult.draft !== null && a5.planResult.deterministic,
      "A5 eligibility, priority, target, and conflict logic ran deterministically.",
    ),
    caseResult(
      "a5-photo-verification",
      "GOLDEN",
      a5.photoEvidence.length > 0 && a5.progressVerification !== null,
      "Signed photo metadata and deterministic verification were joined.",
    ),
    caseResult(
      "a5-forecast",
      "GOLDEN",
      a5.rollingProductivity !== null && a5.latestForecast !== null,
      "Rolling productivity and projected finish were available from deterministic services.",
    ),
    caseResult(
      "a5-recovery",
      "GOLDEN",
      a5.recoveryScenarios.length > 0 &&
        a5.recoveryScenarios.every((proposal) => !proposal.baselineChanged),
      "Recovery impacts remained advisory and did not mutate the baseline.",
    ),
    caseResult(
      "tenant-isolation",
      "GOLDEN",
      !JSON.stringify([a0, a5]).includes("TENANT-PRIVATE-ONLY"),
      "No private-tenant marker appeared in either orchestration result.",
    ),
    caseResult(
      "llm-off-fallback",
      "GOLDEN",
      a0.run.modelProvider === "NONE" &&
        a5.run.modelProvider === "NONE" &&
        a0.safeguards.llmOffCorePassed &&
        a5.safeguards.llmOffCorePassed,
      "A0/A5 core completed without an LLM or API quota.",
    ),
  ];

  const noScaleRepository = new InMemoryPhase8ReadRepository(
    fixture.records.filter(
      (record) =>
        !(
          record.tenantId === fixture.a0Request.tenantId &&
          record.projectId === fixture.a0Request.projectId &&
          record.toolName === "getVerifiedScale"
        ),
    ),
  );
  const noScaleRun = await runA0Orchestration(
    { ...fixture.a0Request, runId: "phase8-a0-no-scale" },
    fixture.context,
    new Phase8ToolGateway(noScaleRepository, verifyPhase8FixtureSignedRead),
  );
  const crossTenantContext = phase8AuthorizationContextSchema.parse({
    ...structuredClone(fixture.context),
    allowedProjectIds: [...fixture.context.allowedProjectIds, "project-private"],
  });
  const crossTenantOutput = await fixture.gateway.execute(
    "getDesignDocuments",
    {
      projectId: "project-private",
      asOf: fixture.a0Request.asOf,
      versionId: null,
      limit: 100,
      sourceLimit: 100,
    },
    crossTenantContext,
  );
  const unsignedContext = phase8AuthorizationContextSchema.parse({
    ...structuredClone(fixture.context),
    signedArtifactReads: [],
  });
  const unsignedOutput = await fixture.gateway.execute(
    "getDesignDocuments",
    {
      projectId: fixture.a0Request.projectId,
      asOf: fixture.a0Request.asOf,
      versionId: null,
      limit: 100,
      sourceLimit: 100,
    },
    unsignedContext,
  );
  const noCatalogContext = phase8AuthorizationContextSchema.parse({
    ...structuredClone(fixture.context),
    allowedCatalogVersionIds: [],
  });
  const noCatalogOutput = await fixture.gateway.execute(
    "getMaterialPrices",
    {
      projectId: fixture.a0Request.projectId,
      asOf: fixture.a0Request.asOf,
      versionId: null,
      limit: 100,
      sourceLimit: 100,
    },
    noCatalogContext,
  );
  const limited = await fixture.gateway.execute(
    "getExtractedElements",
    {
      projectId: fixture.a0Request.projectId,
      asOf: fixture.a0Request.asOf,
      versionId: null,
      limit: 1,
      sourceLimit: 1,
    },
    fixture.context,
  );
  const beforeAsOf = await fixture.gateway.execute(
    "getExtractedElements",
    {
      projectId: fixture.a0Request.projectId,
      asOf: "2026-01-01T00:00:00.000Z",
      versionId: null,
      limit: 100,
      sourceLimit: 100,
    },
    fixture.context,
  );
  const firstRead = await fixture.gateway.execute(
    "getVerifiedScale",
    {
      projectId: fixture.a0Request.projectId,
      asOf: fixture.a0Request.asOf,
      versionId: null,
      limit: 100,
      sourceLimit: 100,
    },
    fixture.context,
  );
  const originalHash = phase8Hash(firstRead);
  if (firstRead.records[0] !== undefined) {
    firstRead.records[0].data.mutated = true;
  }
  const secondRead = await fixture.gateway.execute(
    "getVerifiedScale",
    {
      projectId: fixture.a0Request.projectId,
      asOf: fixture.a0Request.asOf,
      versionId: null,
      limit: 100,
      sourceLimit: 100,
    },
    fixture.context,
  );
  const adversarialCases: Phase8EvaluationCase[] = [
    caseResult(
      "unverified-scale-block",
      "ADVERSARIAL",
      noScaleRun.run.status === "BLOCKED" && noScaleRun.quantityDraft === null,
      "Removing verified scale blocked every metric quantity and downstream draft.",
    ),
    caseResult(
      "cross-tenant-nondisclosure",
      "ADVERSARIAL",
      crossTenantOutput.records.length === 0 &&
        !JSON.stringify(crossTenantOutput).includes("TENANT-PRIVATE-ONLY"),
      "An assigned project ID in another tenant returned no object or existence marker.",
    ),
    caseResult(
      "project-assignment-denial",
      "ADVERSARIAL",
      await accessRejected(() =>
        fixture.gateway.execute(
          "getDesignDocuments",
          {
            projectId: "project-private",
            asOf: fixture.a0Request.asOf,
            versionId: null,
            limit: 100,
            sourceLimit: 100,
          },
          fixture.context,
        ),
      ),
      "Unassigned project access failed with the same non-disclosing error.",
    ),
    caseResult(
      "role-permission-denial",
      "ADVERSARIAL",
      await accessRejected(() =>
        fixture.gateway.execute(
          "getMaterialPrices",
          {
            projectId: fixture.a0Request.projectId,
            asOf: fixture.a0Request.asOf,
            versionId: null,
            limit: 100,
            sourceLimit: 100,
          },
          phase8AuthorizationContextSchema.parse({
            ...structuredClone(fixture.context),
            roles: ["SITE_ENGINEER"],
          }),
        ),
      ),
      "Role policy denied estimator cost tooling to a site-engineer-only context.",
    ),
    caseResult(
      "cost-permission-denial",
      "ADVERSARIAL",
      await accessRejected(() =>
        fixture.gateway.execute(
          "getMaterialPrices",
          {
            projectId: fixture.a0Request.projectId,
            asOf: fixture.a0Request.asOf,
            versionId: null,
            limit: 100,
            sourceLimit: 100,
          },
          withoutPermission(fixture.context, "COST_READ"),
        ),
      ),
      "Missing cost permission denied price data.",
    ),
    caseResult(
      "report-text-permission-denial",
      "ADVERSARIAL",
      await accessRejected(() =>
        fixture.gateway.execute(
          "getDailyActuals",
          {
            projectId: fixture.a5Request.projectId,
            asOf: fixture.a5Request.asOf,
            versionId: null,
            limit: 100,
            sourceLimit: 100,
          },
          withoutPermission(fixture.context, "REPORT_TEXT_READ"),
        ),
      ),
      "Missing report-text permission denied daily actual data.",
    ),
    caseResult(
      "unsigned-artifact-denial",
      "ADVERSARIAL",
      unsignedOutput.records.length === 0,
      "Design artifact records disappeared when no valid signed-read grant was present.",
    ),
    caseResult(
      "catalog-scope-denial",
      "ADVERSARIAL",
      noCatalogOutput.records.length === 0,
      "Catalog records outside the explicit source catalog scope were hidden.",
    ),
    caseResult(
      "version-asof-source-limit",
      "ADVERSARIAL",
      limited.records.length === 1 &&
        limited.meta.truncated &&
        limited.meta.sourceCatalog.length <= 1 &&
        beforeAsOf.records.length === 0,
      "Version/as-of/item/source bounds were enforced before tool output.",
    ),
    caseResult(
      "read-only-repository",
      "ADVERSARIAL",
      phase8Hash(secondRead) === originalHash,
      "Mutating one returned object did not mutate repository state.",
    ),
  ];
  const cases = [...goldenCases, ...adversarialCases];
  const goldenPassCount = goldenCases.filter((item) => item.passed).length;
  const adversarialPassCount = adversarialCases.filter((item) => item.passed).length;
  const deterministicReplayPassed =
    phase8Hash(a0) === phase8Hash(replayA0) && phase8Hash(a5) === phase8Hash(replayA5);
  const runVersionPersistencePassed = [a0.run, a5.run].every(
    (run) =>
      run.promptVersion.length > 0 &&
      run.modelName.length > 0 &&
      run.modelVersion.length > 0 &&
      run.toolContractVersion === "buildwatch-v22-phase8-tools-v1" &&
      run.outputSchemaVersion === 1,
  );
  const metrics: Phase8EvaluationReport["metrics"] = {
    toolDefinitionCount: phase8ToolNames.length,
    invokedToolCount: invoked.size,
    toolCoverage: invoked.size / phase8ToolNames.length,
    a0ToolCoverage: a0.run.toolCalls.length / 11,
    a5ToolCoverage: a5.run.toolCalls.length / 15,
    numericHallucinationCount:
      a0.safeguards.numericHallucinationCount + a5.safeguards.numericHallucinationCount,
    unauthorizedSourceCount:
      a0.safeguards.unauthorizedSourceCount + a5.safeguards.unauthorizedSourceCount,
    unauthorizedObjectDisclosureCount:
      a0.safeguards.unauthorizedObjectDisclosureCount +
      a5.safeguards.unauthorizedObjectDisclosureCount,
    tenantIsolationViolationCount: crossTenantOutput.records.length === 0 ? 0 : 1,
    unsignedArtifactLeakCount: unsignedOutput.records.length,
    catalogScopeLeakCount: noCatalogOutput.records.length,
    baselineMutationCount:
      a0.safeguards.baselineMutationCount + a5.safeguards.baselineMutationCount,
    goldenPassCount,
    goldenCaseCount: goldenCases.length,
    adversarialPassCount,
    adversarialCaseCount: adversarialCases.length,
    deterministicReplayPassed,
    versionAsOfLimitPassed: adversarialCases.find(
      (item) => item.caseId === "version-asof-source-limit",
    )!.passed,
    readOnlyMutationPassed: adversarialCases.find((item) => item.caseId === "read-only-repository")!
      .passed,
    runVersionPersistencePassed,
    llmOffCorePassed: a0.safeguards.llmOffCorePassed && a5.safeguards.llmOffCorePassed,
  };
  const passed =
    metrics.toolDefinitionCount === 26 &&
    metrics.toolCoverage === 1 &&
    metrics.a0ToolCoverage === 1 &&
    metrics.a5ToolCoverage === 1 &&
    metrics.numericHallucinationCount === 0 &&
    metrics.unauthorizedSourceCount === 0 &&
    metrics.unauthorizedObjectDisclosureCount === 0 &&
    metrics.tenantIsolationViolationCount === 0 &&
    metrics.unsignedArtifactLeakCount === 0 &&
    metrics.catalogScopeLeakCount === 0 &&
    metrics.baselineMutationCount === 0 &&
    metrics.goldenPassCount === metrics.goldenCaseCount &&
    metrics.adversarialPassCount === metrics.adversarialCaseCount &&
    metrics.deterministicReplayPassed &&
    metrics.versionAsOfLimitPassed &&
    metrics.readOnlyMutationPassed &&
    metrics.runVersionPersistencePassed &&
    metrics.llmOffCorePassed;
  return {
    schemaVersion: 1,
    evaluationType: "BUILDWATCH_V22_A0_A5_ORCHESTRATION",
    evaluatedAt: "2026-08-03T03:00:00.000Z",
    metrics,
    cases,
    passed,
  };
}
