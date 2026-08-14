import { z } from "zod";
import {
  contractDecimalSchema,
  contractImageRegionSchema,
  contractIsoDateSchema,
  contractLanguageSchema,
} from "../contracts/common.js";
import {
  dailyReportAttendanceTeamTypeSchema,
  dailyReportBlockerCategorySchema,
  dailyReportEquipmentUsageStatusSchema,
  dailyReportMaterialSignalTypeSchema,
  dailyReportPhotoObservationKindSchema,
  dailyReportProgressModeSchema,
  dailyReportWorkStatusSchema,
} from "../contracts/daily-report.js";

export const dailyReportModelConfidenceSchema = z
  .object({
    fieldPath: z.string().trim().min(1).max(300),
    score: z.number().finite().min(0).max(1),
    evidenceQuote: z.string().trim().min(1).max(1_000).nullable(),
    sourceImageIndex: z.number().int().min(0).max(4).nullable(),
    imageRegion: contractImageRegionSchema.nullable(),
  })
  .strict()
  .superRefine((confidence, context) => {
    const hasImageIndex = confidence.sourceImageIndex !== null;
    const hasImageRegion = confidence.imageRegion !== null;

    if (hasImageIndex !== hasImageRegion) {
      context.addIssue({
        code: "custom",
        message: "Image confidence requires both sourceImageIndex and imageRegion",
        path: ["imageRegion"],
      });
    }
  });

export const dailyReportModelProgressEntrySchema = z
  .object({
    workItemCode: z.string().trim().min(1).max(200).nullable(),
    workItemName: z.string().trim().min(1).max(500).nullable(),
    candidateCodes: z.array(z.string().trim().min(1).max(200)).max(10),
    progressMode: dailyReportProgressModeSchema,
    progressPercent: z.number().finite().min(0).max(100).nullable(),
    quantityDone: contractDecimalSchema.nullable(),
    unit: z.string().trim().min(1).max(100).nullable(),
    status: dailyReportWorkStatusSchema.nullable(),
    blocker: z
      .object({
        category: dailyReportBlockerCategorySchema,
        description: z.string().trim().min(1).max(1_000),
        isBlocking: z.boolean(),
        startedOn: contractIsoDateSchema.nullable(),
        responsibleParty: z.string().trim().min(1).max(300).nullable(),
      })
      .strict()
      .nullable(),
    note: z.string().trim().min(1).max(2_000).nullable(),
    confidence: z.array(dailyReportModelConfidenceSchema).max(20),
  })
  .strict();

export const dailyReportModelAttendanceEntrySchema = z
  .object({
    teamType: dailyReportAttendanceTeamTypeSchema,
    teamRef: z.string().trim().min(1).max(200).nullable(),
    teamName: z.string().trim().min(1).max(500).nullable(),
    workItemCodes: z.array(z.string().trim().min(1).max(200)).max(20),
    headcount: z.number().int().positive().max(10_000),
    hoursPerPerson: z.number().finite().positive().max(24).nullable(),
    totalHours: z.number().finite().positive().max(240_000).nullable(),
    confidence: z.array(dailyReportModelConfidenceSchema).max(12),
  })
  .strict();

export const dailyReportModelMaterialSignalSchema = z
  .object({
    signalType: dailyReportMaterialSignalTypeSchema,
    rawName: z.string().trim().min(1).max(500),
    normalizedName: z.string().trim().min(1).max(500).nullable(),
    materialRef: z.string().trim().min(1).max(200).nullable(),
    quantity: contractDecimalSchema.nullable(),
    unit: z.string().trim().min(1).max(100).nullable(),
    supplierName: z.string().trim().min(1).max(500).nullable(),
    workItemCodes: z.array(z.string().trim().min(1).max(200)).max(20),
    note: z.string().trim().min(1).max(1_000).nullable(),
    confidence: z.array(dailyReportModelConfidenceSchema).max(12),
  })
  .strict();

export const dailyReportModelEquipmentUsageEntrySchema = z
  .object({
    equipmentRef: z.string().trim().min(1).max(200).nullable(),
    equipmentName: z.string().trim().min(1).max(500).nullable(),
    workItemCodes: z.array(z.string().trim().min(1).max(200)).max(20),
    hoursUsed: z.number().finite().positive().max(24).nullable(),
    usageQuantity: contractDecimalSchema.nullable(),
    unit: z.string().trim().min(1).max(100).nullable(),
    status: dailyReportEquipmentUsageStatusSchema,
    note: z.string().trim().min(1).max(1_000).nullable(),
    confidence: z.array(dailyReportModelConfidenceSchema).max(12),
  })
  .strict();

export const dailyReportModelPhotoObservationSchema = z
  .object({
    sourceImageIndex: z.number().int().min(0).max(4),
    kind: dailyReportPhotoObservationKindSchema,
    statement: z.string().trim().min(1).max(1_000),
    reviewQuestion: z.string().trim().min(1).max(1_000).nullable(),
    workItemCandidateCodes: z.array(z.string().trim().min(1).max(200)).max(10),
    confidence: z.number().finite().min(0).max(1),
    imageRegion: contractImageRegionSchema,
  })
  .strict();

export const dailyReportModelOutputSchema = z
  .object({
    schemaVersion: z.literal(1),
    language: contractLanguageSchema,
    reportDate: contractIsoDateSchema.nullable(),
    location: z
      .object({
        block: z.string().trim().min(1).max(200).nullable(),
        stage: z.string().trim().min(1).max(200).nullable(),
        floor: z.string().trim().min(1).max(100).nullable(),
        zone: z.string().trim().min(1).max(200).nullable(),
      })
      .strict(),
    progressEntries: z.array(dailyReportModelProgressEntrySchema).max(50),
    attendanceEntries: z.array(dailyReportModelAttendanceEntrySchema).max(50),
    materialSignals: z.array(dailyReportModelMaterialSignalSchema).max(100),
    equipmentEntries: z.array(dailyReportModelEquipmentUsageEntrySchema).max(50).optional(),
    photoObservations: z.array(dailyReportModelPhotoObservationSchema).max(100),
    topLevelConfidence: z.array(dailyReportModelConfidenceSchema).max(20),
  })
  .strict();

export type DailyReportModelConfidence = z.infer<typeof dailyReportModelConfidenceSchema>;
export type DailyReportModelOutput = z.infer<typeof dailyReportModelOutputSchema>;
