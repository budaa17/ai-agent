import { z } from "zod";
import {
  projectUpdateConfidenceSchema,
  projectUpdateExtractionSchema,
  projectUpdateFieldConfidenceSchema,
  type ProjectUpdateExtraction,
  type ProjectUpdateFieldConfidence,
} from "./schema.js";
import { projectUpdateValidationSchema, type ProjectUpdateValidation } from "./validation.js";

export const projectUpdateReviewRecommendationSchema = z.enum([
  "READY_FOR_REVIEW",
  "NEEDS_CORRECTION",
]);

export const projectUpdateDraftSchema = z
  .object({
    schemaVersion: z.literal(1),
    update: projectUpdateExtractionSchema,
    confidence: projectUpdateConfidenceSchema,
    validation: projectUpdateValidationSchema,
    reviewRecommendation: projectUpdateReviewRecommendationSchema,
    requiresHumanReview: z.literal(true),
  })
  .strict();

export type ProjectUpdateDraft = z.infer<typeof projectUpdateDraftSchema>;

function roundConfidence(value: number) {
  return Math.round(Math.max(0, Math.min(1, value)) * 10_000) / 10_000;
}

function confidenceLevel(value: number) {
  if (value >= 0.85) {
    return "HIGH" as const;
  }

  if (value >= 0.65) {
    return "MEDIUM" as const;
  }

  return "LOW" as const;
}

function fieldHasValue(update: ProjectUpdateExtraction, confidence: ProjectUpdateFieldConfidence) {
  const value = update[confidence.field];
  return Array.isArray(value) ? value.length > 0 : value !== null;
}

export function buildProjectUpdateDraft(input: {
  update: ProjectUpdateExtraction;
  fieldConfidence: ProjectUpdateFieldConfidence[];
  validation: ProjectUpdateValidation;
}): ProjectUpdateDraft {
  const update = projectUpdateExtractionSchema.parse(input.update);
  const validation = projectUpdateValidationSchema.parse(input.validation);
  const fields = input.fieldConfidence
    .map((confidence) => projectUpdateFieldConfidenceSchema.parse(confidence))
    .filter((confidence) => fieldHasValue(update, confidence))
    .sort((left, right) => left.field.localeCompare(right.field));
  const baseConfidence =
    fields.length === 0
      ? 0
      : fields.reduce((total, field) => total + field.score, 0) / fields.length;
  const penalty = validation.errorCount * 0.2 + validation.warningCount * 0.05;
  const adjusted = roundConfidence(
    validation.valid ? baseConfidence - penalty : Math.min(0.49, baseConfidence - penalty),
  );
  const level = confidenceLevel(adjusted);

  return projectUpdateDraftSchema.parse({
    schemaVersion: 1,
    update,
    confidence: {
      overall: adjusted,
      level,
      fields,
    },
    validation,
    reviewRecommendation:
      validation.valid && level !== "LOW" ? "READY_FOR_REVIEW" : "NEEDS_CORRECTION",
    requiresHumanReview: true,
  });
}
