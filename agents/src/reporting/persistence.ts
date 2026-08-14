import { createHash, randomUUID } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import { A3DocumentDraftStatus, AgentRunStatus, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { toInputJson } from "../recommendations/persistence.js";
import { a3DocumentBundleSchema, a3DocumentSchema, type A3DocumentBundle } from "./document.js";

const a3DocumentTriggerSchema = z.enum(["ON_DEMAND", "REQUEST", "SCHEDULED"]);

const persistA3DocumentBundleInputSchema = z
  .object({
    trigger: a3DocumentTriggerSchema,
    provider: z.string().trim().min(1).max(200),
    modelId: z.string().trim().min(1).max(200),
    langfuseTraceId: z.string().trim().min(1).max(200).optional(),
    artifactDirectory: z.string().trim().min(1).optional(),
  })
  .strict();

const reviewA3DocumentDraftInputSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    draftId: z.string().trim().min(1),
    decision: z.enum(["APPROVE", "REJECT"]),
    reviewedBy: z.string().trim().min(1).max(500),
    note: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();

export type A3DocumentTrigger = z.infer<typeof a3DocumentTriggerSchema>;

function artifactPath(
  directory: string | undefined,
  type: A3DocumentBundle["documents"][number]["type"],
) {
  if (!directory) {
    return null;
  }

  const fileNames = {
    PROJECT_REPORT: "project-report.md",
    EXECUTIVE_CONCLUSION: "executive-conclusion.md",
    OFFICIAL_LETTER: "official-letter.md",
  } as const;

  const candidate = `${directory.replace(/[\\/]+$/u, "")}/${fileNames[type]}`;
  const storageKey = (
    isAbsolute(candidate) ? relative(process.cwd(), resolve(candidate)) : candidate
  ).replaceAll("\\", "/");

  if (storageKey.startsWith("../") || storageKey === ".." || storageKey.startsWith("/")) {
    return null;
  }

  return storageKey;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function persistA3DocumentBundle(
  bundleInput: A3DocumentBundle,
  input: z.input<typeof persistA3DocumentBundleInputSchema>,
  client: PrismaClient = prisma,
) {
  const bundle = a3DocumentBundleSchema.parse(bundleInput);
  const metadata = persistA3DocumentBundleInputSchema.parse(input);
  const existing = await client.a3DocumentDraft.findMany({
    where: {
      requestId: bundle.requestId,
      tenantId: bundle.tenantId,
      projectId: bundle.projectId,
    },
    orderBy: { type: "asc" },
  });

  if (existing.length > 0) {
    if (existing.length !== bundle.documents.length) {
      throw new Error(`A3 request ${bundle.requestId} has a partial persisted document bundle`);
    }

    return {
      runId: existing[0]?.agentRunId ?? null,
      draftIds: existing.map((draft) => draft.id),
      reused: true,
    };
  }

  const runId = randomUUID();
  const startedAt = new Date();
  const drafts = bundle.documents.map((document) => ({
    id: randomUUID(),
    requestId: bundle.requestId,
    tenantId: bundle.tenantId,
    projectId: bundle.projectId,
    agentRunId: runId,
    type: document.type,
    title: document.title,
    content: toInputJson(document),
    sourceAsOf: new Date(bundle.asOf),
    trigger: metadata.trigger,
    artifactPath: artifactPath(metadata.artifactDirectory, document.type),
  }));

  await client.$transaction(async (transaction) => {
    await transaction.agentRun.create({
      data: {
        id: runId,
        tenantId: bundle.tenantId,
        projectId: bundle.projectId,
        agentType: "A3_DOCUMENT",
        status: AgentRunStatus.COMPLETED,
        trigger: metadata.trigger === "ON_DEMAND" ? "MANUAL" : metadata.trigger,
        requestId: bundle.requestId,
        promptVersion: "a3-document-v2",
        toolBundleVersion: "a3-evidence-tools-v2",
        outputSchemaVersion: 1,
        provider: metadata.provider,
        modelId: metadata.modelId,
        asOf: new Date(bundle.asOf),
        request: toInputJson({
          requestId: bundle.requestId,
          trigger: metadata.trigger,
          documentTypes: bundle.documents.map((document) => document.type),
        }),
        output: toInputJson(bundle),
        outputSha256: sha256(bundle),
        validation: toInputJson({
          valid: true,
          documentCount: bundle.documents.length,
          pendingApprovalCount: bundle.documents.length,
        }),
        langfuseTraceId: metadata.langfuseTraceId,
        traceId: metadata.langfuseTraceId,
        dataSnapshotVersion: sha256({
          tenantId: bundle.tenantId,
          projectId: bundle.projectId,
          asOf: bundle.asOf,
        }),
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimatedCostMicroUsd: 0,
        actualCostMicroUsd: 0,
        latencyMs: Math.max(0, Date.now() - startedAt.getTime()),
        retryCount: 0,
        failureCategory: "NONE",
        contentLoggingEnabled: false,
        startedAt,
        completedAt: new Date(),
      },
    });
    await transaction.a3DocumentDraft.createMany({ data: drafts });
  });

  return {
    runId,
    draftIds: drafts.map((draft) => draft.id),
    reused: false,
  };
}

export async function reviewA3DocumentDraft(
  input: z.input<typeof reviewA3DocumentDraftInputSchema>,
  client: PrismaClient = prisma,
) {
  const review = reviewA3DocumentDraftInputSchema.parse(input);
  const draft = await client.a3DocumentDraft.findFirst({
    where: {
      id: review.draftId,
      tenantId: review.tenantId,
    },
  });

  if (!draft) {
    throw new Error("A3 document draft was not found in tenant scope");
  }

  const targetStatus =
    review.decision === "APPROVE" ? A3DocumentDraftStatus.APPROVED : A3DocumentDraftStatus.REJECTED;

  if (draft.status !== A3DocumentDraftStatus.PENDING_APPROVAL) {
    if (draft.status === targetStatus) {
      return {
        draftId: draft.id,
        status: draft.status,
        reused: true,
      };
    }

    throw new Error(`A3 document draft is already ${draft.status}`);
  }

  const updated = await client.a3DocumentDraft.update({
    where: { id: draft.id },
    data: {
      status: targetStatus,
      reviewedBy: review.reviewedBy,
      reviewNote: review.note,
      reviewedAt: new Date(),
    },
  });

  return {
    draftId: updated.id,
    status: updated.status,
    reused: false,
  };
}

export async function loadA3DocumentDraft(
  input: { tenantId: string; draftId: string },
  client: PrismaClient = prisma,
) {
  const draft = await client.a3DocumentDraft.findFirst({
    where: {
      id: input.draftId,
      tenantId: input.tenantId,
    },
  });

  if (!draft) {
    throw new Error("A3 document draft was not found in tenant scope");
  }

  return {
    ...draft,
    content: a3DocumentSchema.parse(draft.content),
  };
}
