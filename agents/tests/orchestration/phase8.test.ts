import {
  Phase8ToolAccessError,
  Phase8ToolGateway,
  InMemoryPhase8ReadRepository,
  buildPhase8GoldenFixture,
  createPhase8A0AgentTools,
  createPhase8A5AgentTools,
  evaluatePhase8OrchestrationV22,
  phase8A0ToolNames,
  phase8A5ToolNames,
  phase8AuthorizationContextSchema,
  phase8Hash,
  phase8ToolOutputSchema,
  phase8ToolNames,
  phase8ToolQuerySchema,
  runA0Orchestration,
  runA5Orchestration,
  verifyPhase8FixtureSignedRead,
  type Phase8GoldenFixture,
} from "../../src/orchestration/index.js";

describe("BuildWatch v2.2 Phase 8 tool layer and orchestration", () => {
  let fixture: Phase8GoldenFixture;

  beforeAll(() => {
    fixture = buildPhase8GoldenFixture();
  });

  it("defines exactly 11 A0 and 15 A5 read-only tools", () => {
    expect(phase8A0ToolNames).toHaveLength(11);
    expect(phase8A5ToolNames).toHaveLength(15);
    expect(phase8ToolNames).toHaveLength(26);
    expect(new Set(phase8ToolNames)).toHaveLength(26);
    expect(Object.keys(createPhase8A0AgentTools(fixture.gateway, fixture.context)).sort()).toEqual(
      [...phase8A0ToolNames].sort(),
    );
    expect(Object.keys(createPhase8A5AgentTools(fixture.gateway, fixture.context)).sort()).toEqual(
      [...phase8A5ToolNames].sort(),
    );
  });

  it("enforces strict version, as-of, item, and source query bounds", async () => {
    expect(() =>
      phase8ToolQuerySchema.parse({
        projectId: fixture.a0Request.projectId,
        asOf: fixture.a0Request.asOf,
        limit: 501,
      }),
    ).toThrow();
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
    expect(limited.records).toHaveLength(1);
    expect(limited.meta.truncated).toBe(true);
    expect(limited.meta.sourceCatalog.length).toBeLessThanOrEqual(1);
    const beforeEffectiveDate = await fixture.gateway.execute(
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
    expect(beforeEffectiveDate.records).toHaveLength(0);
  });

  it("does not expose unassigned or cross-tenant project existence", async () => {
    await expect(
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
    ).rejects.toEqual(expect.any(Phase8ToolAccessError));
    const assignedButWrongTenant = phase8AuthorizationContextSchema.parse({
      ...structuredClone(fixture.context),
      allowedProjectIds: [...fixture.context.allowedProjectIds, "project-private"],
    });
    const output = await fixture.gateway.execute(
      "getDesignDocuments",
      {
        projectId: "project-private",
        asOf: fixture.a0Request.asOf,
        versionId: null,
        limit: 100,
        sourceLimit: 100,
      },
      assignedButWrongTenant,
    );
    expect(output.records).toHaveLength(0);
    expect(JSON.stringify(output)).not.toContain("TENANT-PRIVATE-ONLY");
  });

  it("enforces role, cost, and report-text field permissions", async () => {
    const siteEngineer = phase8AuthorizationContextSchema.parse({
      ...structuredClone(fixture.context),
      roles: ["SITE_ENGINEER"],
    });
    await expect(
      fixture.gateway.execute(
        "getMaterialPrices",
        {
          projectId: fixture.a0Request.projectId,
          asOf: fixture.a0Request.asOf,
          versionId: null,
          limit: 100,
          sourceLimit: 100,
        },
        siteEngineer,
      ),
    ).rejects.toEqual(expect.any(Phase8ToolAccessError));
    const noCost = phase8AuthorizationContextSchema.parse({
      ...structuredClone(fixture.context),
      permissions: fixture.context.permissions.filter((permission) => permission !== "COST_READ"),
    });
    await expect(
      fixture.gateway.execute(
        "getMaterialPrices",
        {
          projectId: fixture.a0Request.projectId,
          asOf: fixture.a0Request.asOf,
          versionId: null,
          limit: 100,
          sourceLimit: 100,
        },
        noCost,
      ),
    ).rejects.toEqual(expect.any(Phase8ToolAccessError));
    const noReportText = phase8AuthorizationContextSchema.parse({
      ...structuredClone(fixture.context),
      permissions: fixture.context.permissions.filter(
        (permission) => permission !== "REPORT_TEXT_READ",
      ),
    });
    await expect(
      fixture.gateway.execute(
        "getDailyActuals",
        {
          projectId: fixture.a5Request.projectId,
          asOf: fixture.a5Request.asOf,
          versionId: null,
          limit: 100,
          sourceLimit: 100,
        },
        noReportText,
      ),
    ).rejects.toEqual(expect.any(Phase8ToolAccessError));
  });

  it("requires signed artifact grants and explicit catalog scope", async () => {
    const unsigned = phase8AuthorizationContextSchema.parse({
      ...structuredClone(fixture.context),
      signedArtifactReads: [],
    });
    const design = await fixture.gateway.execute(
      "getDesignDocuments",
      {
        projectId: fixture.a0Request.projectId,
        asOf: fixture.a0Request.asOf,
        versionId: null,
        limit: 100,
        sourceLimit: 100,
      },
      unsigned,
    );
    expect(design.records).toHaveLength(0);
    const noCatalog = phase8AuthorizationContextSchema.parse({
      ...structuredClone(fixture.context),
      allowedCatalogVersionIds: [],
    });
    const prices = await fixture.gateway.execute(
      "getMaterialPrices",
      {
        projectId: fixture.a0Request.projectId,
        asOf: fixture.a0Request.asOf,
        versionId: null,
        limit: 100,
        sourceLimit: 100,
      },
      noCatalog,
    );
    expect(prices.records).toHaveLength(0);
  });

  it("keeps the in-memory repository immutable and read-only", async () => {
    const first = await fixture.gateway.execute(
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
    const originalHash = phase8Hash(first);
    first.records[0]!.data.mutated = true;
    const replay = await fixture.gateway.execute(
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
    expect(phase8Hash(replay)).toBe(originalHash);
  });

  it("rejects inconsistent tool response and repository authorization metadata", async () => {
    const output = await fixture.gateway.execute(
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
    expect(() =>
      phase8ToolOutputSchema.parse({
        ...output,
        meta: {
          ...output.meta,
          returnedRowCount: output.records.length + 1,
        },
      }),
    ).toThrow();

    const original = fixture.records.find(
      (record) =>
        record.toolName === "getVerifiedScale" &&
        record.tenantId === fixture.a0Request.tenantId &&
        record.projectId === fixture.a0Request.projectId,
    );
    expect(original).toBeDefined();
    const tampered = {
      ...structuredClone(original!),
      sourceRefs: [],
    };
    expect(
      () =>
        new InMemoryPhase8ReadRepository([
          ...fixture.records.filter((record) => record !== original),
          tampered,
        ]),
    ).toThrow("authorization metadata is inconsistent");
  });

  it("runs the full A0 design-to-baseline draft orchestration", async () => {
    const result = await runA0Orchestration(fixture.a0Request, fixture.context, fixture.gateway);
    expect(result.run.status).toBe("REVIEW_REQUIRED");
    expect(result.issues).toEqual([]);
    expect(result.run.toolCalls).toHaveLength(11);
    expect(result.quantityDraft).not.toBeNull();
    expect(result.estimateDraft).not.toBeNull();
    expect(result.scheduleDraft).not.toBeNull();
    expect(result.baselineDraft).not.toBeNull();
    expect(result.reviewQueue.map((task) => task.targetType)).toEqual([
      "QUANTITY_TAKEOFF",
      "ESTIMATE",
      "SCHEDULE",
      "BASELINE",
    ]);
    expect(result.safeguards.numericHallucinationCount).toBe(0);
  });

  it("blocks A0 metric quantity when verified scale is unavailable", async () => {
    const repository = new InMemoryPhase8ReadRepository(
      fixture.records.filter(
        (record) =>
          !(
            record.tenantId === fixture.a0Request.tenantId &&
            record.projectId === fixture.a0Request.projectId &&
            record.toolName === "getVerifiedScale"
          ),
      ),
    );
    const gateway = new Phase8ToolGateway(repository, verifyPhase8FixtureSignedRead);
    const result = await runA0Orchestration(
      { ...fixture.a0Request, runId: "phase8-a0-scale-block-test" },
      fixture.context,
      gateway,
    );
    expect(result.run.status).toBe("BLOCKED");
    expect(result.quantityDraft).toBeNull();
    expect(result.estimateDraft).toBeNull();
    expect(result.issues).toContain("VERIFIED_SCALE_REQUIRED");
  });

  it("blocks A0 downstream drafts when authorized design metadata is missing", async () => {
    const repository = new InMemoryPhase8ReadRepository(
      fixture.records.filter(
        (record) =>
          !(
            record.tenantId === fixture.a0Request.tenantId &&
            record.projectId === fixture.a0Request.projectId &&
            record.toolName === "getDesignDocuments"
          ),
      ),
    );
    const gateway = new Phase8ToolGateway(repository, verifyPhase8FixtureSignedRead);
    const result = await runA0Orchestration(
      { ...fixture.a0Request, runId: "phase8-a0-design-block-test" },
      fixture.context,
      gateway,
    );
    expect(result.run.status).toBe("BLOCKED");
    expect(result.quantityDraft).toBeNull();
    expect(result.baselineDraft).toBeNull();
    expect(result.issues).toContain("AUTHORIZED_DESIGN_DOCUMENT_REQUIRED");
  });

  it("runs A5 planning, verification, forecast, and recovery without an LLM", async () => {
    const result = await runA5Orchestration(fixture.a5Request, fixture.context, fixture.gateway);
    expect(result.run.status).toBe("REVIEW_REQUIRED");
    expect(result.issues).toEqual([]);
    expect(result.run.toolCalls).toHaveLength(15);
    expect(result.planResult.draft).not.toBeNull();
    expect(result.photoEvidence.length).toBeGreaterThan(0);
    expect(result.progressVerification).not.toBeNull();
    expect(result.rollingProductivity).not.toBeNull();
    expect(result.latestForecast).not.toBeNull();
    expect(result.recoveryScenarios.length).toBeGreaterThan(0);
    expect(result.recoveryScenarios.every((proposal) => !proposal.baselineChanged)).toBe(true);
    expect(result.run.modelProvider).toBe("NONE");
    expect(result.optionalExplanation).toBeNull();
  });

  it("persists prompt, model, tool, and output schema versions", async () => {
    const result = await runA5Orchestration(fixture.a5Request, fixture.context, fixture.gateway);
    expect(result.run.promptVersion).toBe("buildwatch-a5-orchestration-prompt-v1");
    expect(result.run.modelVersion).toBe("llm-off-v1");
    expect(result.run.toolContractVersion).toBe("buildwatch-v22-phase8-tools-v1");
    expect(result.run.outputSchemaVersion).toBe(1);
  });

  it("passes every Phase 8 golden and adversarial release case", async () => {
    const report = await evaluatePhase8OrchestrationV22();
    expect(report.passed).toBe(true);
    expect(report.metrics.toolCoverage).toBe(1);
    expect(report.metrics.goldenPassCount).toBe(10);
    expect(report.metrics.adversarialPassCount).toBe(10);
    expect(report.metrics.numericHallucinationCount).toBe(0);
    expect(report.metrics.unauthorizedSourceCount).toBe(0);
    expect(report.metrics.tenantIsolationViolationCount).toBe(0);
    expect(report.metrics.deterministicReplayPassed).toBe(true);
  });
});
