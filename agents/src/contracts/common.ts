import { z } from "zod";

export const contractIdentifierSchema = z.string().trim().min(1).max(200);

export const contractLongIdentifierSchema = z.string().trim().min(1).max(500);

export const contractIsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD");

export const contractIsoDateTimeSchema = z.string().datetime({ offset: true });

export const contractDecimalSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/, "Decimal must use a plain base-10 string");

export const contractMoneySchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)\.\d{2}$/, "Money must use a two-decimal string");

export const contractPercentageSchema = z.number().finite().min(0).max(100);

export const contractLanguageSchema = z.enum(["mn", "en", "mixed"]);

export const contractConfidenceLevelSchema = z.enum(["HIGH", "MEDIUM", "LOW"]);

export const contractEvidenceSourceTypeSchema = z.enum(["TEXT", "IMAGE", "SYSTEM", "HUMAN"]);

export const contractImageRegionSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
    description: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((region, context) => {
    if (region.x + region.width > 1) {
      context.addIssue({
        code: "custom",
        message: "Image region exceeds the horizontal boundary",
        path: ["width"],
      });
    }

    if (region.y + region.height > 1) {
      context.addIssue({
        code: "custom",
        message: "Image region exceeds the vertical boundary",
        path: ["height"],
      });
    }
  });

export const contractEvidenceSchema = z
  .object({
    sourceType: contractEvidenceSourceTypeSchema,
    sourceId: contractIdentifierSchema,
    fieldPath: z.string().trim().min(1).max(300).nullable(),
    quote: z.string().trim().min(1).max(1_000).nullable(),
    imageRegion: contractImageRegionSchema.nullable(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.sourceType === "TEXT" && evidence.quote === null) {
      context.addIssue({
        code: "custom",
        message: "Text evidence requires a quote",
        path: ["quote"],
      });
    }

    if (evidence.sourceType === "IMAGE" && evidence.imageRegion === null) {
      context.addIssue({
        code: "custom",
        message: "Image evidence requires a visible region",
        path: ["imageRegion"],
      });
    }
  });

export const contractFieldConfidenceSchema = z
  .object({
    fieldPath: z.string().trim().min(1).max(300),
    score: z.number().finite().min(0).max(1),
    level: contractConfidenceLevelSchema,
    evidence: z.array(contractEvidenceSchema).max(10),
  })
  .strict();

export const contractValidationSeveritySchema = z.enum(["ERROR", "WARNING", "INFO"]);

export const contractValidationIssueSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    severity: contractValidationSeveritySchema,
    fieldPaths: z.array(z.string().trim().min(1).max(300)).min(1).max(20),
    message: z.string().trim().min(1).max(1_000),
    deterministic: z.boolean(),
  })
  .strict();

export const contractArtifactReferenceSchema = z
  .object({
    artifactId: contractIdentifierSchema,
    kind: z.enum([
      "SOURCE_TEXT",
      "SOURCE_IMAGE",
      "REPORT_HTML",
      "REPORT_PDF",
      "REPORT_MARKDOWN",
      "AGENT_JSON",
    ]),
    mediaType: z.string().trim().min(1).max(200),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    storageKey: z.string().trim().min(1).max(1_000),
    sizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export function confidenceLevelFromScore(
  score: number,
): z.infer<typeof contractConfidenceLevelSchema> {
  if (score >= 0.85) {
    return "HIGH";
  }

  if (score >= 0.65) {
    return "MEDIUM";
  }

  return "LOW";
}

export type ContractEvidence = z.infer<typeof contractEvidenceSchema>;
export type ContractFieldConfidence = z.infer<typeof contractFieldConfidenceSchema>;
export type ContractValidationIssue = z.infer<typeof contractValidationIssueSchema>;
export type ContractArtifactReference = z.infer<typeof contractArtifactReferenceSchema>;
