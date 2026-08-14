import { phase9Sha256 } from "./security.js";

export type A1RegistrationDraftSnapshot = Readonly<{
  id: string;
  tenantId: string;
  projectId: string | null;
  sourceSha256: string;
  referenceDate: Date | string;
  status:
    | "PROCESSING"
    | "READY_FOR_REVIEW"
    | "NEEDS_CORRECTION"
    | "APPROVED"
    | "APPLIED"
    | "REJECTED"
    | "FAILED";
  rowVersion: number;
  structuredData: unknown;
  confidence: unknown;
  validation: unknown;
  createdAt: Date | string;
}>;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function a1RegistrationContent(draft: A1RegistrationDraftSnapshot) {
  return {
    schemaVersion: 1,
    registrationDraftId: draft.id,
    sourceSha256: draft.sourceSha256,
    referenceDate: iso(draft.referenceDate),
    structuredData: draft.structuredData,
    confidence: draft.confidence,
    validation: draft.validation,
  };
}

export function a1RegistrationSourceHash(draft: A1RegistrationDraftSnapshot): string {
  return phase9Sha256(a1RegistrationContent(draft));
}

export function a1RegistrationLifecycleStatus(
  status: A1RegistrationDraftSnapshot["status"],
):
  | "DRAFT"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "APPLIED"
  | "REJECTED"
  | "CANCELLED" {
  if (status === "READY_FOR_REVIEW" || status === "NEEDS_CORRECTION") {
    return "REVIEW_REQUIRED";
  }
  if (status === "APPROVED" || status === "APPLIED" || status === "REJECTED") return status;
  if (status === "FAILED") return "CANCELLED";
  return "DRAFT";
}
