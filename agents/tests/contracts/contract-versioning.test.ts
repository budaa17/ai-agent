import { describe, expect, it } from "vitest";
import {
  agentRunEnvelopeV1Schema,
  dailyReportDraftV1Schema,
  projectAnalysisSnapshotV1Schema,
} from "../../src/contracts/index.js";
import { buildAgentRun, buildDailyReportDraft, buildProjectAnalysisSnapshot } from "./fixtures.js";

const contracts = [
  {
    name: "DailyReportDraftV1",
    schema: dailyReportDraftV1Schema,
    fixture: buildDailyReportDraft(),
  },
  {
    name: "ProjectAnalysisSnapshotV1",
    schema: projectAnalysisSnapshotV1Schema,
    fixture: buildProjectAnalysisSnapshot(),
  },
  {
    name: "AgentRunEnvelopeV1",
    schema: agentRunEnvelopeV1Schema,
    fixture: buildAgentRun(),
  },
] as const;

describe("v1 contract compatibility boundary", () => {
  for (const contract of contracts) {
    it(`${contract.name} round-trips v1 JSON`, () => {
      const serialized = JSON.stringify(contract.fixture);
      const parsed = contract.schema.parse(JSON.parse(serialized));

      expect(parsed).toEqual(contract.fixture);
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
          futureField: "must require a new schema version",
        }).success,
      ).toBe(false);
    });
  }
});
