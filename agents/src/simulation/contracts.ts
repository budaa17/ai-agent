import { z } from "zod";
import {
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractIsoDateTimeSchema,
} from "../contracts/common.js";
import { projectAnalysisSnapshotV1Schema } from "../contracts/project-analysis-snapshot.js";

export const simulationIssueTypeSchema = z.enum([
  "CRITICAL_DELAY",
  "MATERIAL_OVERUSE",
  "STOCK_SHORTAGE",
  "PRODUCTIVITY_DECLINE",
  "COST_AHEAD_OF_PROGRESS",
  "SUBCONTRACTOR_DEVIATION",
  "MISSING_DAILY_REPORT",
  "REPEATED_SUPPLIER_BLOCKER",
  "LINKED_ROOT_CAUSE",
  "DEPENDENCY_VIOLATION",
  "LEDGER_MISMATCH",
  "HEALTHY_CONTROL",
  "CROSS_TENANT_SECRET",
]);

const simulationEvidenceValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const simulationAnswerIssueSchema = z
  .object({
    issueId: contractIdentifierSchema,
    type: simulationIssueTypeSchema,
    severity: z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    effectiveDate: contractIsoDateSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    workItemIds: z.array(contractIdentifierSchema).max(20),
    materialIds: z.array(contractIdentifierSchema).max(20),
    expectedEvidence: z.record(z.string().trim().min(1).max(200), simulationEvidenceValueSchema),
    expectedSourceIds: z.array(contractIdentifierSchema).max(100),
  })
  .strict();

export const simulationAnswerKeyV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    seed: z.string().trim().min(1).max(200),
    generatedAt: contractIsoDateTimeSchema,
    windowStart: contractIsoDateSchema,
    windowEnd: contractIsoDateSchema,
    issues: z.array(simulationAnswerIssueSchema).min(1),
  })
  .strict();

export const buildWatchSimulationV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    seed: z.string().trim().min(1).max(200),
    generatedAt: contractIsoDateTimeSchema,
    windowStart: contractIsoDateSchema,
    windowEnd: contractIsoDateSchema,
    snapshot: projectAnalysisSnapshotV1Schema,
    privateSnapshot: projectAnalysisSnapshotV1Schema,
    answerKey: simulationAnswerKeyV1Schema,
  })
  .strict();

export type SimulationAnswerIssue = z.infer<typeof simulationAnswerIssueSchema>;
export type SimulationAnswerKeyV1 = z.infer<typeof simulationAnswerKeyV1Schema>;
export type BuildWatchSimulationV1 = z.infer<typeof buildWatchSimulationV1Schema>;
