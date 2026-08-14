import { z } from "zod";
import {
  confidenceLevelFromScore,
  contractArtifactReferenceSchema,
  contractConfidenceLevelSchema,
  contractDecimalSchema,
  contractEvidenceSchema,
  contractFieldConfidenceSchema,
  contractIdentifierSchema,
  contractIsoDateSchema,
  contractLanguageSchema,
  contractValidationIssueSchema,
} from "./common.js";

export const dailyReportStatusSchema = z.enum([
  "DRAFT",
  "READY_FOR_REVIEW",
  "NEEDS_CORRECTION",
  "APPROVED",
  "REJECTED",
]);

export const dailyReportWorkStatusSchema = z.enum([
  "PLANNED",
  "IN_PROGRESS",
  "BLOCKED",
  "COMPLETED",
  "CANCELLED",
]);

export const dailyReportProgressModeSchema = z.enum(["CUMULATIVE", "INCREMENTAL", "UNSPECIFIED"]);

export const dailyReportAttendanceTeamTypeSchema = z.enum(["OWN", "SUBCONTRACTOR", "UNKNOWN"]);

export const dailyReportBlockerCategorySchema = z.enum([
  "MATERIAL",
  "WEATHER",
  "LABOR",
  "EQUIPMENT",
  "DESIGN",
  "APPROVAL",
  "ACCESS",
  "SAFETY",
  "SUBCONTRACTOR",
  "QUALITY",
  "OTHER",
  "UNKNOWN",
]);

export const dailyReportMaterialSignalTypeSchema = z.enum([
  "RECEIVED",
  "CONSUMED",
  "REQUESTED",
  "LOW_STOCK",
  "SHORTAGE",
  "DAMAGED",
  "RETURNED",
  "OTHER",
]);

export const dailyReportEquipmentUsageStatusSchema = z.enum([
  "USED",
  "IDLE",
  "DOWN",
  "UNAVAILABLE",
  "UNKNOWN",
]);

export const dailyReportClarificationReasonSchema = z.enum([
  "MISSING_REQUIRED_VALUE",
  "AMBIGUOUS_REFERENCE",
  "LOW_CONFIDENCE",
  "LOGIC_CONFLICT",
  "UNREADABLE_SOURCE",
]);

export const dailyReportPhotoObservationKindSchema = z.enum([
  "WORK_TYPE_CANDIDATE",
  "PROGRESS_CUE",
  "PROGRESS_CONTRADICTION",
  "SAFETY_ADVISORY",
  "DELIVERY_CANDIDATE",
  "UNREADABLE",
]);

export const dailyReportLocationSchema = z
  .object({
    block: z.string().trim().min(1).max(200).nullable(),
    stage: z.string().trim().min(1).max(200).nullable(),
    floor: z.string().trim().min(1).max(100).nullable(),
    zone: z.string().trim().min(1).max(200).nullable(),
  })
  .strict();

export const dailyReportWorkItemReferenceSchema = z
  .object({
    code: z.string().trim().min(1).max(200).nullable(),
    name: z.string().trim().min(1).max(500).nullable(),
    candidateCodes: z.array(z.string().trim().min(1).max(200)).max(10),
  })
  .strict();

export const dailyReportBlockerSchema = z
  .object({
    category: dailyReportBlockerCategorySchema,
    description: z.string().trim().min(1).max(1_000),
    isBlocking: z.boolean(),
    startedOn: contractIsoDateSchema.nullable(),
    responsibleParty: z.string().trim().min(1).max(300).nullable(),
  })
  .strict();

export const dailyReportProgressEntrySchema = z
  .object({
    entryId: contractIdentifierSchema,
    workItem: dailyReportWorkItemReferenceSchema,
    progressMode: dailyReportProgressModeSchema,
    progressPercent: z.number().finite().min(0).max(100).nullable(),
    quantityDone: contractDecimalSchema.nullable(),
    unit: z.string().trim().min(1).max(100).nullable(),
    status: dailyReportWorkStatusSchema.nullable(),
    blocker: dailyReportBlockerSchema.nullable(),
    note: z.string().trim().min(1).max(2_000).nullable(),
    fieldConfidence: z.array(contractFieldConfidenceSchema).max(20),
  })
  .strict()
  .superRefine((entry, context) => {
    if (
      entry.progressPercent === null &&
      entry.quantityDone === null &&
      entry.status === null &&
      entry.blocker === null &&
      entry.note === null
    ) {
      context.addIssue({
        code: "custom",
        message: "A progress entry must contain at least one reported fact",
        path: ["progressPercent"],
      });
    }
  });

