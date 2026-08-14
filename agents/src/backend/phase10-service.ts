import type { TenantLimitReservation } from "./tenant-limit-reservation.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve, sep } from "node:path";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import { a1RegistrationSourceHash, type A1RegistrationDraftSnapshot } from "./a1-review.js";
import { addA1ProjectContextValidation } from "./a1-project-context.js";
import { buildProjectUpdateDraft } from "../structuring/draft.js";
import {
  PROJECT_UPDATE_FIELDS,
  projectUpdateConfidenceSchema,
  projectUpdateExtractionSchema,
} from "../structuring/schema.js";
import { validateProjectUpdateLogic } from "../structuring/validation.js";
import {
  Phase9ApiError,
  phase9IdentifierSchema,
  type Phase9AuthenticatedPrincipal,
} from "./contracts.js";
import { permissionsForRole, requireTenantPermission, roleHasPermission } from "./authorization.js";
import type { Phase9ProjectService } from "./project-service.js";
import { phase9Sha256 } from "./security.js";
import {
  Phase11ArtifactRejectedError,
  createPhase11ArtifactSecurity,
  type Phase11ArtifactInspection,
  type Phase11ArtifactSecurity,
} from "./phase11-artifact-security.js";
import {
  phase10A4AnswerSchema,
  phase10A4QuestionSchema,
  phase10A1IntakeRequestSchema,
  phase10A1DraftCorrectionRequestSchema,
  phase10A1DraftReviewResultSchema,
  phase10ArtifactUploadResultSchema,
  phase10DailyReportDraftRequestSchema,
  phase10DailyReportDraftResultSchema,
  phase10ProjectCreateRequestSchema,
  phase10ProjectCreateResultSchema,
  phase10StockMovementRequestSchema,
  phase10WorkspaceSchema,
  type Phase10Workspace,
} from "./phase10-contracts.js";
import type { Phase10A0ArtifactReader, Phase10A0IntakeService } from "./a0-intake-service.js";

const frontendSourceVersion = "buildwatch-v22-phase10-frontend-api-v1";

function serializeValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (Array.isArray(value)) return value.map(serializeValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeValue(item)]),
    );
  }
  return value;
}

function serializeRecords(values: readonly object[]): Record<string, unknown>[] {
  return values.map((value) => serializeValue(value) as Record<string, unknown>);
}

function numberValue(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(value.toString());
}

function currentPlannedProgress(plannedStart: Date, plannedEnd: Date, now: Date): number {
  if (now <= plannedStart) return 0;
  if (now >= plannedEnd) return 100;
  const duration = plannedEnd.getTime() - plannedStart.getTime();
  if (duration <= 0) return 100;
  return Number((((now.getTime() - plannedStart.getTime()) / duration) * 100).toFixed(2));
}

function actualProjectProgress(
  workItems: readonly { progressPercent: number; budget: Prisma.Decimal }[],
): number {
  if (workItems.length === 0) return 0;
  const totalBudget = workItems.reduce((sum, item) => sum + numberValue(item.budget), 0);
  const progress =
    totalBudget > 0
      ? workItems.reduce((sum, item) => sum + item.progressPercent * numberValue(item.budget), 0) /
        totalBudget
      : workItems.reduce((sum, item) => sum + item.progressPercent, 0) / workItems.length;
  return Number(Math.min(100, Math.max(0, progress)).toFixed(2));
}

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isPrismaConflict(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2034")
  );
}

async function findIdempotencyAfterConflict(client: PrismaClient, tenantId: string, key: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await client.idempotencyRecord.findUnique({
      where: { tenantId_key: { tenantId, key } },
    });
    if (existing !== null) return existing;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10 * (attempt + 1)));
  }
  return null;
}

export interface Phase10ArtifactWrite {
  bucket: string;
  objectKey: string;
  remove(): Promise<void>;
}

export interface Phase10ArtifactStorage {
  put(
    input: Readonly<{
      tenantId: string;
      projectId: string;
      artifactId: string;
      originalFileName: string;
      mediaType: string;
      body: Buffer;
    }>,
  ): Promise<Phase10ArtifactWrite>;
}

export class LocalPhase10ArtifactStorage implements Phase10ArtifactStorage {
  readonly #root: string;

  constructor(root: string) {
    this.#root = resolve(root);
  }

  async put(
    input: Readonly<{
      tenantId: string;
      projectId: string;
      artifactId: string;
      originalFileName: string;
      mediaType: string;
      body: Buffer;
    }>,
  ): Promise<Phase10ArtifactWrite> {
    const safeName = basename(input.originalFileName).replace(/[^A-Za-z0-9._-]+/gu, "-");
    const objectKey = [
      input.tenantId,
      input.projectId,
      input.artifactId,
      safeName || "artifact.bin",
    ].join("/");
    const target = resolve(this.#root, ...objectKey.split("/"));
    if (target !== this.#root && !target.startsWith(`${this.#root}${sep}`)) {
      throw new Phase9ApiError(
        "ARTIFACT_ACCESS_DENIED",
        403,
        "Artifact path is outside configured storage",
      );
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.body, { flag: "wx" });
    return {
      bucket: "local",
      objectKey,
      remove: () => rm(target, { force: true }),
    };
  }
}

export class Phase10FrontendService {
  constructor(
    private readonly client: PrismaClient,
    private readonly projects: Phase9ProjectService,
    private readonly artifactStorage: Phase10ArtifactStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly artifactSecurity: Phase11ArtifactSecurity = createPhase11ArtifactSecurity(),
    private readonly a0IntakeService?: Phase10A0IntakeService,
    private readonly a1ArtifactReader?: Phase10A0ArtifactReader,
    /**
     * Plan limit reservation. Runs inside the creation transaction so a
     * concurrent request cannot slip through the same free slot (Phase 9).
     */
    private readonly limits?: TenantLimitReservation,
  ) {}

  async processA0Intake(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    idempotencyKey: string,
    input: unknown,
    correlationId: string,
  ) {
    if (this.a0IntakeService === undefined) {
      throw new Phase9ApiError("INTERNAL_ERROR", 503, "A0 intake service is not available");
    }
    return this.a0IntakeService.process(principal, projectId, idempotencyKey, input, correlationId);
  }

