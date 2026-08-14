import { randomUUID } from "node:crypto";
import {
  Prisma,
  PrismaClient,
  RegistrationDraftStatus,
  RegistrationSourceType,
} from "@prisma/client";
import type { LanguageModel } from "ai";
import type { AgentRuntimeGuard } from "../runtime/guard.js";
import { prisma } from "../prisma.js";
import { projectUpdateDraftSchema, type ProjectUpdateDraft } from "./draft.js";
import { extractProjectUpdate, type ExtractProjectUpdateResult } from "./extract.js";
import { projectUpdateConfidenceSchema } from "./schema.js";
import {
  getProjectUpdateSourceType,
  hashProjectUpdateSource,
  normalizeProjectUpdateSource,
  type ProjectUpdateImageSource,
} from "./source.js";
import { projectUpdateValidationSchema } from "./validation.js";

export interface RegisterProjectUpdateDraftOptions {
  tenantRef: string;
  projectRef?: string;
  sourceText?: string;
  sourceImage?: ProjectUpdateImageSource;
  referenceDate: string;
  model: LanguageModel;
  provider: string;
  modelId: string;
  requestId?: string;
  telemetryEnabled?: boolean;
  recordTelemetryContent?: boolean;
  client?: PrismaClient;
  runtimeGuard?: AgentRuntimeGuard;
}

export interface RegisterProjectUpdateDraftResult {
  draftId: string;
  requestId: string;
  tenantId: string;
  projectId: string | null;
  status: RegistrationDraftStatus;
  draft: ProjectUpdateDraft;
  reused: boolean;
  extraction: ExtractProjectUpdateResult | null;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error("Value is not JSON serializable");
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 10_000);
}

function prismaSourceType(sourceType: ReturnType<typeof getProjectUpdateSourceType>) {
  if (sourceType === "TEXT_IMAGE") {
    return RegistrationSourceType.TEXT_IMAGE;
  }

  return sourceType === "IMAGE" ? RegistrationSourceType.IMAGE : RegistrationSourceType.TEXT;
}