export const dailyReportAttendanceEntrySchema = z
  .object({
    entryId: contractIdentifierSchema,
    teamType: dailyReportAttendanceTeamTypeSchema,
    teamRef: z.string().trim().min(1).max(200).nullable(),
    teamName: z.string().trim().min(1).max(500).nullable(),
    workItemCodes: z.array(z.string().trim().min(1).max(200)).max(20),
    headcount: z.number().int().positive().max(10_000),
    hoursPerPerson: z.number().finite().positive().max(24).nullable(),
    totalHours: z.number().finite().positive().max(240_000).nullable(),
    fieldConfidence: z.array(contractFieldConfidenceSchema).max(12),
  })
  .strict();

export const dailyReportMaterialSignalSchema = z
  .object({
    signalId: contractIdentifierSchema,
    signalType: dailyReportMaterialSignalTypeSchema,
    rawName: z.string().trim().min(1).max(500),
    normalizedName: z.string().trim().min(1).max(500).nullable(),
    materialRef: z.string().trim().min(1).max(200).nullable(),
    quantity: contractDecimalSchema.nullable(),
    unit: z.string().trim().min(1).max(100).nullable(),
    supplierName: z.string().trim().min(1).max(500).nullable(),
    workItemCodes: z.array(z.string().trim().min(1).max(200)).max(20),
    note: z.string().trim().min(1).max(1_000).nullable(),
    fieldConfidence: z.array(contractFieldConfidenceSchema).max(12),
  })
  .strict();

export const dailyReportEquipmentUsageEntrySchema = z
  .object({
    entryId: contractIdentifierSchema,
    equipmentRef: z.string().trim().min(1).max(200).nullable(),
    equipmentName: z.string().trim().min(1).max(500).nullable(),
    workItemCodes: z.array(z.string().trim().min(1).max(200)).max(20),
    hoursUsed: z.number().finite().positive().max(24).nullable(),
    usageQuantity: contractDecimalSchema.nullable(),
    unit: z.string().trim().min(1).max(100).nullable(),
    status: dailyReportEquipmentUsageStatusSchema,
    note: z.string().trim().min(1).max(1_000).nullable(),
    fieldConfidence: z.array(contractFieldConfidenceSchema).max(12),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.equipmentRef === null && entry.equipmentName === null) {
      context.addIssue({
        code: "custom",
        message: "Equipment usage requires a reference or name",
        path: ["equipmentName"],
      });
    }
    if (entry.usageQuantity !== null && entry.unit === null) {
      context.addIssue({
        code: "custom",
        message: "Equipment usage quantity requires a unit",
        path: ["unit"],
      });
    }
  });

export const dailyReportPhotoObservationSchema = z
  .object({
    observationId: contractIdentifierSchema,
    photoArtifactId: contractIdentifierSchema,
    kind: dailyReportPhotoObservationKindSchema,
    statement: z.string().trim().min(1).max(1_000),
    reviewQuestion: z.string().trim().min(1).max(1_000).nullable(),
    workItemCandidateCodes: z.array(z.string().trim().min(1).max(200)).max(10),
    confidence: z.number().finite().min(0).max(1),
    evidence: z.array(contractEvidenceSchema).min(1).max(10),
    advisoryOnly: z.literal(true),
  })
  .strict()
  .superRefine((observation, context) => {
    if (
      ["PROGRESS_CONTRADICTION", "SAFETY_ADVISORY", "DELIVERY_CANDIDATE", "UNREADABLE"].includes(
        observation.kind,
      ) &&
      observation.reviewQuestion === null
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Advisory, contradiction, delivery, and unreadable observations require a review question",
        path: ["reviewQuestion"],
      });
    }
  });