  async processA1Intake(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    input: unknown,
  ) {
    await this.projects.requireProject(principal, projectId, "AGENT_RUN");
    const request = phase10A1IntakeRequestSchema.parse(input);
    const [{ createChatModel }, { resolveA1ModelRuntimeConfig }, { registerProjectUpdateDraft }] =
      await Promise.all([
        import("../agent/model.js"),
        import("../structuring/config.js"),
        import("../structuring/intake.js"),
      ]);
    let sourceImage;
    if (request.imageArtifactId !== null) {
      if (this.a1ArtifactReader === undefined) {
        throw new Phase9ApiError("INTERNAL_ERROR", 503, "A1 artifact reader is unavailable");
      }
      const asset = await this.client.fileAsset.findFirst({
        where: {
          id: request.imageArtifactId,
          tenantId: principal.tenantId,
          projectId,
          status: "AVAILABLE",
          deletedAt: null,
          mediaType: { in: ["image/jpeg", "image/png", "image/webp"] },
        },
      });
      if (asset === null) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "A1 image artifact was not found");
      }
      const { body } = await this.a1ArtifactReader.read(asset);
      const { preprocessProjectUpdateImage } =
        await import("../structuring/image-preprocessing.js");
      sourceImage = await preprocessProjectUpdateImage({
        data: body,
        mediaType: asset.mediaType as "image/jpeg" | "image/png" | "image/webp",
        fileName: asset.originalFileName,
        sha256: asset.sha256,
      });
    }
    const modelConfig = resolveA1ModelRuntimeConfig(process.env, { help: false });
    const result = await registerProjectUpdateDraft({
      tenantRef: principal.tenantId,
      projectRef: projectId,
      sourceText: request.sourceText ?? undefined,
      sourceImage,
      referenceDate: request.referenceDate,
      model: createChatModel(modelConfig),
      provider: modelConfig.provider,
      modelId: modelConfig.modelId,
      requestId: request.requestId,
      client: this.client,
    });
    const canonical = await this.client.$transaction(async (transaction) => {
      let draft = await transaction.registrationDraft.findFirstOrThrow({
        where: { id: result.draftId, tenantId: principal.tenantId, projectId },
      });
      const [project, workItems] = await Promise.all([
        transaction.project.findFirstOrThrow({
          where: { id: projectId, tenantId: principal.tenantId },
          select: { code: true },
        }),
        transaction.workItem.findMany({
          where: { projectId, tenantId: principal.tenantId },
          select: { code: true },
        }),
      ]);
      const update = projectUpdateExtractionSchema.parse(draft.structuredData);
      const confidence = projectUpdateConfidenceSchema.parse(draft.confidence);
      const validation = addA1ProjectContextValidation({
        update,
        validation: validateProjectUpdateLogic(
          update,
          draft.referenceDate.toISOString().slice(0, 10),
        ),
        selectedProjectCode: project.code,
        knownWorkItemCodes: workItems.map((item) => item.code),
      });
      const validatedDraft = buildProjectUpdateDraft({
        update,
        fieldConfidence: confidence.fields,
        validation,
      });
      if (
        draft.status !== validatedDraft.reviewRecommendation ||
        JSON.stringify(draft.validation) !== JSON.stringify(validatedDraft.validation) ||
        JSON.stringify(draft.confidence) !== JSON.stringify(validatedDraft.confidence)
      ) {
        draft = await transaction.registrationDraft.update({
          where: { id: draft.id },
          data: {
            status: validatedDraft.reviewRecommendation,
            confidence: jsonInput(validatedDraft.confidence),
            validation: jsonInput(validatedDraft.validation),
          },
        });
      }
      const sourceHash = a1RegistrationSourceHash(draft as A1RegistrationDraftSnapshot);
      let reviewTask = await transaction.reviewTask.findFirst({
        where: {
          tenantId: principal.tenantId,
          projectId,
          targetType: "REGISTRATION_DRAFT",
          targetId: draft.id,
          targetVersion: draft.rowVersion,
        },
        orderBy: { createdAt: "desc" },
      });
      if (
        reviewTask !== null &&
        reviewTask.status === "REVIEW_REQUIRED" &&
        (draft.status !== "READY_FOR_REVIEW" || reviewTask.sourceHash !== sourceHash)
      ) {
        await transaction.reviewTask.update({
          where: { id: reviewTask.id },
          data: { status: "SUPERSEDED", rowVersion: { increment: 1 } },
        });
        reviewTask = null;
      }
      if (draft.status === "READY_FOR_REVIEW" && reviewTask === null) {
        const createdAt = this.now().toISOString();
        reviewTask = await transaction.reviewTask.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            projectId,
            targetType: "REGISTRATION_DRAFT",
            targetId: draft.id,
            targetVersion: draft.rowVersion,
            status: "REVIEW_REQUIRED",
            sourceHash,
            createdByUserId: principal.userId,
            assignedRole: "PROJECT_MANAGER",
            rowVersion: 1,
          },
        });
        const eventId = randomUUID();
        await transaction.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            projectId,
            actorUserId: principal.userId,
            actorRole: principal.tenantRole,
            action: "A1_REGISTRATION_DRAFT_SUBMITTED",
            entityType: "REGISTRATION_DRAFT",
            entityId: draft.id,
            reason: "A1 text/image extraction completed",
            correlationId: result.requestId,
            sourceVersion: "buildwatch-v22-a1-review-v1",
            beforeHash: null,
            afterHash: sourceHash,
            metadata: jsonInput({ reviewTaskId: reviewTask.id, requestId: result.requestId }),
          },
        });
        await transaction.outboxEvent.create({
          data: {
            id: eventId,
            tenantId: principal.tenantId,
            projectId,
            eventType: "A1_REGISTRATION_DRAFT_SUBMITTED",
            aggregateType: "REGISTRATION_DRAFT",
            aggregateId: draft.id,
            aggregateVersion: draft.rowVersion,
            idempotencyKey: `outbox:a1:${principal.tenantId}:${result.requestId}`,
            payload: jsonInput({ draftId: draft.id, reviewTaskId: reviewTask.id, sourceHash }),
            headers: jsonInput({ correlationId: result.requestId, schemaVersion: 1 }),
            availableAt: new Date(createdAt),
          },
        });
      }
      return { draft, reviewTask, sourceHash, validatedDraft };
    });
    return phase10A1DraftReviewResultSchema.parse({
      schemaVersion: 1,
      draftId: result.draftId,
      requestId: result.requestId,
      status: canonical.draft.status,
      rowVersion: canonical.draft.rowVersion,
      reviewTaskId: canonical.reviewTask?.id ?? null,
      reviewStatus: canonical.reviewTask?.status ?? null,
      sourceHash: canonical.sourceHash,
      reused: result.reused,
      draft: canonical.validatedDraft,
    });
  }

  async correctA1Draft(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    draftIdInput: string,
    idempotencyKeyInput: string,
    input: unknown,
    correlationId: string,
  ) {
    await this.projects.requireProject(principal, projectId, "AGENT_RUN");
    const draftId = phase9IdentifierSchema.parse(draftIdInput);
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const request = phase10A1DraftCorrectionRequestSchema.parse(input);
    const requestHash = phase9Sha256({ projectId, draftId, request });
    return this.client.$transaction(
      async (transaction) => {
        const existing = await transaction.idempotencyRecord.findUnique({
          where: { tenantId_key: { tenantId: principal.tenantId, key: idempotencyKey } },
        });
        if (existing !== null) {
          if (
            existing.projectId !== projectId ||
            existing.route !== "PHASE10_A1_DRAFT_CORRECTION" ||
            existing.requestHash !== requestHash
          ) {
            throw new Phase9ApiError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "Idempotency key was reused with different content",
            );
          }
          return phase10A1DraftReviewResultSchema.parse({
            ...(existing.responseBody as Record<string, unknown>),
            reused: true,
          });
        }
        const current = await transaction.registrationDraft.findFirst({
          where: { id: draftId, tenantId: principal.tenantId, projectId },
        });
        if (current === null) {
          throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "A1 draft was not found");
        }
        if (!["READY_FOR_REVIEW", "NEEDS_CORRECTION"].includes(current.status)) {
          throw new Phase9ApiError("IMMUTABLE_VERSION", 409, "Terminal A1 draft cannot be edited");
        }
        if (current.rowVersion !== request.expectedRowVersion) {
          throw new Phase9ApiError(
            "OPTIMISTIC_LOCK_CONFLICT",
            409,
            "A1 draft changed before correction",
          );
        }
        const previousUpdate = projectUpdateExtractionSchema.parse(current.structuredData);
        const previousConfidence = projectUpdateConfidenceSchema.parse(current.confidence);
        const confidenceByField = new Map(
          previousConfidence.fields.map((entry) => [entry.field, entry]),
        );
        const fieldConfidence = PROJECT_UPDATE_FIELDS.flatMap((field) => {
          const value = request.structuredData[field];
          const populated = Array.isArray(value) ? value.length > 0 : value !== null;
          if (!populated) return [];
          const changed =
            JSON.stringify(previousUpdate[field]) !== JSON.stringify(request.structuredData[field]);
          const previous = confidenceByField.get(field);
          if (!changed && previous !== undefined) return [previous];
          return [{ field, score: 1, evidence: `Human correction: ${request.reason}` }];
        });
        const [project, workItems] = await Promise.all([
          transaction.project.findFirstOrThrow({
            where: { id: projectId, tenantId: principal.tenantId },
            select: { code: true },
          }),
          transaction.workItem.findMany({
            where: { projectId, tenantId: principal.tenantId },
            select: { code: true },
          }),
        ]);
        const validation = addA1ProjectContextValidation({
          update: request.structuredData,
          validation: validateProjectUpdateLogic(
            request.structuredData,
            current.referenceDate.toISOString().slice(0, 10),
          ),
          selectedProjectCode: project.code,
          knownWorkItemCodes: workItems.map((item) => item.code),
        });
        const correctedDraft = buildProjectUpdateDraft({
          update: request.structuredData,
          fieldConfidence,
          validation,
        });
        const nextVersion = current.rowVersion + 1;
        const nextStatus = correctedDraft.reviewRecommendation;
        await transaction.reviewTask.updateMany({
          where: {
            tenantId: principal.tenantId,
            projectId,
            targetType: "REGISTRATION_DRAFT",
            targetId: draftId,
            status: "REVIEW_REQUIRED",
          },
          data: { status: "SUPERSEDED", rowVersion: { increment: 1 } },
        });
        const updated = await transaction.registrationDraft.update({
          where: { id: draftId },
          data: {
            structuredData: jsonInput(correctedDraft.update),
            confidence: jsonInput(correctedDraft.confidence),
            validation: jsonInput(correctedDraft.validation),
            status: nextStatus,
            rowVersion: nextVersion,
            reviewedAt: null,
          },
        });
        const sourceHash = a1RegistrationSourceHash(updated as A1RegistrationDraftSnapshot);
        const reviewTask =
          nextStatus === "READY_FOR_REVIEW"
            ? await transaction.reviewTask.create({
                data: {
                  id: randomUUID(),
                  tenantId: principal.tenantId,
                  projectId,
                  targetType: "REGISTRATION_DRAFT",
                  targetId: draftId,
                  targetVersion: nextVersion,
                  status: "REVIEW_REQUIRED",
                  sourceHash,
                  createdByUserId: principal.userId,
                  assignedRole: "PROJECT_MANAGER",
                  rowVersion: 1,
                },
              })
            : null;
        const createdAt = this.now().toISOString();
        const eventId = randomUUID();
        const result = phase10A1DraftReviewResultSchema.parse({
          schemaVersion: 1,
          draftId,
          requestId: current.requestId,
          status: nextStatus,
          rowVersion: nextVersion,
          reviewTaskId: reviewTask?.id ?? null,
          reviewStatus: reviewTask?.status ?? null,
          sourceHash,
          reused: false,
          draft: correctedDraft,
        });
        await transaction.auditLog.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            projectId,
            actorUserId: principal.userId,
            actorRole: principal.tenantRole,
            action: "A1_REGISTRATION_DRAFT_CORRECTED",
            entityType: "REGISTRATION_DRAFT",
            entityId: draftId,
            reason: request.reason,
            correlationId,
            sourceVersion: "buildwatch-v22-a1-review-v1",
            beforeHash: a1RegistrationSourceHash(current as A1RegistrationDraftSnapshot),
            afterHash: sourceHash,
            metadata: jsonInput({ rowVersion: nextVersion, reviewTaskId: reviewTask?.id ?? null }),
          },
        });
        await transaction.outboxEvent.create({
          data: {
            id: eventId,
            tenantId: principal.tenantId,
            projectId,
            eventType: "A1_REGISTRATION_DRAFT_CORRECTED",
            aggregateType: "REGISTRATION_DRAFT",
            aggregateId: draftId,
            aggregateVersion: nextVersion,
            idempotencyKey: `outbox:${principal.tenantId}:${idempotencyKey}`,
            payload: jsonInput({ draftId, reviewTaskId: reviewTask?.id ?? null, sourceHash }),
            headers: jsonInput({ correlationId, schemaVersion: 1 }),
            availableAt: new Date(createdAt),
          },
        });
        await transaction.idempotencyRecord.create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            projectId,
            key: idempotencyKey,
            route: "PHASE10_A1_DRAFT_CORRECTION",
            requestHash,
            responseStatus: 200,
            responseBody: jsonInput(result),
            actorUserId: principal.userId,
            expiresAt: new Date(Date.parse(createdAt) + 7 * 86_400_000),
          },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async generateA3Documents(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    input: unknown,
  ) {
    await this.projects.requireProject(principal, projectId, "AGENT_RUN");
    const request = z
      .object({
        requestId: phase9IdentifierSchema,
        asOf: z.string().datetime(),
        includePdf: z.boolean().default(true),
      })
      .strict()
      .parse(input);
    const [{ resolveReportRuntimeConfig }, { runAutomatedA3Documents }] = await Promise.all([
      import("../reporting/config.js"),
      import("../reporting/automation.js"),
    ]);
    const config = resolveReportRuntimeConfig(process.env, {
      help: false,
      tenantId: principal.tenantId,
      projectRef: projectId,
      asOf: request.asOf,
      analysisOnly: true,
      noPdf: !request.includePdf,
    });
    const result = await runAutomatedA3Documents(
      {
        tenantId: principal.tenantId,
        projectRef: projectId,
        asOf: request.asOf,
        answerKeyPath: config.answerKeyPath,
        requestId: request.requestId,
        trigger: "REQUEST",
        noPdf: !request.includePdf,
        analysisOnly: true,
      },
      this.client,
    );
    return {
      schemaVersion: 1,
      runId: result.persisted.runId,
      draftIds: result.persisted.draftIds,
      reused: result.persisted.reused,
      pdfPath: result.paths.pdf,
    };
  }

  async workspace(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
  ): Promise<Phase10Workspace> {
    const authorized = await this.projects.requireProject(principal, projectId, "PROJECT_READ");
    const role = authorized.role;
    const tenantId = principal.tenantId;
    const canDesign = roleHasPermission(role, "DESIGN_READ");
    const canEstimate = roleHasPermission(role, "ESTIMATE_READ");
    const canPlan = roleHasPermission(role, "PLAN_READ");
    const canReport = roleHasPermission(role, "REPORT_READ");
    const canVerify = roleHasPermission(role, "VERIFICATION_READ");
    const canForecast = roleHasPermission(role, "FORECAST_READ");
    const canArtifact = roleHasPermission(role, "ARTIFACT_READ");
    const scope = { tenantId, projectId };

    const [
      project,
      workItems,
      dependencies,
      designDocuments,
      revisions,
      pages,
      scales,
      elements,
      quantityVersions,
      quantityItems,
      estimateVersions,
      estimateLines,
      estimateAssumptions,
      baselines,
      scheduleVersions,
      scheduleActivities,
      scheduleDependencies,
      crews,
      equipment,
      plans,
      planItems,
      reports,
      progressEntries,
      attendanceEntries,
      photos,
      verifications,
      verificationIssues,
      variances,
      forecasts,
      forecastWorkItems,
      forecastDrivers,
      recoveryScenarios,
      reviews,
      artifacts,
      a1Drafts,
      a3Drafts,
    ] = await Promise.all([
      this.client.project.findFirst({ where: { id: projectId, tenantId } }),
      this.client.workItem.findMany({
        where: scope,
        orderBy: [{ isCritical: "desc" }, { plannedStart: "asc" }, { code: "asc" }],
        take: 2_000,
      }),
      this.client.workItemDependency.findMany({
        where: scope,
        orderBy: { id: "asc" },
        take: 5_000,
      }),
      canDesign
        ? this.client.designDocument.findMany({
            where: { ...scope, deletedAt: null },
            orderBy: [{ updatedAt: "desc" }, { documentCode: "asc" }],
            take: 500,
          })
        : [],
      canDesign
        ? this.client.drawingRevision.findMany({
            where: scope,
            orderBy: [{ createdAt: "desc" }, { revisionNumber: "desc" }],
            take: 1_000,
          })
        : [],
      canDesign
        ? this.client.drawingPage.findMany({
            where: scope,
            orderBy: [{ revisionId: "asc" }, { pageNumber: "asc" }],
            take: 5_000,
          })
        : [],
      canDesign
        ? this.client.drawingScale.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            take: 5_000,
          })
        : [],
      canDesign
        ? this.client.designElement.findMany({
            where: scope,
            include: { geometry: true, sourceRefs: true },
            orderBy: [{ pageId: "asc" }, { elementType: "asc" }, { id: "asc" }],
            take: 10_000,
          })
        : [],
      canDesign
        ? this.client.quantityTakeoffVersion.findMany({
            where: scope,
            orderBy: { versionNumber: "desc" },
            take: 20,
          })
        : [],
      canDesign
        ? this.client.quantityTakeoffItem.findMany({
            where: scope,
            orderBy: [{ versionId: "desc" }, { workCode: "asc" }],
            take: 10_000,
          })
        : [],
      canEstimate
        ? this.client.estimateVersion.findMany({
            where: scope,
            orderBy: { versionNumber: "desc" },
            take: 20,
          })
        : [],
      canEstimate
        ? this.client.estimateLine.findMany({
            where: scope,
            orderBy: [{ estimateVersionId: "desc" }, { lineCode: "asc" }],
            take: 20_000,
          })
        : [],
      canEstimate
        ? this.client.estimateAssumption.findMany({
            where: scope,
            orderBy: [{ estimateVersionId: "desc" }, { assumptionCode: "asc" }],
            take: 1_000,
          })
        : [],
      canPlan
        ? this.client.baselineVersion.findMany({
            where: scope,
            orderBy: { versionNumber: "desc" },
            take: 20,
          })
        : [],
      canPlan
        ? this.client.scheduleVersion.findMany({
            where: scope,
            orderBy: { versionNumber: "desc" },
            take: 20,
          })
        : [],
      canPlan
        ? this.client.scheduleActivity.findMany({
            where: scope,
            include: { resourceRequirements: true },
            orderBy: [{ scheduleVersionId: "desc" }, { plannedStart: "asc" }],
            take: 10_000,
          })
        : [],
      canPlan
        ? this.client.scheduleDependency.findMany({
            where: scope,
            orderBy: { id: "asc" },
            take: 20_000,
          })
        : [],
      canPlan
        ? this.client.crew.findMany({
            where: scope,
            include: { availability: true },
            orderBy: { code: "asc" },
            take: 1_000,
          })
        : [],
      canPlan
        ? this.client.equipment.findMany({
            where: scope,
            include: { availability: true },
            orderBy: { code: "asc" },
            take: 1_000,
          })
        : [],
      canPlan
        ? this.client.dailyWorkPlan.findMany({
            where: scope,
            orderBy: [{ planDate: "desc" }, { createdAt: "desc" }],
            take: 90,
          })
        : [],
      canPlan
        ? this.client.dailyWorkPlanItem.findMany({
            where: scope,
            include: { resources: true, materials: true, preconditions: true },
            orderBy: [{ planId: "desc" }, { sequence: "asc" }],
            take: 10_000,
          })
        : [],
      canReport
        ? this.client.dailyReport.findMany({
            where: scope,
            orderBy: [{ reportDate: "desc" }, { createdAt: "desc" }],
            take: 90,
          })
        : [],
      canReport
        ? this.client.progressEntry.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            take: 10_000,
          })
        : [],
      canReport
        ? this.client.attendanceEntry.findMany({
            where: scope,
            orderBy: { id: "asc" },
            take: 10_000,
          })
        : [],
      canArtifact
        ? this.client.photoEvidence.findMany({
            where: scope,
            include: { links: true, quality: true },
            orderBy: { capturedAt: "desc" },
            take: 1_000,
          })
        : [],
      canVerify
        ? this.client.progressVerification.findMany({
            where: scope,
            orderBy: [{ verificationDate: "desc" }, { createdAt: "desc" }],
            take: 200,
          })
        : [],
      canVerify
        ? this.client.progressVerificationIssue.findMany({
            where: scope,
            orderBy: [{ blocksApproval: "desc" }, { severity: "desc" }],
            take: 2_000,
          })
        : [],
      canVerify
        ? this.client.dailyVariance.findMany({
            where: scope,
            orderBy: { varianceDate: "desc" },
            take: 5_000,
          })
        : [],
      canForecast
        ? this.client.forecastSnapshot.findMany({
            where: scope,
            orderBy: { asOf: "desc" },
            take: 30,
          })
        : [],
      canForecast
        ? this.client.forecastWorkItem.findMany({
            where: scope,
            orderBy: [{ forecastId: "desc" }, { isCritical: "desc" }],
            take: 10_000,
          })
        : [],
      canForecast
        ? this.client.forecastDriver.findMany({
            where: scope,
            orderBy: { contribution: "desc" },
            take: 2_000,
          })
        : [],
      canForecast
        ? this.client.recoveryScenario.findMany({
            where: scope,
            orderBy: { createdAt: "desc" },
            take: 500,
          })
        : [],
      this.client.reviewTask.findMany({
        where: scope,
        include: { decisions: true, corrections: true },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 1_000,
      }),
      canArtifact
        ? this.client.fileAsset.findMany({
            where: { ...scope, deletedAt: null },
            select: {
              id: true,
              originalFileName: true,
              mediaType: true,
              sizeBytes: true,
              sha256: true,
              status: true,
              retentionUntil: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 2_000,
          })
        : [],
      canReport
        ? this.client.registrationDraft.findMany({
            where: { tenantId, projectId },
            select: {
              id: true,
              requestId: true,
              sourceType: true,
              sourceText: true,
              sourceFileName: true,
              sourceMediaType: true,
              referenceDate: true,
              status: true,
              rowVersion: true,
              structuredData: true,
              confidence: true,
              validation: true,
              errorMessage: true,
              createdAt: true,
              reviewedAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 200,
          })
        : [],
      canReport
        ? this.client.a3DocumentDraft.findMany({
            where: { tenantId, projectId },
            select: {
              id: true,
              requestId: true,
              type: true,
              status: true,
              title: true,
              content: true,
              sourceAsOf: true,
              trigger: true,
              artifactPath: true,
              reviewNote: true,
              createdAt: true,
              reviewedAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 200,
          })
        : [],
    ]);

    if (project === null) {
      throw new Phase9ApiError("PROJECT_NOT_FOUND", 404, "Project not found");
    }

    const latestForecast = forecasts[0] ?? null;
    const alerts = [
      ...verificationIssues.map((issue) => ({
        id: issue.id,
        type: "VERIFICATION",
        severity: issue.severity,
        title: issue.issueCode,
        description: issue.blocksApproval
          ? "Progress verification approval is blocked."
          : "Progress verification requires review.",
        blocksApproval: issue.blocksApproval,
        sourceId: issue.verificationId,
      })),
      ...variances
        .filter(
          (variance) =>
            numberValue(variance.quantityVariance) < 0 || variance.scheduleVarianceMinutes > 0,
        )
        .slice(0, 100)
        .map((variance) => ({
          id: variance.id,
          type: "DAILY_VARIANCE",
          severity: variance.scheduleVarianceMinutes >= 480 ? "HIGH" : "MEDIUM",
          title: `Work item ${variance.workItemId} variance`,
          description: `Schedule variance ${variance.scheduleVarianceMinutes} minute(s).`,
          blocksApproval: false,
          sourceId: variance.id,
        })),
      ...(latestForecast !== null && numberValue(latestForecast.delayDays) > 0
        ? [
            {
              id: `forecast-${latestForecast.id}`,
              type: "FORECAST_DELAY",
              severity: numberValue(latestForecast.delayDays) >= 7 ? "HIGH" : "MEDIUM",
              title: "Projected finish delay",
              description: `Forecast delay ${latestForecast.delayDays?.toString() ?? "0"} day(s).`,
              blocksApproval: false,
              sourceId: latestForecast.id,
            },
          ]
        : []),
    ];
    const actualCost = canEstimate ? project.actualCost.toString() : null;
    const budget = canEstimate ? project.budget.toString() : null;

    return phase10WorkspaceSchema.parse({
      schemaVersion: 1,
      generatedAt: this.now().toISOString(),
      role,
      permissions: [...permissionsForRole(role)].sort(),
      project: {
        id: project.id,
        code: project.code,
        name: project.name,
        description: project.description,
        location: project.location,
        status: project.status,
        plannedStart: project.plannedStart.toISOString(),
        plannedEnd: project.plannedEnd.toISOString(),
        budgetMnt: budget,
        actualCostMnt: actualCost,
        rowVersion: project.rowVersion,
      },
      dashboard: {
        plannedProgressPercent: currentPlannedProgress(
          project.plannedStart,
          project.plannedEnd,
          this.now(),
        ),
        actualProgressPercent: actualProjectProgress(workItems),
        projectedFinish: latestForecast?.projectedFinish?.toISOString() ?? null,
        projectedDelayDays: latestForecast?.delayDays?.toString() ?? null,
        costVarianceMnt: canEstimate
          ? (numberValue(project.actualCost) - numberValue(project.budget)).toFixed(2)
          : null,
        criticalActivityCount:
          scheduleActivities.filter((activity) => activity.isCritical).length ||
          workItems.filter((item) => item.isCritical).length,
        openAlertCount: alerts.length,
      },
      workItems: serializeRecords(workItems),
      dependencies: serializeRecords(dependencies),
      design: {
        documents: serializeRecords(designDocuments),
        revisions: serializeRecords(revisions),
        pages: serializeRecords(pages),
        scales: serializeRecords(scales),
        elements: serializeRecords(elements),
      },
      commercial: {
        quantityVersions: serializeRecords(quantityVersions),
        quantityItems: serializeRecords(quantityItems),
        estimateVersions: serializeRecords(estimateVersions),
        estimateLines: serializeRecords(estimateLines),
        estimateAssumptions: serializeRecords(estimateAssumptions),
        baselines: serializeRecords(baselines),
      },
      schedule: {
        versions: serializeRecords(scheduleVersions),
        activities: serializeRecords(scheduleActivities),
        dependencies: serializeRecords(scheduleDependencies),
      },
      resources: {
        crews: serializeRecords(crews),
        equipment: serializeRecords(equipment),
      },
      operations: {
        plans: serializeRecords(plans),
        planItems: serializeRecords(planItems),
        reports: serializeRecords(reports),
        progress: serializeRecords(progressEntries),
        attendance: serializeRecords(attendanceEntries),
        photos: serializeRecords(photos),
        verifications: serializeRecords(verifications),
        variances: serializeRecords(variances),
      },
      forecast: {
        snapshots: serializeRecords(forecasts),
        workItems: serializeRecords(forecastWorkItems),
        drivers: serializeRecords(forecastDrivers),
        recoveryScenarios: serializeRecords(recoveryScenarios),
      },
      reviews: serializeRecords(reviews),
      artifacts: serializeRecords(artifacts),
      assistants: {
        a1Drafts: serializeRecords(a1Drafts),
        a3Drafts: serializeRecords(a3Drafts),
      },
      alerts: serializeRecords(alerts),
    });
  }

  async createProject(
    principal: Phase9AuthenticatedPrincipal,
    idempotencyKeyInput: string,
    input: unknown,
    correlationId: string,
  ) {
    requireTenantPermission(principal, "PROJECT_MANAGE");
    const request = phase10ProjectCreateRequestSchema.parse(input);
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const requestHash = phase9Sha256(request);
    return this.client
      .$transaction(
        async (transaction) => {
          const existing = await transaction.idempotencyRecord.findUnique({
            where: {
              tenantId_key: { tenantId: principal.tenantId, key: idempotencyKey },
            },
          });
          if (existing !== null) {
            if (
              existing.route !== "PHASE10_PROJECT_CREATE" ||
              existing.requestHash !== requestHash
            ) {
              throw new Phase9ApiError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "Idempotency key was reused with different content",
              );
            }
            return phase10ProjectCreateResultSchema.parse({
              ...(existing.responseBody as Record<string, unknown>),
              replayed: true,
            });
          }

          // Reserved before anything is written, and inside this transaction, so
          // two simultaneous creates cannot both take the last allowed slot.
          await this.limits?.reserve(transaction, principal.tenantId, "PROJECT_ACTIVE_MAX");
          const projectId = randomUUID();
          const eventId = randomUUID();
          const auditId = randomUUID();
          const createdAt = this.now().toISOString();
          await transaction.project.create({
            data: {
              id: projectId,
              tenantId: principal.tenantId,
              code: request.code,
              name: request.name,
              description: request.description,
              location: request.location,
              plannedStart: new Date(`${request.plannedStart}T00:00:00.000Z`),
              plannedEnd: new Date(`${request.plannedEnd}T00:00:00.000Z`),
              budget: request.budgetMnt,
              status: "PLANNED",
            },
          });
          await transaction.projectMember.create({
            data: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              userId: principal.userId,
              role: principal.tenantRole,
              active: true,
            },
          });
          const result = phase10ProjectCreateResultSchema.parse({
            projectId,
            code: request.code,
            status: "PLANNED",
            eventId,
            auditId,
            createdAt,
            replayed: false,
          });
          await transaction.auditLog.create({
            data: {
              id: auditId,
              tenantId: principal.tenantId,
              projectId,
              actorUserId: principal.userId,
              actorRole: principal.tenantRole,
              action: "PROJECT_CREATED",
              entityType: "PROJECT",
              entityId: projectId,
              reason: "Phase 10 project setup",
              correlationId,
              sourceVersion: frontendSourceVersion,
              afterHash: requestHash,
              metadata: jsonInput({ timezone: request.timezone }),
            },
          });
          await transaction.outboxEvent.create({
            data: {
              id: eventId,
              tenantId: principal.tenantId,
              projectId,
              eventType: "PROJECT_CREATED",
              aggregateType: "PROJECT",
              aggregateId: projectId,
              aggregateVersion: 1,
              idempotencyKey: `outbox:${principal.tenantId}:${idempotencyKey}`,
              payload: jsonInput({ projectId, code: request.code }),
              headers: jsonInput({ correlationId, schemaVersion: 1 }),
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              key: idempotencyKey,
              route: "PHASE10_PROJECT_CREATE",
              requestHash,
              responseStatus: 201,
              responseBody: jsonInput(result),
              actorUserId: principal.userId,
              expiresAt: new Date(Date.parse(createdAt) + 7 * 86_400_000),
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(async (error: unknown) => {
        if (isPrismaConflict(error)) {
          const existing = await findIdempotencyAfterConflict(
            this.client,
            principal.tenantId,
            idempotencyKey,
          );
          if (existing !== null) {
            if (
              existing.route !== "PHASE10_PROJECT_CREATE" ||
              existing.requestHash !== requestHash
            ) {
              throw new Phase9ApiError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "Idempotency key was reused with different content",
              );
            }
            return phase10ProjectCreateResultSchema.parse({
              ...(existing.responseBody as Record<string, unknown>),
              replayed: true,
            });
          }
          if (error.code === "P2034") {
            throw new Phase9ApiError(
              "OPTIMISTIC_LOCK_CONFLICT",
              409,
              "Concurrent project creation conflicted; retry with the same idempotency key",
            );
          }
          throw new Phase9ApiError("VALIDATION_FAILED", 409, "Project code already exists");
        }
        throw error;
      });
  }

  async submitDailyReport(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    idempotencyKeyInput: string,
    input: unknown,
    correlationId: string,
  ) {
    const authorized = await this.projects.requireProject(principal, projectId, "REPORT_SUBMIT");
    const request = phase10DailyReportDraftRequestSchema.parse(input);
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const requestHash = phase9Sha256({ projectId, request });
    return this.client
      .$transaction(
        async (transaction) => {
          const existing = await transaction.idempotencyRecord.findUnique({
            where: {
              tenantId_key: { tenantId: principal.tenantId, key: idempotencyKey },
            },
          });
          if (existing !== null) {
            if (
              existing.projectId !== projectId ||
              existing.route !== "PHASE10_DAILY_REPORT_DRAFT" ||
              existing.requestHash !== requestHash
            ) {
              throw new Phase9ApiError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "Idempotency key was reused with different content",
              );
            }
            return phase10DailyReportDraftResultSchema.parse({
              ...(existing.responseBody as Record<string, unknown>),
              replayed: true,
            });
          }
          const workItemIds = request.progress.map((entry) => entry.workItemId);
          const workItems = await transaction.workItem.findMany({
            where: {
              tenantId: principal.tenantId,
              projectId,
              id: { in: workItemIds },
            },
            select: { id: true },
          });
          if (workItems.length !== workItemIds.length) {
            throw new Phase9ApiError(
              "RESOURCE_NOT_FOUND",
              404,
              "One or more work items were not found",
            );
          }
          const planItemIds = [
            ...new Set(
              request.progress
                .map((entry) => entry.planItemId)
                .concat(request.photos.map((photo) => photo.planItemId))
                .filter((value): value is string => value !== null),
            ),
          ];
          const planItems =
            planItemIds.length === 0
              ? []
              : await transaction.dailyWorkPlanItem.findMany({
                  where: {
                    tenantId: principal.tenantId,
                    projectId,
                    id: { in: planItemIds },
                  },
                  select: { id: true, workItemId: true },
                });
          if (planItems.length !== planItemIds.length) {
            throw new Phase9ApiError(
              "RESOURCE_NOT_FOUND",
              404,
              "One or more plan items were not found",
            );
          }
          const planById = new Map(planItems.map((item) => [item.id, item]));
          if (
            request.progress.some(
              (entry) =>
                entry.planItemId !== null &&
                planById.get(entry.planItemId)?.workItemId !== entry.workItemId,
            )
          ) {
            throw new Phase9ApiError(
              "VALIDATION_FAILED",
              409,
              "Plan item does not belong to the reported work item",
            );
          }
          const assetIds = request.photos.map((photo) => photo.fileAssetId);
          const assets =
            assetIds.length === 0
              ? []
              : await transaction.fileAsset.findMany({
                  where: {
                    tenantId: principal.tenantId,
                    projectId,
                    id: { in: assetIds },
                    status: "AVAILABLE",
                    deletedAt: null,
                  },
                });
          if (assets.length !== assetIds.length) {
            throw new Phase9ApiError(
              "RESOURCE_NOT_FOUND",
              404,
              "One or more photo artifacts were not found",
            );
          }
          const reportId = randomUUID();
          const reviewTaskId = randomUUID();
          const eventId = randomUUID();
          const auditId = randomUUID();
          const createdAt = this.now().toISOString();
          await transaction.dailyReport.create({
            data: {
              id: reportId,
              tenantId: principal.tenantId,
              projectId,
              reportDate: new Date(`${request.reportDate}T00:00:00.000Z`),
              timezone: request.timezone,
              status: "DRAFT",
              sourceDraftId: request.sourceDraftId,
              sourceHash: requestHash,
              idempotencyKey,
              narrative: request.narrative,
              weather: request.weather === null ? Prisma.JsonNull : jsonInput(request.weather),
              submittedByUserId: principal.userId,
              progressEntries: {
                create: request.progress.map((entry) => ({
                  id: randomUUID(),
                  planItemId: entry.planItemId,
                  workItemId: entry.workItemId,
                  quantity: entry.quantity,
                  unit: entry.unit,
                  progressPercent: entry.progressPercent,
                  sourceRefs: jsonInput(entry.sourceRefs),
                })),
              },
              attendanceEntries: {
                create: request.attendance.map((entry) => ({
                  id: randomUUID(),
                  crewId: entry.crewId,
                  trade: entry.trade,
                  workerCount: entry.workerCount,
                  hoursPerWorker: entry.hoursPerWorker,
                  laborRate: entry.laborRateMnt,
                  sourceRefs: jsonInput(entry.sourceRefs),
                })),
              },
            },
          });
          for (const photo of request.photos) {
            const asset = assets.find((candidate) => candidate.id === photo.fileAssetId)!;
            const existingPhoto = await transaction.photoEvidence.findUnique({
              where: { projectId_sha256: { projectId, sha256: asset.sha256 } },
            });
            if (
              existingPhoto !== null &&
              existingPhoto.dailyReportId !== null &&
              existingPhoto.dailyReportId !== reportId
            ) {
              throw new Phase9ApiError(
                "IDEMPOTENCY_CONFLICT",
                409,
                "Photo evidence already belongs to another report",
              );
            }
            const photoId = existingPhoto?.id ?? randomUUID();
            if (existingPhoto === null) {
              await transaction.photoEvidence.create({
                data: {
                  id: photoId,
                  tenantId: principal.tenantId,
                  projectId,
                  dailyReportId: reportId,
                  fileAssetId: asset.id,
                  capturedAt: new Date(photo.capturedAt),
                  latitude: photo.latitude,
                  longitude: photo.longitude,
                  orientation: photo.orientation,
                  status: "UPLOADED",
                  sha256: asset.sha256,
                  sourceHash: phase9Sha256({ reportId, photo }),
                  createdByUserId: principal.userId,
                },
              });
            } else {
              await transaction.photoEvidence.update({
                where: { id: photoId },
                data: { dailyReportId: reportId },
              });
            }
            if (photo.planItemId !== null) {
              await transaction.photoEvidenceLink.create({
                data: {
                  id: randomUUID(),
                  tenantId: principal.tenantId,
                  projectId,
                  photoId,
                  planItemId: photo.planItemId,
                  linkType: "DAILY_REPORT_EVIDENCE",
                },
              });
            }
          }
          await transaction.reviewTask.create({
            data: {
              id: reviewTaskId,
              tenantId: principal.tenantId,
              projectId,
              targetType: "DAILY_REPORT",
              targetId: reportId,
              targetVersion: 1,
              status: "REVIEW_REQUIRED",
              sourceHash: requestHash,
              createdByUserId: principal.userId,
              assignedRole: "PROJECT_MANAGER",
              rowVersion: 1,
            },
          });
          const result = phase10DailyReportDraftResultSchema.parse({
            reportId,
            reviewTaskId,
            status: "REVIEW_REQUIRED",
            sourceHash: requestHash,
            rowVersion: 1,
            eventId,
            auditId,
            createdAt,
            replayed: false,
          });
          await transaction.auditLog.create({
            data: {
              id: auditId,
              tenantId: principal.tenantId,
              projectId,
              actorUserId: principal.userId,
              actorRole: authorized.role,
              action: "DAILY_REPORT_DRAFT_SUBMITTED",
              entityType: "DAILY_REPORT",
              entityId: reportId,
              reason: "Phase 10 mobile daily submission",
              correlationId,
              sourceVersion: frontendSourceVersion,
              afterHash: requestHash,
              metadata: jsonInput({
                reviewTaskId,
                progressCount: request.progress.length,
                attendanceCount: request.attendance.length,
                photoCount: request.photos.length,
              }),
            },
          });
          await transaction.outboxEvent.create({
            data: {
              id: eventId,
              tenantId: principal.tenantId,
              projectId,
              eventType: "DAILY_REPORT_DRAFT_SUBMITTED",
              aggregateType: "DAILY_REPORT",
              aggregateId: reportId,
              aggregateVersion: 1,
              idempotencyKey: `outbox:${principal.tenantId}:${idempotencyKey}`,
              payload: jsonInput({ reportId, reviewTaskId, sourceHash: requestHash }),
              headers: jsonInput({ correlationId, schemaVersion: 1 }),
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              key: idempotencyKey,
              route: "PHASE10_DAILY_REPORT_DRAFT",
              requestHash,
              responseStatus: 201,
              responseBody: jsonInput(result),
              actorUserId: principal.userId,
              expiresAt: new Date(Date.parse(createdAt) + 7 * 86_400_000),
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch(async (error: unknown) => {
        if (!isPrismaConflict(error)) throw error;
        const existing = await findIdempotencyAfterConflict(
          this.client,
          principal.tenantId,
          idempotencyKey,
        );
        if (existing !== null) {
          if (
            existing.projectId !== projectId ||
            existing.route !== "PHASE10_DAILY_REPORT_DRAFT" ||
            existing.requestHash !== requestHash
          ) {
            throw new Phase9ApiError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "Idempotency key was reused with different content",
            );
          }
          return phase10DailyReportDraftResultSchema.parse({
            ...(existing.responseBody as Record<string, unknown>),
            replayed: true,
          });
        }
        throw new Phase9ApiError(
          "OPTIMISTIC_LOCK_CONFLICT",
          409,
          "Concurrent daily report submission conflicted; retry with the same idempotency key",
        );
      });
  }

  async inventory(principal: Phase9AuthenticatedPrincipal, projectId: string) {
    await this.projects.requireProject(principal, projectId, "INVENTORY_READ");
    const [materials, movements] = await Promise.all([
      this.client.materialItem.findMany({
        where: { tenantId: principal.tenantId, active: true },
        orderBy: [{ code: "asc" }, { id: "asc" }],
        take: 5_000,
      }),
      this.client.stockMovement.findMany({
        where: { tenantId: principal.tenantId, projectId },
        include: { material: true, reversalOf: true },
        orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
        take: 5_000,
      }),
    ]);
    const reversedIds = new Set(
      movements
        .filter(
          (movement) => movement.movementType === "REVERSAL" && movement.reversalOfId !== null,
        )
        .map((movement) => movement.reversalOfId as string),
    );
    const balances = new Map<string, Prisma.Decimal>();
    for (const movement of movements) {
      if (movement.movementType === "REVERSAL" || reversedIds.has(movement.id)) continue;
      const direction = ["RECEIPT", "TRANSFER_IN", "ADJUSTMENT"].includes(movement.movementType)
        ? 1
        : -1;
      const current = balances.get(movement.materialItemId) ?? new Prisma.Decimal(0);
      balances.set(movement.materialItemId, current.add(movement.quantity.mul(direction)));
    }
    return {
      schemaVersion: 1,
      materials: serializeRecords(materials),
      movements: serializeRecords(movements),
      balances: materials.map((material) => ({
        materialItemId: material.id,
        code: material.code,
        name: material.canonicalName,
        unit: material.unit,
        quantity: (balances.get(material.id) ?? new Prisma.Decimal(0)).toString(),
      })),
    };
  }

  async createStockMovement(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    idempotencyKeyInput: string,
    input: unknown,
  ) {
    await this.projects.requireProject(principal, projectId, "INVENTORY_WRITE");
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const request = phase10StockMovementRequestSchema.parse(input);
    return this.client.$transaction(async (transaction) => {
      const existing = await transaction.stockMovement.findUnique({
        where: {
          tenantId_projectId_idempotencyKey: {
            tenantId: principal.tenantId,
            projectId,
            idempotencyKey,
          },
        },
      });
      if (existing !== null) return serializeValue(existing);

      let materialItemId = request.materialItemId;
      let quantity = request.quantity;
      let unit = request.unit;
      if (request.movementType === "REVERSAL") {
        const target = await transaction.stockMovement.findFirst({
          where: {
            id: request.reversalOfId as string,
            tenantId: principal.tenantId,
            projectId,
          },
        });
        if (target === null || target.movementType === "REVERSAL") {
          throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Reversal target was not found");
        }
        const priorReversal = await transaction.stockMovement.findFirst({
          where: { tenantId: principal.tenantId, projectId, reversalOfId: target.id },
        });
        if (priorReversal !== null) {
          throw new Phase9ApiError("VALIDATION_FAILED", 409, "Movement is already reversed");
        }
        materialItemId = target.materialItemId;
        quantity = target.quantity.toString();
        unit = target.unit;
      }
      const material = await transaction.materialItem.findFirst({
        where: { id: materialItemId as string, tenantId: principal.tenantId, active: true },
      });
      if (material === null || material.unit !== unit) {
        throw new Phase9ApiError("VALIDATION_FAILED", 409, "Material or unit is invalid");
      }
      if (request.movementType === "ISSUE") {
        const ledger = await transaction.stockMovement.findMany({
          where: { tenantId: principal.tenantId, projectId, materialItemId: material.id },
        });
        const reversed = new Set(ledger.map((entry) => entry.reversalOfId).filter(Boolean));
        const available = ledger.reduce((total, entry) => {
          if (entry.movementType === "REVERSAL" || reversed.has(entry.id)) return total;
          return total.add(
            entry.quantity.mul(
              ["RECEIPT", "TRANSFER_IN", "ADJUSTMENT"].includes(entry.movementType) ? 1 : -1,
            ),
          );
        }, new Prisma.Decimal(0));
        if (available.lessThan(new Prisma.Decimal(quantity as string))) {
          throw new Phase9ApiError("VALIDATION_FAILED", 409, "Insufficient stock balance");
        }
      }
      const created = await transaction.stockMovement.create({
        data: {
          id: randomUUID(),
          tenantId: principal.tenantId,
          projectId,
          materialItemId: material.id,
          movementType: request.movementType,
          quantity: quantity as string,
          unit: unit as string,
          occurredAt: new Date(request.occurredAt),
          warehouseCode: request.warehouseCode,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          idempotencyKey,
          reversalOfId: request.reversalOfId,
          reason: request.reason,
          sourceRefs: jsonInput([{ type: "MANUAL_INVENTORY", referenceId: request.referenceId }]),
          createdByUserId: principal.userId,
        },
      });
      return serializeValue(created);
    });
  }

  async uploadArtifact(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    idempotencyKeyInput: string,
    input: Readonly<{
      body: Buffer;
      originalFileName: string;
      mediaType: string;
      suppliedSha256?: string;
    }>,
    correlationId: string,
  ) {
    const authorized = await this.projects.requireProject(principal, projectId, "ARTIFACT_UPLOAD");
    const idempotencyKey = phase9IdentifierSchema.parse(idempotencyKeyInput);
    const originalFileName = basename(input.originalFileName.trim());
    if (
      originalFileName.length === 0 ||
      originalFileName.length > 255 ||
      /[\u0000-\u001f\u007f]/u.test(originalFileName)
    ) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "Invalid artifact name");
    }
    const sha256 = createHash("sha256").update(input.body).digest("hex");
    if (input.suppliedSha256 !== undefined && input.suppliedSha256.toLowerCase() !== sha256) {
      throw new Phase9ApiError("VALIDATION_FAILED", 400, "Artifact checksum does not match");
    }
    const requestHash = phase9Sha256({
      projectId,
      originalFileName,
      mediaType: input.mediaType,
      sizeBytes: input.body.length,
      sha256,
    });
    const existing = await this.client.idempotencyRecord.findUnique({
      where: {
        tenantId_key: { tenantId: principal.tenantId, key: idempotencyKey },
      },
    });
    if (existing !== null) {
      if (
        existing.projectId !== projectId ||
        existing.route !== "PHASE10_ARTIFACT_UPLOAD" ||
        existing.requestHash !== requestHash
      ) {
        throw new Phase9ApiError(
          "IDEMPOTENCY_CONFLICT",
          409,
          "Idempotency key was reused with different content",
        );
      }
      return phase10ArtifactUploadResultSchema.parse({
        ...(existing.responseBody as Record<string, unknown>),
        replayed: true,
      });
    }
    let securityInspection: Phase11ArtifactInspection;
    try {
      securityInspection = await this.artifactSecurity.inspect({
        body: input.body,
        originalFileName,
        mediaType: input.mediaType,
        sha256,
      });
    } catch (error) {
      if (!(error instanceof Phase11ArtifactRejectedError)) throw error;
      await this.client.auditLog
        .create({
          data: {
            id: randomUUID(),
            tenantId: principal.tenantId,
            projectId,
            actorUserId: principal.userId,
            actorRole: authorized.role,
            action: "ARTIFACT_REJECTED",
            entityType: "FILE_ASSET",
            entityId: sha256,
            reason: error.category,
            correlationId,
            sourceVersion: frontendSourceVersion,
            beforeHash: null,
            afterHash: null,
            metadata: jsonInput({
              category: error.category,
              mediaType: input.mediaType,
              scannerId: error.malwareScan?.scannerId ?? null,
              scanStatus: error.malwareScan?.status ?? null,
            }),
          },
        })
        .catch(() => undefined);
      throw new Phase9ApiError(
        "ARTIFACT_REJECTED",
        error.category === "SIZE_INVALID"
          ? 413
          : error.category === "MEDIA_TYPE_INVALID" || error.category === "EXTENSION_MISMATCH"
            ? 415
            : 422,
        "Artifact failed security validation",
        { category: error.category },
      );
    }
    const artifactId = randomUUID();
    const stored = await this.artifactStorage.put({
      tenantId: principal.tenantId,
      projectId,
      artifactId,
      originalFileName,
      mediaType: input.mediaType,
      body: input.body,
    });
    try {
      return await this.client.$transaction(
        async (transaction) => {
          const eventId = randomUUID();
          const createdAt = this.now().toISOString();
          const result = phase10ArtifactUploadResultSchema.parse({
            artifactId,
            originalFileName,
            mediaType: input.mediaType,
            sizeBytes: input.body.length,
            sha256,
            status: "AVAILABLE",
            eventId,
            createdAt,
            replayed: false,
          });
          await transaction.fileAsset.create({
            data: {
              id: artifactId,
              tenantId: principal.tenantId,
              projectId,
              bucket: stored.bucket,
              objectKey: stored.objectKey,
              originalFileName,
              mediaType: input.mediaType,
              sizeBytes: input.body.length,
              sha256,
              status: "AVAILABLE",
              uploadedByUserId: principal.userId,
            },
          });
          await transaction.auditLog.create({
            data: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              actorUserId: principal.userId,
              actorRole: authorized.role,
              action: "ARTIFACT_UPLOADED",
              entityType: "FILE_ASSET",
              entityId: artifactId,
              reason: "Phase 10 direct artifact upload",
              correlationId,
              sourceVersion: frontendSourceVersion,
              afterHash: sha256,
              metadata: jsonInput({
                originalFileName,
                mediaType: input.mediaType,
                malwareScannerId: securityInspection.malwareScan.scannerId,
                malwareSignatureVersion: securityInspection.malwareScan.signatureVersion,
                format: securityInspection.format,
              }),
            },
          });
          await transaction.outboxEvent.create({
            data: {
              id: eventId,
              tenantId: principal.tenantId,
              projectId,
              eventType: "ARTIFACT_UPLOADED",
              aggregateType: "FILE_ASSET",
              aggregateId: artifactId,
              aggregateVersion: 1,
              idempotencyKey: `outbox:${principal.tenantId}:${idempotencyKey}`,
              payload: jsonInput({
                artifactId,
                sha256,
                mediaType: input.mediaType,
                malwareScanStatus: securityInspection.malwareScan.status,
                malwareScannerId: securityInspection.malwareScan.scannerId,
              }),
              headers: jsonInput({ correlationId, schemaVersion: 1 }),
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              id: randomUUID(),
              tenantId: principal.tenantId,
              projectId,
              key: idempotencyKey,
              route: "PHASE10_ARTIFACT_UPLOAD",
              requestHash,
              responseStatus: 201,
              responseBody: jsonInput(result),
              actorUserId: principal.userId,
              expiresAt: new Date(Date.parse(createdAt) + 7 * 86_400_000),
            },
          });
          return result;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      await stored.remove();
      if (isPrismaConflict(error)) {
        const replay = await findIdempotencyAfterConflict(
          this.client,
          principal.tenantId,
          idempotencyKey,
        );
        if (replay !== null) {
          if (
            replay.projectId !== projectId ||
            replay.route !== "PHASE10_ARTIFACT_UPLOAD" ||
            replay.requestHash !== requestHash
          ) {
            throw new Phase9ApiError(
              "IDEMPOTENCY_CONFLICT",
              409,
              "Idempotency key was reused with different content",
            );
          }
          return phase10ArtifactUploadResultSchema.parse({
            ...(replay.responseBody as Record<string, unknown>),
            replayed: true,
          });
        }
        throw new Phase9ApiError(
          "OPTIMISTIC_LOCK_CONFLICT",
          409,
          "Concurrent artifact upload conflicted; retry with the same idempotency key",
        );
      }
      throw error;
    }
  }

  async answerA4(principal: Phase9AuthenticatedPrincipal, projectId: string, input: unknown) {
    await this.projects.requireProject(principal, projectId, "CHAT_READ");
    const request = phase10A4QuestionSchema.parse(input);
    const workspace = await this.workspace(principal, projectId);
    const question = request.question.toLocaleLowerCase("mn-MN");
    const claims: Array<{ text: string; sourceIds: string[] }> = [];
    const sources: Array<{
      sourceId: string;
      entityType: string;
      entityId: string;
      field: string;
      value: unknown;
    }> = [];
    const add = (
      text: string,
      entityType: string,
      entityId: string,
      field: string,
      value: unknown,
    ) => {
      const sourceId = `${entityType}:${entityId}:${field}`;
      sources.push({ sourceId, entityType, entityId, field, value });
      claims.push({ text, sourceIds: [sourceId] });
    };
    if (/төсөв|budget/u.test(question) && workspace.project.budgetMnt !== null) {
      add(
        `Төслийн батлагдсан төсөв ${workspace.project.budgetMnt} MNT байна.`,
        "PROJECT",
        projectId,
        "budgetMnt",
        workspace.project.budgetMnt,
      );
    }
    if (/зардал|cost/u.test(question) && workspace.project.actualCostMnt !== null) {
      add(
        `Төслийн бүртгэгдсэн бодит зардал ${workspace.project.actualCostMnt} MNT байна.`,
        "PROJECT",
        projectId,
        "actualCostMnt",
        workspace.project.actualCostMnt,
      );
    }
    if (/явц|гүйцэтгэл|progress/u.test(question)) {
      add(
        `Одоогийн жигнэсэн гүйцэтгэл ${workspace.dashboard.actualProgressPercent}% байна.`,
        "PROJECT_DASHBOARD",
        projectId,
        "actualProgressPercent",
        workspace.dashboard.actualProgressPercent,
      );
    }
    if (/дуус|хугацаа|finish|deadline|forecast/u.test(question)) {
      add(
        workspace.dashboard.projectedFinish === null
          ? `Батлагдсан төлөвлөгөөний дуусах огноо ${workspace.project.plannedEnd.slice(0, 10)}; шинэ forecast одоогоор байхгүй.`
          : `Төслийн projected finish ${workspace.dashboard.projectedFinish.slice(0, 10)} байна.`,
        workspace.dashboard.projectedFinish === null ? "PROJECT" : "FORECAST",
        projectId,
        workspace.dashboard.projectedFinish === null ? "plannedEnd" : "projectedFinish",
        workspace.dashboard.projectedFinish ?? workspace.project.plannedEnd,
      );
    }
    if (/ажил.*тоо|хэдэн ажил|work item/u.test(question)) {
      add(
        `Төсөлд ${workspace.workItems.length} ажлын мөр бүртгэлтэй байна.`,
        "WORK_ITEM_AGGREGATE",
        projectId,
        "count",
        workspace.workItems.length,
      );
    }
    if (/эрсдэл|alert|анхааруул/u.test(question)) {
      add(
        `Одоогоор ${workspace.dashboard.openAlertCount} нээлттэй alert илэрсэн байна.`,
        "ALERT_AGGREGATE",
        projectId,
        "openAlertCount",
        workspace.dashboard.openAlertCount,
      );
    }
    if (/critical|критик|чухал зам/u.test(question)) {
      add(
        `Critical activity-ийн тоо ${workspace.dashboard.criticalActivityCount} байна.`,
        "SCHEDULE_AGGREGATE",
        projectId,
        "criticalActivityCount",
        workspace.dashboard.criticalActivityCount,
      );
    }
    if (claims.length === 0) {
      return phase10A4AnswerSchema.parse({
        schemaVersion: 1,
        status: "INSUFFICIENT_EVIDENCE",
        answer: "Энэ асуултад зөвшөөрөгдсөн canonical өгөгдлөөс хангалттай нотолгоо олдсонгүй.",
        claims: [],
        sources: [],
        toolNames: ["getProjectWorkspace"],
      });
    }
    return phase10A4AnswerSchema.parse({
      schemaVersion: 1,
      status: "ANSWERED",
      answer: claims.map((claim) => claim.text).join(" "),
      claims,
      sources,
      toolNames: ["getProjectWorkspace"],
    });
  }
}
