import { z } from "zod";
import {
  a1ImageDifficultySchema,
  a1ImageSceneFamilySchema,
  imageObservationKindSchema,
} from "./evaluation.js";

export const a1ImageAnnotationCaseV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    caseId: z.string().regex(/^a1-image-[a-z0-9-]+$/),
    sourceFileName: z.string().trim().min(1).max(500),
    sourceText: z.string().trim().min(1).max(20_000).nullable(),
    artifactPath: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine(
        (value) =>
          !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) && !value.split(/[\\/]/u).includes(".."),
        "Image annotation artifactPath must be relative and traversal-safe",
      ),
    artifactSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sceneFamily: a1ImageSceneFamilySchema.nullable(),
    difficulty: a1ImageDifficultySchema.nullable(),
    expectedKinds: z.array(imageObservationKindSchema).max(6),
    requireVisibleRegionEvidence: z.boolean().nullable(),
    humanReviewed: z.boolean(),
    notes: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict();

export const a1ImageAnnotationWorkspaceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.string().trim().min(1).max(200),
    reviewedBy: z.string().trim().min(1).max(200),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
    anonymized: z.literal(true),
    collectionConsentConfirmed: z.literal(true),
    cases: z.array(a1ImageAnnotationCaseV1Schema).min(1).max(10_000),
  })
  .strict()
  .superRefine((workspace, context) => {
    const caseIds = workspace.cases.map((item) => item.caseId);
    const hashes = workspace.cases.map((item) => item.artifactSha256);

    if (new Set(caseIds).size !== caseIds.length) {
      context.addIssue({
        code: "custom",
        message: "Annotation case IDs must be unique",
        path: ["cases"],
      });
    }

    if (new Set(hashes).size !== hashes.length) {
      context.addIssue({
        code: "custom",
        message: "Annotation image checksums must be unique",
        path: ["cases"],
      });
    }
  });

export type A1ImageAnnotationWorkspaceV1 = z.infer<typeof a1ImageAnnotationWorkspaceV1Schema>;

export function assertReleaseReadyImageWorkspace(input: A1ImageAnnotationWorkspaceV1) {
  const workspace = a1ImageAnnotationWorkspaceV1Schema.parse(input);

  if (workspace.cases.length < 60) {
    throw new Error("A1 real-image release evaluation requires 60+ images");
  }

  if (workspace.reviewedAt === null) {
    throw new Error("A1 image workspace requires reviewedAt");
  }

  const incomplete = workspace.cases.filter(
    (item) =>
      !item.humanReviewed ||
      item.sceneFamily === null ||
      item.difficulty === null ||
      item.requireVisibleRegionEvidence === null ||
      (item.expectedKinds.length > 0 && !item.requireVisibleRegionEvidence) ||
      (item.sceneFamily === "CONTRADICTION" && item.sourceText === null),
  );

  if (incomplete.length > 0) {
    throw new Error(`A1 image workspace has ${incomplete.length} incomplete human labels`);
  }

  const sceneFamilies = new Set(workspace.cases.map((item) => item.sceneFamily));
  const missingSceneFamilies = a1ImageSceneFamilySchema.options.filter(
    (sceneFamily) => !sceneFamilies.has(sceneFamily),
  );

  if (missingSceneFamilies.length > 0) {
    throw new Error(
      `A1 image workspace is missing scene families: ${missingSceneFamilies.join(", ")}`,
    );
  }

  const difficulties = new Set(workspace.cases.map((item) => item.difficulty));
  const missingDifficulties = a1ImageDifficultySchema.options.filter(
    (difficulty) => !difficulties.has(difficulty),
  );

  if (missingDifficulties.length > 0) {
    throw new Error(
      `A1 image workspace is missing difficulties: ${missingDifficulties.join(", ")}`,
    );
  }

  return workspace;
}