export const dailyReportClarificationQuestionSchema = z
  .object({
    questionId: contractIdentifierSchema,
    fieldPath: z.string().trim().min(1).max(300),
    reason: dailyReportClarificationReasonSchema,
    question: z.string().trim().min(1).max(1_000),
    options: z
      .array(
        z
          .object({
            value: z.string().trim().min(1).max(500),
            label: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .max(20),
    requiredForApproval: z.boolean(),
  })
  .strict();

export const dailyReportDuplicateCandidateSchema = z
  .object({
    candidateReportId: contractIdentifierSchema,
    similarity: z.number().finite().min(0).max(1),
    reasons: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  })
  .strict();

export const dailyReportDraftV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    draftType: z.literal("DAILY_REPORT"),
    draftId: contractIdentifierSchema,
    requestId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    sourceArtifacts: z.array(contractArtifactReferenceSchema).max(6),
    rawText: z.string().trim().min(1).max(20_000).nullable(),
    language: contractLanguageSchema,
    reportDate: contractIsoDateSchema.nullable(),
    location: dailyReportLocationSchema,
    progressEntries: z.array(dailyReportProgressEntrySchema).max(50),
    attendanceEntries: z.array(dailyReportAttendanceEntrySchema).max(50),
    materialSignals: z.array(dailyReportMaterialSignalSchema).max(100),
    equipmentEntries: z.array(dailyReportEquipmentUsageEntrySchema).max(50).optional(),
    photoObservations: z.array(dailyReportPhotoObservationSchema).max(100),
    clarificationQuestions: z.array(dailyReportClarificationQuestionSchema).max(100),
    duplicateCandidates: z.array(dailyReportDuplicateCandidateSchema).max(20),
    fieldConfidence: z.array(contractFieldConfidenceSchema).max(500),
    overallConfidence: z.number().finite().min(0).max(1),
    confidenceLevel: contractConfidenceLevelSchema,
    validationIssues: z.array(contractValidationIssueSchema).max(200),
    status: dailyReportStatusSchema,
    requiresHumanReview: z.literal(true),
  })
  .strict()
  .superRefine((draft, context) => {
    if (
      draft.progressEntries.length === 0 &&
      draft.attendanceEntries.length === 0 &&
      draft.materialSignals.length === 0 &&
      (draft.equipmentEntries?.length ?? 0) === 0 &&
      draft.photoObservations.length === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A daily report draft must contain at least one extracted fact",
        path: ["progressEntries"],
      });
    }

    const entryIds = [
      ...draft.progressEntries.map((entry) => entry.entryId),
      ...draft.attendanceEntries.map((entry) => entry.entryId),
      ...draft.materialSignals.map((signal) => signal.signalId),
      ...(draft.equipmentEntries?.map((entry) => entry.entryId) ?? []),
      ...draft.photoObservations.map((observation) => observation.observationId),
      ...draft.clarificationQuestions.map((question) => question.questionId),
    ];

    if (new Set(entryIds).size !== entryIds.length) {
      context.addIssue({
        code: "custom",
        message: "Daily report entry identifiers must be unique",
        path: ["progressEntries"],
      });
    }

    const expectedLevel = confidenceLevelFromScore(draft.overallConfidence);

    if (draft.confidenceLevel !== expectedLevel) {
      context.addIssue({
        code: "custom",
        message: `Confidence level must be ${expectedLevel}`,
        path: ["confidenceLevel"],
      });
    }

    const hasBlockingValidation = draft.validationIssues.some(
      (issue) => issue.severity === "ERROR",
    );
    const hasRequiredQuestion = draft.clarificationQuestions.some(
      (question) => question.requiredForApproval,
    );
    const expectedStatus =
      hasBlockingValidation || hasRequiredQuestion || draft.confidenceLevel === "LOW"
        ? "NEEDS_CORRECTION"
        : "READY_FOR_REVIEW";

    if (
      ["READY_FOR_REVIEW", "NEEDS_CORRECTION"].includes(draft.status) &&
      draft.status !== expectedStatus
    ) {
      context.addIssue({
        code: "custom",
        message: `Draft status must be ${expectedStatus}`,
        path: ["status"],
      });
    }
  });