async function resolveTenant(client: PrismaClient, tenantRef: string) {
  const tenant = await client.tenant.findFirst({
    where: {
      OR: [{ id: tenantRef }, { slug: tenantRef }],
    },
    select: { id: true },
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${tenantRef}`);
  }

  return tenant;
}

async function resolveProject(client: PrismaClient, tenantId: string, projectRef: string) {
  const project = await client.project.findFirst({
    where: {
      tenantId,
      OR: [{ id: projectRef }, { code: projectRef }],
    },
    select: { id: true },
  });

  if (!project) {
    throw new Error(`Project not found in tenant scope: ${projectRef}`);
  }

  return project;
}

function storedDraft(record: {
  status: RegistrationDraftStatus;
  structuredData: Prisma.JsonValue | null;
  confidence: Prisma.JsonValue | null;
  validation: Prisma.JsonValue | null;
}) {
  const confidence = projectUpdateConfidenceSchema.parse(record.confidence);
  const validation = projectUpdateValidationSchema.parse(record.validation);

  return projectUpdateDraftSchema.parse({
    schemaVersion: 1,
    update: record.structuredData,
    confidence,
    validation,
    reviewRecommendation:
      validation.valid && confidence.level !== "LOW" ? "READY_FOR_REVIEW" : "NEEDS_CORRECTION",
    requiresHumanReview: true,
  });
}

function isReusableStatus(status: RegistrationDraftStatus) {
  return (
    status === RegistrationDraftStatus.READY_FOR_REVIEW ||
    status === RegistrationDraftStatus.NEEDS_CORRECTION ||
    status === RegistrationDraftStatus.APPROVED ||
    status === RegistrationDraftStatus.APPLIED ||
    status === RegistrationDraftStatus.REJECTED
  );
}

export async function registerProjectUpdateDraft(
  options: RegisterProjectUpdateDraftOptions,
): Promise<RegisterProjectUpdateDraftResult> {
  const client = options.client ?? prisma;
  const source = normalizeProjectUpdateSource({
    text: options.sourceText,
    image: options.sourceImage,
  });
  const sourceType = getProjectUpdateSourceType(source);
  const sourceSha256 = hashProjectUpdateSource(source);
  const requestId = options.requestId ?? randomUUID();
  const tenant = await resolveTenant(client, options.tenantRef);
  const explicitProject = options.projectRef
    ? await resolveProject(client, tenant.id, options.projectRef)
    : null;
  const existing = await client.registrationDraft.findUnique({
    where: { requestId },
  });

  if (existing) {
    if (existing.tenantId !== tenant.id || existing.sourceSha256 !== sourceSha256) {
      throw new Error(
        `Registration request ${requestId} already exists with different scope or source`,
      );
    }

    if (
      isReusableStatus(existing.status) &&
      existing.structuredData &&
      existing.confidence &&
      existing.validation
    ) {
      return {
        draftId: existing.id,
        requestId,
        tenantId: existing.tenantId,
        projectId: existing.projectId,
        status: existing.status,
        draft: storedDraft(existing),
        reused: true,
        extraction: null,
      };
    }

    await client.registrationDraft.update({
      where: { id: existing.id },
      data: {
        projectId: explicitProject?.id ?? existing.projectId,
        status: RegistrationDraftStatus.PROCESSING,
        errorMessage: null,
        completedAt: null,
      },
    });
  } else {
    await client.registrationDraft.create({
      data: {
        id: randomUUID(),
        requestId,
        tenantId: tenant.id,
        projectId: explicitProject?.id,
        sourceType: prismaSourceType(sourceType),
        sourceText: source.text,
        sourceImage: source.image ? Uint8Array.from(source.image.data) : undefined,
        sourceFileName: source.image?.fileName,
        sourceMediaType: source.image?.mediaType,
        sourceImageMetadata:
          source.image?.preprocessing !== undefined || source.image?.security !== undefined
            ? toInputJson({
                schemaVersion: 1,
                preprocessing: source.image.preprocessing,
                security: source.image.security,
              })
            : undefined,
        sourceSha256,
        referenceDate: new Date(`${options.referenceDate}T00:00:00.000Z`),
        status: RegistrationDraftStatus.PROCESSING,
        provider: options.provider,
        modelId: options.modelId,
      },
    });
  }

  const record = await client.registrationDraft.findUniqueOrThrow({
    where: { requestId },
  });

  try {
    const extraction = await extractProjectUpdate({
      model: options.model,
      sourceText: source.text,
      sourceImage: source.image,
      referenceDate: options.referenceDate,
      requestId,
      telemetryEnabled: options.telemetryEnabled,
      recordTelemetryContent: options.recordTelemetryContent,
      tenantId: tenant.id,
      runtimeGuard: options.runtimeGuard,
    });
    const inferredProject =
      explicitProject ??
      (extraction.update.projectCode
        ? await client.project.findFirst({
            where: {
              tenantId: tenant.id,
              code: extraction.update.projectCode,
            },
            select: { id: true },
          })
        : null);
    const status =
      extraction.draft.reviewRecommendation === "READY_FOR_REVIEW"
        ? RegistrationDraftStatus.READY_FOR_REVIEW
        : RegistrationDraftStatus.NEEDS_CORRECTION;

    await client.registrationDraft.update({
      where: { id: record.id },
      data: {
        projectId: inferredProject?.id ?? record.projectId,
        status,
        structuredData: toInputJson(extraction.update),
        confidence: toInputJson(extraction.confidence),
        validation: toInputJson(extraction.validation),
        completedAt: new Date(),
      },
    });

    return {
      draftId: record.id,
      requestId,
      tenantId: tenant.id,
      projectId: inferredProject?.id ?? record.projectId,
      status,
      draft: extraction.draft,
      reused: false,
      extraction,
    };
  } catch (error) {
    await client.registrationDraft.update({
      where: { id: record.id },
      data: {
        status: RegistrationDraftStatus.FAILED,
        errorMessage: errorMessage(error),
        completedAt: new Date(),
      },
    });

    throw error;
  }
}
