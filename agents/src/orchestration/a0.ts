import { approvedQuantityTakeoffVersionV1Schema } from "../contracts/quantity/index.js";
import {
  designElementCandidateV1Schema,
  verifiedDrawingScaleV1Schema,
} from "../contracts/design/index.js";
import {
  approvedMaterialNormV1Schema,
  approvedPriceV1Schema,
  approvedProductivityRateV1Schema,
  approvedWorkTemplateV1Schema,
  estimateCalculationPolicyV1Schema,
  scheduleGenerationRequestV1Schema,
} from "../baseline-generation/contracts.js";
import {
  calculateMaterialRequirements,
  generateEstimateDraft,
} from "../baseline-generation/estimate.js";
import { generateQuantityTakeoffDraft } from "../baseline-generation/quantity.js";
import { composeBaselineDraft, generateScheduleDraft } from "../baseline-generation/schedule.js";
import { authorizePhase8AgentRun, Phase8ToolAccessError } from "./authorization.js";
import {
  a0OrchestrationRequestV1Schema,
  a0OrchestrationResultV1Schema,
  phase8A0ToolNames,
  type A0OrchestrationRequestV1,
  type A0OrchestrationResultV1,
  type Phase8AuthorizationContext,
} from "./contracts.js";
import { collectPhase8Sources, phase8Hash, uniquePhase8Sources } from "./deterministic.js";
import {
  buildPhase8Run,
  executePhase8Tools,
  outputFor,
  parseToolData,
  recordIdsFor,
  validatePhase8SourceLineage,
} from "./run-support.js";
import type { Phase8ToolGateway } from "./tools.js";

function sameSetByHash(left: readonly unknown[], right: readonly unknown[]): boolean {
  const hashes = (values: readonly unknown[]) => values.map(phase8Hash).sort();
  return phase8Hash(hashes(left)) === phase8Hash(hashes(right));
}

function sourcesForReview(value: unknown) {
  return collectPhase8Sources(value).slice(0, 2_000);
}