export const approvedDailyReportCommandV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    commandType: z.literal("APPROVE_DAILY_REPORT"),
    commandId: contractIdentifierSchema,
    idempotencyKey: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    draftId: contractIdentifierSchema,
    reviewedBy: contractIdentifierSchema,
    reviewedAt: z.string().datetime({ offset: true }),
    approvedDraft: dailyReportDraftV1Schema.safeExtend({
      status: z.literal("APPROVED"),
    }),
    humanEditedFieldPaths: z.array(z.string().trim().min(1).max(300)).max(500),
    reviewNote: z.string().trim().min(1).max(2_000).nullable(),
  })
  .strict()
  .superRefine((command, context) => {
    if (
      command.approvedDraft.tenantId !== command.tenantId ||
      command.approvedDraft.projectId !== command.projectId ||
      command.approvedDraft.draftId !== command.draftId
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved draft scope must match the command scope",
        path: ["approvedDraft"],
      });
    }

    if (command.approvedDraft.reportDate === null) {
      context.addIssue({
        code: "custom",
        message: "Approved daily reports require a report date",
        path: ["approvedDraft", "reportDate"],
      });
    }

    if (
      command.approvedDraft.reportDate !== null &&
      command.reviewedAt.slice(0, 10) < command.approvedDraft.reportDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Approval timestamp cannot be before the daily-report date",
        path: ["reviewedAt"],
      });
    }

    if (command.approvedDraft.validationIssues.some((issue) => issue.severity === "ERROR")) {
      context.addIssue({
        code: "custom",
        message: "Approved daily reports cannot contain validation errors",
        path: ["approvedDraft", "validationIssues"],
      });
    }

    if (
      command.approvedDraft.clarificationQuestions.some((question) => question.requiredForApproval)
    ) {
      context.addIssue({
        code: "custom",
        message: "Required clarification questions must be resolved before approval",
        path: ["approvedDraft", "clarificationQuestions"],
      });
    }

    command.approvedDraft.progressEntries.forEach((entry, index) => {
      if (entry.workItem.code === null) {
        context.addIssue({
          code: "custom",
          message: "Approved progress entries require a resolved work-item code",
          path: ["approvedDraft", "progressEntries", index, "workItem", "code"],
        });
      }

      if (entry.quantityDone !== null && entry.unit === null) {
        context.addIssue({
          code: "custom",
          message: "Approved quantity requires an explicit unit",
          path: ["approvedDraft", "progressEntries", index, "unit"],
        });
      }

      if (entry.quantityDone !== null && entry.progressMode === "UNSPECIFIED") {
        context.addIssue({
          code: "custom",
          message: "Approved quantities require cumulative or incremental mode",
          path: ["approvedDraft", "progressEntries", index, "progressMode"],
        });
      }

      if (
        entry.status === "COMPLETED" &&
        entry.progressPercent !== null &&
        entry.progressPercent !== 100
      ) {
        context.addIssue({
          code: "custom",
          message: "Approved completed work must report 100 percent progress",
          path: ["approvedDraft", "progressEntries", index, "progressPercent"],
        });
      }
    });

    command.approvedDraft.attendanceEntries.forEach((entry, index) => {
      if (entry.teamType === "UNKNOWN") {
        context.addIssue({
          code: "custom",
          message: "Approved attendance requires own or subcontractor team type",
          path: ["approvedDraft", "attendanceEntries", index, "teamType"],
        });
      }

      if (entry.teamRef === null && entry.teamName === null) {
        context.addIssue({
          code: "custom",
          message: "Approved attendance requires a team reference or name",
          path: ["approvedDraft", "attendanceEntries", index, "teamName"],
        });
      }

      if (
        entry.hoursPerPerson !== null &&
        entry.totalHours !== null &&
        Math.abs(entry.hoursPerPerson * entry.headcount - entry.totalHours) > 0.01
      ) {
        context.addIssue({
          code: "custom",
          message: "Approved attendance hours conflict with headcount",
          path: ["approvedDraft", "attendanceEntries", index, "totalHours"],
        });
      }
    });

    command.approvedDraft.materialSignals.forEach((signal, index) => {
      if (signal.quantity !== null && signal.unit === null) {
        context.addIssue({
          code: "custom",
          message: "Approved material quantity requires an explicit unit",
          path: ["approvedDraft", "materialSignals", index, "unit"],
        });
      }

      if (signal.quantity !== null && signal.materialRef === null) {
        context.addIssue({
          code: "custom",
          message: "Approved material quantity requires a resolved material reference",
          path: ["approvedDraft", "materialSignals", index, "materialRef"],
        });
      }
    });

    command.approvedDraft.equipmentEntries?.forEach((entry, index) => {
      if (entry.equipmentRef === null && entry.equipmentName === null) {
        context.addIssue({
          code: "custom",
          message: "Approved equipment usage requires a reference or name",
          path: ["approvedDraft", "equipmentEntries", index, "equipmentName"],
        });
      }
      if (entry.usageQuantity !== null && entry.unit === null) {
        context.addIssue({
          code: "custom",
          message: "Approved equipment usage quantity requires an explicit unit",
          path: ["approvedDraft", "equipmentEntries", index, "unit"],
        });
      }
    });
  });

export type DailyReportDraftV1 = z.infer<typeof dailyReportDraftV1Schema>;
export type DailyReportProgressEntry = z.infer<typeof dailyReportProgressEntrySchema>;
export type DailyReportAttendanceEntry = z.infer<typeof dailyReportAttendanceEntrySchema>;
export type DailyReportMaterialSignal = z.infer<typeof dailyReportMaterialSignalSchema>;
export type DailyReportEquipmentUsageEntry = z.infer<typeof dailyReportEquipmentUsageEntrySchema>;
export type DailyReportClarificationQuestion = z.infer<
  typeof dailyReportClarificationQuestionSchema
>;
export type ApprovedDailyReportCommandV1 = z.infer<typeof approvedDailyReportCommandV1Schema>;
