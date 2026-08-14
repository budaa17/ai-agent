import { z } from "zod";
import { contractIdentifierSchema, contractIsoDateTimeSchema } from "../contracts/common.js";

export const malwareScanStatusSchema = z.enum(["CLEAN", "INFECTED", "ERROR"]);

export const malwareScanResultV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    scannerId: contractIdentifierSchema,
    scannerVersion: z.string().trim().min(1).max(200),
    signatureVersion: z.string().trim().min(1).max(200),
    status: malwareScanStatusSchema,
    scannedAt: contractIsoDateTimeSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    threatName: z.string().trim().min(1).max(500).nullable(),
    errorMessage: z.string().trim().min(1).max(1_000).nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "INFECTED" && result.threatName === null) {
      context.addIssue({
        code: "custom",
        message: "An infected artifact requires a threat name",
        path: ["threatName"],
      });
    }

    if (result.status === "ERROR" && result.errorMessage === null) {
      context.addIssue({
        code: "custom",
        message: "A scanner error requires an error message",
        path: ["errorMessage"],
      });
    }

    if (result.status === "CLEAN" && (result.threatName !== null || result.errorMessage !== null)) {
      context.addIssue({
        code: "custom",
        message: "A clean scan cannot contain threat or error metadata",
        path: ["status"],
      });
    }
  });

export const projectUpdateImageSecurityV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    malwareScan: malwareScanResultV1Schema,
  })
  .strict()
  .superRefine((security, context) => {
    if (security.sourceSha256 !== security.malwareScan.sha256) {
      context.addIssue({
        code: "custom",
        message: "Malware scan checksum must match the source checksum",
        path: ["malwareScan", "sha256"],
      });
    }

    if (security.malwareScan.status !== "CLEAN") {
      context.addIssue({
        code: "custom",
        message: "Only malware-scanned clean images may enter A1",
        path: ["malwareScan", "status"],
      });
    }
  });

export const artifactRetentionV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    classification: z.enum(["SOURCE_PRIVATE", "AGENT_DRAFT", "APPROVED_RECORD"]),
    createdAt: contractIsoDateTimeSchema,
    expiresAt: contractIsoDateTimeSchema.nullable(),
    legalHold: z.boolean(),
    deletionStatus: z.enum(["ACTIVE", "PENDING_DELETE", "DELETED"]),
  })
  .strict()
  .superRefine((retention, context) => {
    if (
      retention.expiresAt !== null &&
      Date.parse(retention.expiresAt) <= Date.parse(retention.createdAt)
    ) {
      context.addIssue({
        code: "custom",
        message: "Artifact expiry must be after creation",
        path: ["expiresAt"],
      });
    }

    if (retention.legalHold && retention.deletionStatus !== "ACTIVE") {
      context.addIssue({
        code: "custom",
        message: "A legal-hold artifact cannot be pending deletion",
        path: ["deletionStatus"],
      });
    }
  });

export const storedArtifactV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    artifactId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    mediaType: z.string().trim().min(1).max(200),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    sizeBytes: z.number().int().nonnegative(),
    storageKey: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine(
        (value) =>
          !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/u.test(value) && !value.split(/[\\/]/u).includes(".."),
        "Artifact storage key must be relative and traversal-safe",
      ),
    malwareScan: malwareScanResultV1Schema,
    retention: artifactRetentionV1Schema,
  })
  .strict();

export const signedArtifactReadReferenceV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    referenceId: contractIdentifierSchema,
    artifactId: contractIdentifierSchema,
    tenantId: contractIdentifierSchema,
    projectId: contractIdentifierSchema,
    storageKey: z.string().trim().min(1).max(1_000),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: contractIsoDateTimeSchema,
    accessToken: z.string().trim().min(32).max(500),
  })
  .strict();

export type MalwareScanResultV1 = z.infer<typeof malwareScanResultV1Schema>;
export type ProjectUpdateImageSecurityV1 = z.infer<typeof projectUpdateImageSecurityV1Schema>;
export type ArtifactRetentionV1 = z.infer<typeof artifactRetentionV1Schema>;
export type StoredArtifactV1 = z.infer<typeof storedArtifactV1Schema>;
export type SignedArtifactReadReferenceV1 = z.infer<typeof signedArtifactReadReferenceV1Schema>;
