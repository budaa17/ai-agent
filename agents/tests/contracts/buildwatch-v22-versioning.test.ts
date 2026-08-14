import { describe, expect, it } from "vitest";
import {
  baselineDraftV1Schema,
  dailyWorkPlanDraftV1Schema,
  designDocumentManifestV1Schema,
  designElementCandidateV1Schema,
  drawingRevisionV1Schema,
  estimateDraftV1Schema,
  operationalForecastSnapshotV1Schema,
  operationalPlanningSnapshotV1Schema,
  progressVerificationDraftV1Schema,
  quantityTakeoffDraftV1Schema,
  recoveryProposalDraftV1Schema,
  rollingProductivitySnapshotV1Schema,
  verifiedDrawingScaleV1Schema,
} from "../../src/contracts/index.js";
import {
  buildBaselineDraft,
  buildDailyWorkPlanDraft,
  buildDesignDocumentManifest,
  buildDesignElementCandidate,
  buildDrawingRevision,
  buildEstimateDraft,
  buildOperationalForecastSnapshot,
  buildOperationalPlanningSnapshot,
  buildProgressVerificationDraft,
  buildQuantityTakeoffDraft,
  buildRecoveryProposalDraft,
  buildRollingProductivitySnapshot,
  buildVerifiedDrawingScale,
} from "./buildwatch-v22-fixtures.js";

const contracts = [
  {
    name: "DesignDocumentManifestV1",
    schema: designDocumentManifestV1Schema,
    fixture: buildDesignDocumentManifest(),
  },
  {
    name: "DrawingRevisionV1",
    schema: drawingRevisionV1Schema,
    fixture: buildDrawingRevision(),
  },
  {
    name: "VerifiedDrawingScaleV1",
    schema: verifiedDrawingScaleV1Schema,
    fixture: buildVerifiedDrawingScale(),
  },
  {
    name: "DesignElementCandidateV1",
    schema: designElementCandidateV1Schema,
    fixture: buildDesignElementCandidate(),
  },
  {
    name: "QuantityTakeoffDraftV1",
    schema: quantityTakeoffDraftV1Schema,
    fixture: buildQuantityTakeoffDraft(),
  },
  {
    name: "EstimateDraftV1",
    schema: estimateDraftV1Schema,
    fixture: buildEstimateDraft(),
  },
  {
    name: "BaselineDraftV1",
    schema: baselineDraftV1Schema,
    fixture: buildBaselineDraft(),
  },
  {
    name: "OperationalPlanningSnapshotV1",
    schema: operationalPlanningSnapshotV1Schema,
    fixture: buildOperationalPlanningSnapshot(),
  },
  {
    name: "DailyWorkPlanDraftV1",
    schema: dailyWorkPlanDraftV1Schema,
    fixture: buildDailyWorkPlanDraft(),
  },
  {
    name: "ProgressVerificationDraftV1",
    schema: progressVerificationDraftV1Schema,
    fixture: buildProgressVerificationDraft(),
  },
  {
    name: "RollingProductivitySnapshotV1",
    schema: rollingProductivitySnapshotV1Schema,
    fixture: buildRollingProductivitySnapshot(),
  },
  {
    name: "OperationalForecastSnapshotV1",
    schema: operationalForecastSnapshotV1Schema,
    fixture: buildOperationalForecastSnapshot(),
  },
  {
    name: "RecoveryProposalDraftV1",
    schema: recoveryProposalDraftV1Schema,
    fixture: buildRecoveryProposalDraft(),
  },
] as const;

describe("BuildWatch v2.2 contract compatibility boundary", () => {
  for (const contract of contracts) {
    it(`${contract.name} round-trips v1 JSON`, () => {
      const serialized = JSON.stringify(contract.fixture);
      expect(contract.schema.parse(JSON.parse(serialized))).toEqual(contract.fixture);
    });

    it(`${contract.name} rejects unknown versions and fields`, () => {
      expect(
        contract.schema.safeParse({
          ...contract.fixture,
          schemaVersion: 2,
        }).success,
      ).toBe(false);
      expect(
        contract.schema.safeParse({
          ...contract.fixture,
          futureField: "requires a new schema version",
        }).success,
      ).toBe(false);
    });
  }
});
