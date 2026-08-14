import { tool } from "ai";
import {
  phase8A0ToolNames,
  phase8A5ToolNames,
  phase8ToolOutputSchema,
  phase8ToolQuerySchema,
  type Phase8AuthorizationContext,
  type Phase8ToolName,
} from "./contracts.js";
import type { Phase8ToolGateway } from "./tools.js";

const descriptions: Readonly<Record<Phase8ToolName, string>> = {
  getDesignDocuments:
    "Read authorized design-document metadata. Original artifacts require a valid signed-read grant.",
  getDrawingRevisions:
    "Read authorized drawing revision, effective status, and supersession metadata.",
  getDrawingPages: "Read authorized drawing-page metadata and bounded source references.",
  getVerifiedScale:
    "Read engineer-verified drawing scales. Candidate or rejected scales are never returned as verified.",
  getExtractedElements: "Read authorized source-backed design element candidates and dimensions.",
  getQuantityTakeoff: "Read authorized versioned quantity takeoff data without modifying it.",
  getMaterialNorms: "Read authorized effective approved material norm versions.",
  getMaterialPrices:
    "Read authorized effective approved material price versions when cost permission is present.",
  getProductivityRates: "Read authorized approved productivity rate versions.",
  getScheduleDependencies: "Read authorized work-template and schedule dependency versions.",
  getEstimateAssumptions:
    "Read authorized approved estimate policy and assumptions when cost permission is present.",
  getCurrentSchedule: "Read the authorized current operational schedule snapshot.",
  getEligibleWorkItems: "Read deterministic A5 eligibility and priority decisions.",
  getRemainingQuantities: "Read source-backed remaining work quantities.",
  getCrewAvailability: "Read authorized crew availability and productivity capacity.",
  getEquipmentAvailability: "Read authorized equipment availability and capacity.",
  getMaterialAvailability: "Read authorized material availability and reservations.",
  getWeatherConstraints: "Read authorized source-backed weather and logistics constraints.",
  getOpenBlockers: "Read authorized open operational blockers.",
  getDailyPlan: "Read an authorized daily work-plan draft or version.",
  getDailyActuals: "Read authorized approved daily actuals when report-text permission is present.",
  getPhotoEvidence: "Read authorized photo metadata only when signed artifact access is valid.",
  getProgressVerification:
    "Read authorized deterministic progress-verification drafts or versions.",
  getRollingProductivity: "Read authorized deterministic rolling-productivity snapshots.",
  getLatestForecast: "Read the authorized latest deterministic operational forecast.",
  getRecoveryScenarios:
    "Read authorized deterministic recovery proposal drafts; never changes the baseline.",
};

function createToolSet(
  names: readonly Phase8ToolName[],
  gateway: Phase8ToolGateway,
  context: Phase8AuthorizationContext,
) {
  return Object.fromEntries(
    names.map((name) => [
      name,
      tool({
        description: descriptions[name],
        inputSchema: phase8ToolQuerySchema,
        outputSchema: phase8ToolOutputSchema,
        execute: (input) => gateway.execute(name, input, context),
      }),
    ]),
  );
}

export function createPhase8A0AgentTools(
  gateway: Phase8ToolGateway,
  context: Phase8AuthorizationContext,
) {
  return createToolSet(phase8A0ToolNames, gateway, context);
}

export function createPhase8A5AgentTools(
  gateway: Phase8ToolGateway,
  context: Phase8AuthorizationContext,
) {
  return createToolSet(phase8A5ToolNames, gateway, context);
}
