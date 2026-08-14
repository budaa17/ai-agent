import { z } from "zod";
import { contractIdentifierSchema, contractIsoDateSchema } from "./common.js";

export const sampleWorkbookClassificationSchema = z.enum([
  "SYNTHETIC_ANONYMIZED",
  "ANONYMIZED_REAL",
]);

export const sampleWorkbookMappingStatusSchema = z.enum([
  "REFERENCE_ONLY",
  "PARTIAL_CONTRACT_MAPPING",
  "DERIVED_ONLY",
]);

export const sampleWorkbookSheetManifestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    headerRow: z.number().int().positive(),
    recordCount: z.number().int().nonnegative(),
    mappingStatus: sampleWorkbookMappingStatusSchema,
    mappingTargets: z.array(z.string().trim().min(1).max(100)).max(20),
    requiredColumns: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
    mappingNote: z.string().trim().min(1).max(2_000),
  })
  .strict();

export const sampleWorkbookManifestV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    sampleId: contractIdentifierSchema,
    classification: sampleWorkbookClassificationSchema,
    source: z
      .object({
        providedBy: z.literal("USER"),
        receivedOn: contractIsoDateSchema,
        workbookClaim: z.enum(["SELF_DESCRIBED_SYNTHETIC", "SELF_DESCRIBED_ANONYMIZED_REAL"]),
        independentlyVerifiedRealOrigin: z.boolean(),
      })
      .strict(),
    file: z
      .object({
        originalName: z.string().trim().min(1).max(500),
        storedName: z.string().trim().min(1).max(500),
        mediaType: z.literal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        sizeBytes: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    usage: z
      .object({
        contractMappingAllowed: z.boolean(),
        parserFixtureAllowed: z.boolean(),
        agentContextAllowed: z.boolean(),
        goldenAnswerAllowed: z.boolean(),
        satisfiesAnonymizedRealSampleRequirement: z.boolean(),
      })
      .strict(),
    safety: z
      .object({
        auditedOn: contractIsoDateSchema,
        zipMagicValid: z.boolean(),
        encrypted: z.boolean(),
        macroEntryCount: z.number().int().nonnegative(),
        externalLinkEntryCount: z.number().int().nonnegative(),
        embeddedObjectEntryCount: z.number().int().nonnegative(),
        externalFormulaCount: z.number().int().nonnegative(),
        directIdentifierFindingCount: z.number().int().nonnegative(),
        reviewedNumericFalsePositiveCount: z.number().int().nonnegative(),
      })
      .strict(),
    integrity: z
      .object({
        sheetCount: z.number().int().positive(),
        workItemCount: z.number().int().nonnegative(),
        dependencyEdgeCount: z.number().int().nonnegative(),
        duplicateWorkItemCodeCount: z.number().int().nonnegative(),
        missingWorkItemReferenceCount: z.number().int().nonnegative(),
        missingDependencyCount: z.number().int().nonnegative(),
        dependencyCycleNodeCount: z.number().int().nonnegative(),
      })
      .strict(),
    sheets: z.array(sampleWorkbookSheetManifestSchema).min(1).max(100),
    limitations: z.array(z.string().trim().min(1).max(2_000)).min(1).max(100),
  })
  .strict()
  .superRefine((manifest, context) => {
    const sheetNames = manifest.sheets.map((sheet) => sheet.name);

    if (new Set(sheetNames).size !== sheetNames.length) {
      context.addIssue({
        code: "custom",
        message: "Workbook sheet names must be unique",
        path: ["sheets"],
      });
    }

    if (manifest.integrity.sheetCount !== manifest.sheets.length) {
      context.addIssue({
        code: "custom",
        message: "Integrity sheet count must match the manifest",
        path: ["integrity", "sheetCount"],
      });
    }

    if (
      manifest.classification === "SYNTHETIC_ANONYMIZED" &&
      manifest.usage.satisfiesAnonymizedRealSampleRequirement
    ) {
      context.addIssue({
        code: "custom",
        message: "A synthetic workbook cannot satisfy the anonymized real sample requirement",
        path: ["usage", "satisfiesAnonymizedRealSampleRequirement"],
      });
    }
  });

export type SampleWorkbookManifestV1 = z.infer<typeof sampleWorkbookManifestV1Schema>;
