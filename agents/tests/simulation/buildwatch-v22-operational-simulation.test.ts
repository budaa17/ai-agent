import { beforeAll, describe, expect, it } from "vitest";
import {
  operationalForecastSnapshotV1Schema,
  operationalPlanningSnapshotV1Schema,
  progressVerificationDraftV1Schema,
  projectAnalysisSnapshotV1Schema,
  rollingProductivitySnapshotV1Schema,
} from "../../src/contracts/index.js";
import {
  OPERATIONAL_SIMULATION_SCENARIOS,
  buildBuildWatchOperationalSimulation,
  buildWatchOperationalSimulationV1Schema,
  operationalSimulationCounts,
  operationalSimulationPlanningDates,
  replayBuildWatchOperationalSimulation,
} from "../../src/simulation/index.js";

describe("BuildWatch v2.2 operational simulation", () => {
  let simulation: ReturnType<typeof buildBuildWatchOperationalSimulation>;

  beforeAll(() => {
    const previousKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      simulation = buildBuildWatchOperationalSimulation();
    } finally {
      if (previousKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previousKey;
      }
    }
  });

  it("builds the complete deterministic Phase 2 foundation", () => {
    const counts = operationalSimulationCounts(simulation);

    expect(buildWatchOperationalSimulationV1Schema.safeParse(simulation).success).toBe(true);
    expect(counts.workItems).toBe(48);
    expect(counts.planningDays).toBeGreaterThanOrEqual(30);
    expect(counts.planItemDecisions).toBeGreaterThanOrEqual(100);
    expect(counts.photos).toBeGreaterThanOrEqual(60);
    expect(counts.verificationDrafts).toBe(39);
    expect(counts.forecasts).toBeGreaterThanOrEqual(3);
    expect(counts.answerCases).toBe(OPERATIONAL_SIMULATION_SCENARIOS.length);
    expect(simulation.agentDataset.deterministic).toBe(true);
    expect(simulation.agentDataset.llmRequired).toBe(false);
    expect(
      simulation.agentDataset.operationalSnapshots.every(
        (snapshot) => snapshot.workItems.length === 48,
      ),
    ).toBe(true);
  });

  it("is byte-for-byte deterministic for the same seed", () => {
    const second = buildBuildWatchOperationalSimulation(simulation.seed);

    expect(second).toEqual(simulation);
  });

  it("keeps hidden answers and private tenant data outside agent data", () => {
    const publicAgentData = JSON.stringify(simulation.agentDataset);

    expect(publicAgentData).not.toContain("operational-answer-");
    expect(publicAgentData).not.toContain("TENANT-PRIVATE-ONLY");
    expect(publicAgentData).not.toContain("tenant-private");
    expect(simulation.privateFixture.tenantId).toBe("tenant-private");
    expect(simulation.privateFixture.projectId).not.toBe(simulation.agentDataset.projectId);
  });

  it("covers every positive, negative, and boundary scenario", () => {
    const cases = simulation.answerKey.cases;

    expect(new Set(cases.map((answerCase) => answerCase.scenario))).toEqual(
      new Set(OPERATIONAL_SIMULATION_SCENARIOS),
    );
    expect(new Set(cases.map((answerCase) => answerCase.controlType))).toEqual(
      new Set(["POSITIVE", "NEGATIVE", "BOUNDARY"]),
    );
    expect(
      cases.every((answerCase) =>
        [
          "expectedEligible",
          "expectedPriority",
          "expectedDailyTarget",
          "expectedConflicts",
          "expectedCompletionStatus",
          "expectedVariance",
          "expectedForecastStatus",
          "expectedDrivers",
          "expectedSourceIds",
        ].every((field) => Object.hasOwn(answerCase, field)),
      ),
    ).toBe(true);
    const sourceIds = new Set(
      simulation.agentDataset.sourceCatalog.map((source) => source.sourceId),
    );
    expect(
      cases.every(
        (answerCase) =>
          answerCase.expectedSourceIds.length > 0 &&
          answerCase.expectedSourceIds.every((sourceId) => sourceIds.has(sourceId)),
      ),
    ).toBe(true);
  });

  it("encodes exact planning and verification boundary outcomes", () => {
    const caseByScenario = new Map(
      simulation.answerKey.cases.map((answerCase) => [answerCase.scenario, answerCase]),
    );

    expect(caseByScenario.get("HEALTHY_CONTROL")).toMatchObject({
      expectedEligible: true,
      expectedConflicts: [],
      expectedCompletionStatus: "COMPLETED",
      expectedForecastStatus: "ON_TRACK",
    });
    expect(caseByScenario.get("PREDECESSOR_UNFINISHED")).toMatchObject({
      expectedEligible: false,
      expectedDailyTarget: null,
      expectedConflicts: ["PRECONDITION_UNSATISFIED"],
    });
    expect(caseByScenario.get("MATERIAL_SHORTAGE")).toMatchObject({
      expectedEligible: false,
      expectedConflicts: ["MATERIAL_SHORTAGE"],
    });
    expect(caseByScenario.get("PLANNED_TARGET_PARTIAL")?.expectedDailyTarget).not.toBeNull();
    expect(caseByScenario.get("APPROVED_BLOCKER")?.expectedCompletionStatus).toBe("BLOCKED");
    expect(caseByScenario.get("MISSING_REPORT")).toMatchObject({
      progressVerificationDraftId: null,
      expectedCompletionStatus: "UNVERIFIABLE",
      expectedVariance: null,
    });
    expect(caseByScenario.get("FALSE_COMPLETED")?.expectedCompletionStatus).toBe(
      "PARTIALLY_COMPLETED",
    );
    expect(Number(caseByScenario.get("FALSE_COMPLETED")?.expectedVariance?.quantity)).toBeLessThan(
      0,
    );
  });

  it("encodes photo provenance and quality failure controls", () => {
    const cases = new Map(
      simulation.answerKey.cases.map((answerCase) => [answerCase.scenario, answerCase]),
    );
    const photoById = new Map(
      simulation.agentDataset.photoMetadata.map((photo) => [photo.photoId, photo]),
    );
    const photoFor = (
      scenario:
        | "BLURRY_DARK_PHOTO"
        | "DUPLICATE_PHOTO"
        | "PREVIOUS_DAY_REUSED_PHOTO"
        | "REPORT_PHOTO_MISMATCH",
    ) => photoById.get(cases.get(scenario)!.photoIds[0]!)!;

    expect(photoFor("BLURRY_DARK_PHOTO")).toMatchObject({
      acceptedForVerification: false,
      sharpnessScore: 0.12,
      brightnessScore: 0.1,
    });
    expect(photoFor("DUPLICATE_PHOTO").duplicateOfPhotoId).not.toBeNull();
    expect(photoFor("PREVIOUS_DAY_REUSED_PHOTO").reusedFromReportDate).not.toBeNull();
    const mismatch = photoFor("REPORT_PHOTO_MISMATCH");
    expect(mismatch.detectedWorkItemId).not.toBe(mismatch.reportedWorkItemId);
    expect(
      [
        "BLURRY_DARK_PHOTO",
        "DUPLICATE_PHOTO",
        "PREVIOUS_DAY_REUSED_PHOTO",
        "REPORT_PHOTO_MISMATCH",
      ].every(
        (scenario) =>
          cases.get(
            scenario as
              | "BLURRY_DARK_PHOTO"
              | "DUPLICATE_PHOTO"
              | "PREVIOUS_DAY_REUSED_PHOTO"
              | "REPORT_PHOTO_MISMATCH",
          )?.expectedCompletionStatus === "UNVERIFIABLE",
      ),
    ).toBe(true);
  });

  it("encodes insufficient, critical-delay, and recovery forecast controls", () => {
    const cases = new Map(
      simulation.answerKey.cases.map((answerCase) => [answerCase.scenario, answerCase]),
    );

    expect(cases.get("INSUFFICIENT_FORECAST_DATA")).toMatchObject({
      expectedForecastStatus: "INSUFFICIENT_DATA",
      expectedDrivers: ["DATA_QUALITY"],
    });
    expect(cases.get("CRITICAL_DELAY")).toMatchObject({
      expectedForecastStatus: "CRITICAL_LATE",
      expectedDrivers: ["DEPENDENCY"],
    });
    const recoveryCase = cases.get("RECOVERY_OPTION_CONFLICT")!;
    expect(recoveryCase.recoveryProposalDraftId).not.toBeNull();
    expect(recoveryCase.expectedConflicts).toEqual(["RECOVERY_RESOURCE_CONFLICT"]);
    const recovery = simulation.agentDataset.recoveryProposals.find(
      (proposal) => proposal.draftId === recoveryCase.recoveryProposalDraftId,
    )!;
    expect(recovery.dependencyConflictIds).toEqual(["recovery-conflict-shared-resource-001"]);
    expect(recovery.baselineChanged).toBe(false);
    expect(recovery.requiresHumanReview).toBe(true);
  });

  it("replays operational history as valid monotonic aggregates", () => {
    const dates = operationalSimulationPlanningDates(simulation);
    const checkpoints = [0, 5, 10, 15, 20, 25, 30, 39].map((index) => dates[index]!);
    let previousPlans = 0;
    let previousPhotos = 0;
    let previousVerifications = 0;
    let previousForecasts = 0;

    for (const date of checkpoints) {
      const replay = replayBuildWatchOperationalSimulation(simulation, date);

      expect(projectAnalysisSnapshotV1Schema.safeParse(replay.analysisSnapshot).success).toBe(true);
      expect(
        replay.operationalSnapshots.every(
          (snapshot) => operationalPlanningSnapshotV1Schema.safeParse(snapshot).success,
        ),
      ).toBe(true);
      expect(
        replay.verificationDrafts.every(
          (draft) => progressVerificationDraftV1Schema.safeParse(draft).success,
        ),
      ).toBe(true);
      expect(
        replay.rollingProductivitySnapshots.every(
          (snapshot) => rollingProductivitySnapshotV1Schema.safeParse(snapshot).success,
        ),
      ).toBe(true);
      expect(
        replay.rollingForecasts.every(
          (snapshot) => operationalForecastSnapshotV1Schema.safeParse(snapshot).success,
        ),
      ).toBe(true);
      expect(replay.dailyPlans.length).toBeGreaterThanOrEqual(previousPlans);
      expect(replay.photoMetadata.length).toBeGreaterThanOrEqual(previousPhotos);
      expect(replay.verificationDrafts.length).toBeGreaterThanOrEqual(previousVerifications);
      expect(replay.rollingForecasts.length).toBeGreaterThanOrEqual(previousForecasts);
      previousPlans = replay.dailyPlans.length;
      previousPhotos = replay.photoMetadata.length;
      previousVerifications = replay.verificationDrafts.length;
      previousForecasts = replay.rollingForecasts.length;
    }
  });

  it("rejects source, identity, and tenant-boundary tampering", () => {
    const wrongSourceScope = structuredClone(simulation);
    wrongSourceScope.agentDataset.sourceCatalog[0]!.tenantId = "tenant-other";
    expect(buildWatchOperationalSimulationV1Schema.safeParse(wrongSourceScope).success).toBe(false);

    const missingCatalogSource = structuredClone(simulation);
    missingCatalogSource.agentDataset.sourceCatalog.shift();
    expect(buildWatchOperationalSimulationV1Schema.safeParse(missingCatalogSource).success).toBe(
      false,
    );

    const duplicatePlan = structuredClone(simulation);
    duplicatePlan.agentDataset.dailyPlans[1]!.draftId =
      duplicatePlan.agentDataset.dailyPlans[0]!.draftId;
    expect(buildWatchOperationalSimulationV1Schema.safeParse(duplicatePlan).success).toBe(false);

    const sameTenantPrivateFixture = structuredClone(simulation);
    sameTenantPrivateFixture.privateFixture.tenantId =
      sameTenantPrivateFixture.agentDataset.tenantId;
    sameTenantPrivateFixture.privateFixture.operationalSnapshot.tenantId =
      sameTenantPrivateFixture.agentDataset.tenantId;
    expect(
      buildWatchOperationalSimulationV1Schema.safeParse(sameTenantPrivateFixture).success,
    ).toBe(false);
  });

  it("builds with OpenAI disabled and no model dependency", () => {
    expect(simulation.agentDataset.llmRequired).toBe(false);
    expect(simulation.agentDataset.deterministic).toBe(true);
    expect(simulation.answerKey.cases).toHaveLength(OPERATIONAL_SIMULATION_SCENARIOS.length);
  });
});