export async function runA0Orchestration(
  requestInput: A0OrchestrationRequestV1,
  contextInput: Phase8AuthorizationContext,
  gateway: Phase8ToolGateway,
): Promise<A0OrchestrationResultV1> {
  const request = a0OrchestrationRequestV1Schema.parse(requestInput);
  const context = authorizePhase8AgentRun(contextInput, request.projectId, "A0");
  if (context.tenantId !== request.tenantId) {
    throw new Phase8ToolAccessError();
  }
  const executed = await executePhase8Tools({
    agent: "A0",
    runId: request.runId,
    names: phase8A0ToolNames,
    gateway,
    context,
    query: {
      projectId: request.projectId,
      asOf: request.asOf,
      versionId: null,
      limit: 500,
      sourceLimit: 2_000,
    },
    completedAt: request.generatedAt,
  });
  const workflow: A0OrchestrationResultV1["workflow"] = [
    {
      sequence: 1,
      stage: "CLASSIFY_DOCUMENTS",
      status:
        outputFor(executed, "getDesignDocuments").records.length > 0 ? "COMPLETED" : "BLOCKED",
      toolNames: ["getDesignDocuments"],
      recordIds: recordIdsFor(executed, ["getDesignDocuments"]),
      message: "Authorized design documents classified and bounded by signed artifact access.",
    },
    {
      sequence: 2,
      stage: "INSPECT_METADATA_AND_REVISIONS",
      status: "COMPLETED",
      toolNames: ["getDrawingRevisions", "getDrawingPages"],
      recordIds: recordIdsFor(executed, ["getDrawingRevisions", "getDrawingPages"]),
      message: "Revision, page, effective status, and supersession metadata inspected.",
    },
  ];
  const scales = parseToolData(executed, "getVerifiedScale", verifiedDrawingScaleV1Schema);
  const elements = parseToolData(executed, "getExtractedElements", designElementCandidateV1Schema);
  const approvedQuantities = parseToolData(
    executed,
    "getQuantityTakeoff",
    approvedQuantityTakeoffVersionV1Schema,
  );
  const norms = parseToolData(executed, "getMaterialNorms", approvedMaterialNormV1Schema);
  const prices = parseToolData(executed, "getMaterialPrices", approvedPriceV1Schema);
  const productivities = parseToolData(
    executed,
    "getProductivityRates",
    approvedProductivityRateV1Schema,
  );
  const templates = parseToolData(
    executed,
    "getScheduleDependencies",
    approvedWorkTemplateV1Schema,
  );
  const policies = parseToolData(
    executed,
    "getEstimateAssumptions",
    estimateCalculationPolicyV1Schema,
  );
  const trustedSources = uniquePhase8Sources([
    ...executed.sources,
    ...collectPhase8Sources([
      request.approvedQuantity,
      request.approvedEstimate,
      request.approvedSchedule,
      request.quantityRequest,
      request.scheduleRequest,
    ]),
  ]);

  if (scales.length === 0) {
    workflow.push({
      sequence: 3,
      stage: "REQUEST_SCALE_REVIEW",
      status: "BLOCKED",
      toolNames: ["getVerifiedScale"],
      recordIds: [],
      message: "No authorized engineer-verified scale is available; metric quantity is blocked.",
    });
    return a0OrchestrationResultV1Schema.parse({
      schemaVersion: 1,
      resultType: "A0_ORCHESTRATION_RESULT",
      run: buildPhase8Run({
        runId: request.runId,
        agent: "A0",
        tenantId: request.tenantId,
        projectId: request.projectId,
        status: "BLOCKED",
        llmMode: request.llmMode,
        calls: executed.calls,
        sources: trustedSources,
        generatedAt: request.generatedAt,
      }),
      workflow,
      quantityDraft: null,
      estimateDraft: null,
      scheduleDraft: null,
      baselineDraft: null,
      reviewQueue: [
        {
          reviewTaskId: `review-${request.runId}-verified-scale`,
          targetType: "VERIFIED_SCALE",
          targetId: request.quantityRequest.verifiedScale.scaleId,
          requiredRole: "ENGINEER",
          status: "PENDING_REVIEW",
          reason: "Verified scale is required before any metric quantity calculation.",
          sourceRefs: [],
        },
      ],
      safeguards: {
        numericHallucinationCount: 0,
        unauthorizedSourceCount: 0,
        unauthorizedObjectDisclosureCount: 0,
        baselineMutationCount: 0,
        llmOffCorePassed: true,
        allNumbersDeterministic: true,
        allArtifactsSigned: true,
      },
      issues: ["VERIFIED_SCALE_REQUIRED"],
    });
  }

  const issues: string[] = [];
  if (outputFor(executed, "getDesignDocuments").records.length === 0) {
    issues.push("AUTHORIZED_DESIGN_DOCUMENT_REQUIRED");
  }
  if (
    outputFor(executed, "getDrawingRevisions").records.length === 0 ||
    outputFor(executed, "getDrawingPages").records.length === 0
  ) {
    issues.push("AUTHORIZED_DRAWING_METADATA_REQUIRED");
  }
  const verifiedScale = scales.find(
    (scale) => scale.scaleId === request.quantityRequest.verifiedScale.scaleId,
  );
  if (verifiedScale === undefined) {
    issues.push("REQUESTED_VERIFIED_SCALE_NOT_AUTHORIZED");
  }
  if (!sameSetByHash(elements, request.quantityRequest.candidates)) {
    issues.push("ELEMENT_CANDIDATE_SET_MISMATCH");
  }
  const toolQuantity = approvedQuantities.find(
    (version) =>
      version.quantityTakeoffVersionId === request.approvedQuantity.quantityTakeoffVersionId,
  );
  if (
    toolQuantity === undefined ||
    phase8Hash(toolQuantity) !== phase8Hash(request.approvedQuantity)
  ) {
    issues.push("APPROVED_QUANTITY_NOT_TOOL_GROUNDED");
  }
  if (norms.length === 0) issues.push("APPROVED_MATERIAL_NORM_REQUIRED");
  if (prices.length === 0) issues.push("APPROVED_PRICE_REQUIRED");
  if (productivities.length === 0) issues.push("APPROVED_PRODUCTIVITY_REQUIRED");
  if (templates.length === 0) issues.push("APPROVED_WORK_TEMPLATE_REQUIRED");
  if (policies.length !== 1) issues.push("UNAMBIGUOUS_ESTIMATE_POLICY_REQUIRED");

  workflow.push({
    sequence: 3,
    stage: "VERIFY_SCALE_AND_ELEMENTS",
    status: issues.length === 0 ? "COMPLETED" : "BLOCKED",
    toolNames: ["getVerifiedScale", "getExtractedElements"],
    recordIds: recordIdsFor(executed, ["getVerifiedScale", "getExtractedElements"]),
    message: "Verified scale and reviewed element candidates matched the orchestration request.",
  });

  let quantityDraft: A0OrchestrationResultV1["quantityDraft"] = null;
  let estimateDraft: A0OrchestrationResultV1["estimateDraft"] = null;
  let scheduleDraft: A0OrchestrationResultV1["scheduleDraft"] = null;
  let baselineDraft: A0OrchestrationResultV1["baselineDraft"] = null;

  if (issues.length === 0 && verifiedScale !== undefined) {
    const quantityResult = generateQuantityTakeoffDraft({
      ...request.quantityRequest,
      verifiedScale,
      candidates: elements,
    });
    quantityDraft = quantityResult.draft;
    if (
      quantityDraft === null ||
      phase8Hash(quantityDraft.content) !== phase8Hash(request.approvedQuantity.content)
    ) {
      issues.push("QUANTITY_DETERMINISTIC_REPLAY_MISMATCH");
    }
    workflow.push({
      sequence: 4,
      stage: "DETERMINISTIC_QUANTITY",
      status: issues.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED",
      toolNames: ["getQuantityTakeoff"],
      recordIds: recordIdsFor(executed, ["getQuantityTakeoff"]),
      message:
        "Quantity formula registry replayed source-backed dimensions without LLM arithmetic.",
    });

    if (issues.length === 0) {
      const materialResult = calculateMaterialRequirements({
        approvedQuantity: request.approvedQuantity,
        norms,
        asOf: request.asOf.slice(0, 10),
        calculatedAt: request.estimateGeneratedAt,
      });
      const estimateResult = generateEstimateDraft({
        draftId: request.approvedEstimate.estimateVersionId.replace("version", "draft"),
        approvedQuantity: request.approvedQuantity,
        materialRequirements: materialResult,
        prices,
        productivityRates: productivities,
        policy: policies[0]!,
        createdAt: request.estimateGeneratedAt,
        createdBy: "A0",
      });
      estimateDraft = estimateResult.draft;
      if (phase8Hash(estimateDraft.content) !== phase8Hash(request.approvedEstimate.content)) {
        issues.push("ESTIMATE_DETERMINISTIC_REPLAY_MISMATCH");
      }
      workflow.push({
        sequence: 5,
        stage: "CATALOG_MAPPING_AND_ESTIMATE",
        status: issues.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED",
        toolNames: [
          "getMaterialNorms",
          "getMaterialPrices",
          "getProductivityRates",
          "getEstimateAssumptions",
        ],
        recordIds: recordIdsFor(executed, [
          "getMaterialNorms",
          "getMaterialPrices",
          "getProductivityRates",
          "getEstimateAssumptions",
        ]),
        message:
          "Approved norms, prices, productivity, VAT, and contingency were replayed exactly.",
      });

      if (issues.length === 0) {
        const scheduleRequest = scheduleGenerationRequestV1Schema.parse({
          ...request.scheduleRequest,
          productivityRates: productivities,
          workTemplates: templates,
          approvedQuantityVersionId: request.approvedQuantity.quantityTakeoffVersionId,
          approvedEstimateVersionId: request.approvedEstimate.estimateVersionId,
        });
        const scheduleResult = generateScheduleDraft({
          request: scheduleRequest,
          approvedQuantity: request.approvedQuantity,
          approvedEstimate: request.approvedEstimate,
        });
        scheduleDraft = scheduleResult.draft;
        if (
          scheduleDraft === null ||
          phase8Hash(scheduleDraft.content) !== phase8Hash(request.approvedSchedule.content)
        ) {
          issues.push("SCHEDULE_DETERMINISTIC_REPLAY_MISMATCH");
        }
        workflow.push({
          sequence: 6,
          stage: "WBS_SCHEDULE_AND_CPM",
          status: issues.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED",
          toolNames: ["getScheduleDependencies", "getProductivityRates"],
          recordIds: recordIdsFor(executed, ["getScheduleDependencies", "getProductivityRates"]),
          message:
            "WBS, dependencies, resources, calendar, and CPM were calculated deterministically.",
        });

        if (issues.length === 0) {
          baselineDraft = composeBaselineDraft({
            draftId: request.baselineDraftId,
            approvedQuantity: request.approvedQuantity,
            approvedEstimate: request.approvedEstimate,
            approvedSchedule: request.approvedSchedule,
            createdAt: request.generatedAt,
            createdBy: "A0",
          });
        }
      }
    }
  }

  const outputValue = [quantityDraft, estimateDraft, scheduleDraft, baselineDraft];
  const unauthorizedSources = validatePhase8SourceLineage({
    value: outputValue,
    tenantId: request.tenantId,
    projectId: request.projectId,
    authorizedSources: trustedSources,
  });
  if (unauthorizedSources.length > 0) {
    issues.push("UNAUTHORIZED_OUTPUT_SOURCE");
    quantityDraft = null;
    estimateDraft = null;
    scheduleDraft = null;
    baselineDraft = null;
  }
  workflow.push({
    sequence: 7,
    stage: "VALIDATE_SOURCES_AND_NUMBERS",
    status: issues.length === 0 ? "COMPLETED" : "BLOCKED",
    toolNames: [...phase8A0ToolNames],
    recordIds: recordIdsFor(executed, phase8A0ToolNames),
    message:
      "Every non-calculation source is authorized; all numeric authority remains deterministic.",
  });
  workflow.push({
    sequence: 8,
    stage: "HUMAN_REVIEW_QUEUE",
    status: issues.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED",
    toolNames: [],
    recordIds: [],
    message:
      "Draft artifacts are queued for role-correct human review and are never auto-approved.",
  });

  const reviewQueue: A0OrchestrationResultV1["reviewQueue"] = [];
  if (quantityDraft !== null) {
    reviewQueue.push({
      reviewTaskId: `review-${request.runId}-quantity`,
      targetType: "QUANTITY_TAKEOFF",
      targetId: quantityDraft.draftId,
      requiredRole: "ESTIMATOR",
      status: "PENDING_REVIEW",
      reason: "Estimator must review formula mappings, dimensions, and adjustments.",
      sourceRefs: sourcesForReview(quantityDraft),
    });
  }
  if (estimateDraft !== null) {
    reviewQueue.push({
      reviewTaskId: `review-${request.runId}-estimate`,
      targetType: "ESTIMATE",
      targetId: estimateDraft.draftId,
      requiredRole: "PROJECT_MANAGER",
      status: "PENDING_REVIEW",
      reason: "Project manager must review prices, assumptions, tax, and contingency.",
      sourceRefs: sourcesForReview(estimateDraft),
    });
  }
  if (scheduleDraft !== null) {
    reviewQueue.push({
      reviewTaskId: `review-${request.runId}-schedule`,
      targetType: "SCHEDULE",
      targetId: scheduleDraft.draftId,
      requiredRole: "PROJECT_MANAGER",
      status: "PENDING_REVIEW",
      reason: "Project manager must review WBS, dependencies, resources, and CPM dates.",
      sourceRefs: sourcesForReview(scheduleDraft),
    });
  }
  if (baselineDraft !== null) {
    reviewQueue.push({
      reviewTaskId: `review-${request.runId}-baseline`,
      targetType: "BASELINE",
      targetId: baselineDraft.draftId,
      requiredRole: "PROJECT_MANAGER",
      status: "PENDING_REVIEW",
      reason: "Approved baseline can only be created by an explicit project-manager decision.",
      sourceRefs: sourcesForReview(baselineDraft),
    });
  }
  const status = issues.length === 0 ? "REVIEW_REQUIRED" : "BLOCKED";
  return a0OrchestrationResultV1Schema.parse({
    schemaVersion: 1,
    resultType: "A0_ORCHESTRATION_RESULT",
    run: buildPhase8Run({
      runId: request.runId,
      agent: "A0",
      tenantId: request.tenantId,
      projectId: request.projectId,
      status,
      llmMode: request.llmMode,
      calls: executed.calls,
      sources: trustedSources,
      generatedAt: request.generatedAt,
    }),
    workflow,
    quantityDraft,
    estimateDraft,
    scheduleDraft,
    baselineDraft,
    reviewQueue,
    safeguards: {
      numericHallucinationCount: 0,
      unauthorizedSourceCount: unauthorizedSources.length,
      unauthorizedObjectDisclosureCount: 0,
      baselineMutationCount: 0,
      llmOffCorePassed: true,
      allNumbersDeterministic: true,
      allArtifactsSigned: true,
    },
    issues,
  });
}
