import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const evidenceReferenceSchema = z
  .object({
    path: z.string().trim().min(1).max(2_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    result: z.literal("PASS"),
    issuer: z.string().trim().min(3).max(300),
    issuedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((reference, context) => {
    if (/(?:synthetic|demo|test|placeholder)/iu.test(reference.issuer)) {
      context.addIssue({
        code: "custom",
        message: "Evidence issuer must be a real accountable reviewer",
        path: ["issuer"],
      });
    }
  });

export const phase11ReleaseEvidenceSchema = z
  .object({
    schemaVersion: z.literal(1),
    release: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u),
    generatedAt: z.string().datetime({ offset: true }),
    deployedBaseUrl: z
      .string()
      .url()
      .refine((value) => new URL(value).protocol === "https:", "Deployed URL must use HTTPS"),
    drawingBoq: z
      .object({
        caseCount: z.number().int().min(10),
        datasetManifest: evidenceReferenceSchema,
        engineerReview: evidenceReferenceSchema,
      })
      .strict(),
    photoDataset: z
      .object({
        imageCount: z.number().int().min(60),
        datasetManifest: evidenceReferenceSchema,
        ownerConsent: evidenceReferenceSchema,
        humanReview: evidenceReferenceSchema,
      })
      .strict(),
    deployment: z
      .object({
        twoTenantIsolation: evidenceReferenceSchema,
        authRbacRefresh: evidenceReferenceSchema,
        offlineFieldTest: evidenceReferenceSchema,
        productionLoadTest: evidenceReferenceSchema,
        independentSecurityAssessment: evidenceReferenceSchema,
        backupRestoreDrill: evidenceReferenceSchema,
        sentryAlert: evidenceReferenceSchema,
        langfuseTraceCost: evidenceReferenceSchema,
      })
      .strict(),
    signoffs: z
      .array(
        z
          .object({
            role: z.enum(["DOMAIN_ENGINEER", "SECURITY_OWNER", "OPERATIONS_OWNER"]),
            evidence: evidenceReferenceSchema,
          })
          .strict(),
      )
      .length(3),
  })
  .strict()
  .superRefine((manifest, context) => {
    const roles = new Set(manifest.signoffs.map((signoff) => signoff.role));
    if (roles.size !== 3) {
      context.addIssue({
        code: "custom",
        message: "All three independent release roles must sign",
        path: ["signoffs"],
      });
    }
    const references = collectReferences(manifest);
    const paths = references.map((reference) => reference.path);
    if (new Set(paths).size !== paths.length) {
      context.addIssue({
        code: "custom",
        message: "Every release claim requires a distinct evidence artifact",
        path: [],
      });
    }
  });

export type Phase11ReleaseEvidence = z.infer<typeof phase11ReleaseEvidenceSchema>;

function collectReferences(manifest: Phase11ReleaseEvidence) {
  return [
    manifest.drawingBoq.datasetManifest,
    manifest.drawingBoq.engineerReview,
    manifest.photoDataset.datasetManifest,
    manifest.photoDataset.ownerConsent,
    manifest.photoDataset.humanReview,
    ...Object.values(manifest.deployment),
    ...manifest.signoffs.map((signoff) => signoff.evidence),
  ];
}

function safeEvidencePath(root: string, path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  if (
    isAbsolute(normalized) ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`Unsafe release evidence path: ${path}`);
  }
  const target = resolve(root, ...normalized.split("/"));
  const relativePath = relative(root, target);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Release evidence escaped the manifest directory");
  }
  return target;
}

async function digest(path: string): Promise<string> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size > 50 * 1024 * 1024) {
    throw new Error("Release evidence must be a regular file no larger than 50 MB");
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function validatePhase11ReleaseEvidence(
  manifestPathInput: string,
): Promise<Phase11ReleaseEvidence> {
  const manifestPath = resolve(manifestPathInput);
  let manifestJson: string;
  try {
    manifestJson = await readFile(manifestPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Release evidence manifest was not found: ${manifestPath}`, { cause: error });
    }
    throw error;
  }
  const manifest = phase11ReleaseEvidenceSchema.parse(JSON.parse(manifestJson) as unknown);
  const root = dirname(manifestPath);
  for (const reference of collectReferences(manifest)) {
    const actual = await digest(safeEvidencePath(root, reference.path));
    if (actual !== reference.sha256) {
      throw new Error(`Release evidence checksum mismatch: ${reference.path}`);
    }
  }
  return manifest;
}
