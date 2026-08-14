import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { agentEventV1Schema, type AgentEventV1 } from "../contracts/agent-artifacts.js";
import {
  contractArtifactReferenceSchema,
  type ContractArtifactReference,
} from "../contracts/common.js";
import {
  approvedDailyReportCommandV1Schema,
  dailyReportDraftV1Schema,
  dailyReportStatusSchema,
  type ApprovedDailyReportCommandV1,
  type DailyReportDraftV1,
} from "../contracts/daily-report.js";
import {
  normalizeProjectUpdateSource,
  projectUpdateImageSourceProvenanceSchema,
  type ProjectUpdateImageMediaType,
  type ProjectUpdateImageSource,
} from "./source.js";

const imageExtensionByMediaType: Record<ProjectUpdateImageMediaType, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export const dailyReportReviewRecordV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    recordId: z.string().trim().min(1).max(200),
    draftId: z.string().trim().min(1).max(200),
    requestId: z.string().trim().min(1).max(200),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    tenantId: z.string().trim().min(1).max(200),
    projectId: z.string().trim().min(1).max(200),
    status: dailyReportStatusSchema,
    draft: dailyReportDraftV1Schema,
    humanEditedFieldPaths: z.array(z.string().trim().min(1).max(300)).max(2_000),
    approvedCommand: approvedDailyReportCommandV1Schema.nullable(),
    approvalEvent: agentEventV1Schema.nullable(),
    rejection: z
      .object({
        rejectedBy: z.string().trim().min(1).max(200),
        rejectedAt: z.string().datetime({ offset: true }),
        reason: z.string().trim().min(1).max(2_000),
      })
      .strict()
      .nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((record, context) => {
    if (
      record.draftId !== record.draft.draftId ||
      record.requestId !== record.draft.requestId ||
      record.tenantId !== record.draft.tenantId ||
      record.projectId !== record.draft.projectId ||
      record.status !== record.draft.status
    ) {
      context.addIssue({
        code: "custom",
        message: "Review record scope/status must match its draft",
        path: ["draft"],
      });
    }

    if (
      record.status === "APPROVED" &&
      (record.approvedCommand === null || record.approvalEvent === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Approved records require command and event artifacts",
        path: ["approvedCommand"],
      });
    }

    if (record.status === "REJECTED" && record.rejection === null) {
      context.addIssue({
        code: "custom",
        message: "Rejected records require rejection metadata",
        path: ["rejection"],
      });
    }
  });

export type DailyReportReviewRecordV1 = z.infer<typeof dailyReportReviewRecordV1Schema>;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceHash(draft: DailyReportDraftV1): string {
  return sha256(
    JSON.stringify({
      tenantId: draft.tenantId,
      projectId: draft.projectId,
      rawText: draft.rawText,
      sourceArtifacts: draft.sourceArtifacts,
    }),
  );
}

function collectChangedPaths(left: unknown, right: unknown, pathPrefix = ""): string[] {
  if (Object.is(left, right)) {
    return [];
  }

  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return [pathPrefix || "$"];
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return [pathPrefix || "$"];
    }

    const paths: string[] = [];
    const length = Math.max(left.length, right.length);

    for (let index = 0; index < length; index += 1) {
      paths.push(
        ...collectChangedPaths(
          left[index],
          right[index],
          `${pathPrefix}.${index}`.replace(/^\./, ""),
        ),
      );
    }

    return paths;
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)]);

  return [...keys].flatMap((key) =>
    collectChangedPaths(
      leftRecord[key],
      rightRecord[key],
      `${pathPrefix}.${key}`.replace(/^\./, ""),
    ),
  );
}

export class FileDailyReportReviewStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = path.resolve(directory);
  }

  async #ensureDirectory(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
  }

  #recordPath(draftId: string): string {
    if (!/^daily-draft-[a-f0-9]{20}$/.test(draftId)) {
      throw new Error(`Invalid daily-report draft ID: ${draftId}`);
    }

    return path.join(this.#directory, `${draftId}.json`);
  }

  async #write(record: DailyReportReviewRecordV1): Promise<void> {
    await this.#ensureDirectory();
    const parsed = dailyReportReviewRecordV1Schema.parse(record);
    const target = this.#recordPath(parsed.draftId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  }

  async saveSourceImage(input: ProjectUpdateImageSource): Promise<ContractArtifactReference> {
    const image = normalizeProjectUpdateSource({
      image: input,
    }).image!;
    await this.#ensureDirectory();
    const artifactDirectory = path.join(this.#directory, "artifacts");
    await mkdir(artifactDirectory, { recursive: true });
    const fileName = `${image.sha256}${imageExtensionByMediaType[image.mediaType]}`;
    const target = path.join(artifactDirectory, fileName);

    try {
      await writeFile(target, image.data, { flag: "wx" });
    } catch (error) {
      const alreadyExists =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST";

      if (!alreadyExists) {
        throw error;
      }

      const existing = await readFile(target);
      const existingSha256 = createHash("sha256").update(existing).digest("hex");

      if (existingSha256 !== image.sha256) {
        throw new Error(`Stored image artifact checksum mismatch: ${fileName}`, { cause: error });
      }
    }

    if (image.preprocessing !== undefined || image.security !== undefined) {
      const provenance = projectUpdateImageSourceProvenanceSchema.parse({
        schemaVersion: 1,
        preprocessing: image.preprocessing,
        security: image.security,
      });
      const provenanceContent = `${JSON.stringify(provenance, null, 2)}\n`;
      const provenanceSha256 = createHash("sha256").update(provenanceContent).digest("hex");
      const provenanceTarget = path.join(
        artifactDirectory,
        `${image.sha256}.${provenanceSha256.slice(0, 20)}.provenance.json`,
      );

      try {
        await writeFile(provenanceTarget, provenanceContent, {
          encoding: "utf8",
          flag: "wx",
        });
      } catch (error) {
        const alreadyExists =
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "EEXIST";

        if (!alreadyExists) {
          throw error;
        }

        const existing = await readFile(provenanceTarget, "utf8");

        if (existing !== provenanceContent) {
          throw new Error(`Stored image provenance mismatch: ${path.basename(provenanceTarget)}`, {
            cause: error,
          });
        }
      }
    }

    return contractArtifactReferenceSchema.parse({
      artifactId: `source-image-${image.sha256.slice(0, 20)}`,
      kind: "SOURCE_IMAGE",
      mediaType: image.mediaType,
      sha256: image.sha256,
      storageKey: `artifacts/${fileName}`,
      sizeBytes: image.data.byteLength,
    });
  }

  async get(draftId: string): Promise<DailyReportReviewRecordV1> {
    const content = await readFile(this.#recordPath(draftId), "utf8");
    return dailyReportReviewRecordV1Schema.parse(JSON.parse(content));
  }

  async list(): Promise<DailyReportReviewRecordV1[]> {
    await this.#ensureDirectory();
    const names = (await readdir(this.#directory))
      .filter((name) => /^daily-draft-[a-f0-9]{20}\.json$/.test(name))
      .sort();
    const records = await Promise.all(
      names.map(async (name) => {
        const content = await readFile(path.join(this.#directory, name), "utf8");
        return dailyReportReviewRecordV1Schema.parse(JSON.parse(content));
      }),
    );

    return records.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  }

  async saveIntake(
    input: DailyReportDraftV1,
    now = new Date().toISOString(),
  ): Promise<{
    record: DailyReportReviewRecordV1;
    reused: boolean;
  }> {
    const draft = dailyReportDraftV1Schema.parse(input);

    try {
      const existing = await this.get(draft.draftId);

      if (
        existing.requestId !== draft.requestId ||
        existing.tenantId !== draft.tenantId ||
        existing.projectId !== draft.projectId ||
        existing.sourceSha256 !== sourceHash(draft)
      ) {
        throw new Error(`Request ${draft.requestId} already exists with different scope or source`);
      }

      return { record: existing, reused: true };
    } catch (error) {
      const missing =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT";

      if (!missing) {
        throw error;
      }
    }

    const record = dailyReportReviewRecordV1Schema.parse({
      schemaVersion: 1,
      recordId: `review-${draft.draftId}`,
      draftId: draft.draftId,
      requestId: draft.requestId,
      sourceSha256: sourceHash(draft),
      tenantId: draft.tenantId,
      projectId: draft.projectId,
      status: draft.status,
      draft,
      humanEditedFieldPaths: [],
      approvedCommand: null,
      approvalEvent: null,
      rejection: null,
      createdAt: now,
      updatedAt: now,
    });
    await this.#write(record);
    return { record, reused: false };
  }

  async replaceDraft(
    draftId: string,
    replacementInput: DailyReportDraftV1,
    now = new Date().toISOString(),
  ): Promise<DailyReportReviewRecordV1> {
    const existing = await this.get(draftId);

    if (["APPROVED", "REJECTED"].includes(existing.status)) {
      throw new Error(`Cannot edit a terminal ${existing.status} draft`);
    }

    const replacement = dailyReportDraftV1Schema.parse(replacementInput);

    if (
      replacement.draftId !== existing.draftId ||
      replacement.requestId !== existing.requestId ||
      replacement.tenantId !== existing.tenantId ||
      replacement.projectId !== existing.projectId
    ) {
      throw new Error("Edited draft scope and identifiers are immutable");
    }

    if (!["READY_FOR_REVIEW", "NEEDS_CORRECTION"].includes(replacement.status)) {
      throw new Error("Edited draft status must remain reviewable");
    }

    const changed = collectChangedPaths(existing.draft, replacement).filter(
      (fieldPath) =>
        ![
          "status",
          "validationIssues",
          "clarificationQuestions",
          "overallConfidence",
          "confidenceLevel",
        ].some((systemPath) => fieldPath === systemPath || fieldPath.startsWith(`${systemPath}.`)),
    );
    const record = dailyReportReviewRecordV1Schema.parse({
      ...existing,
      status: replacement.status,
      draft: replacement,
      humanEditedFieldPaths: [...new Set([...existing.humanEditedFieldPaths, ...changed])].sort(),
      updatedAt: now,
    });
    await this.#write(record);
    return record;
  }

  async approve(
    draftId: string,
    reviewedBy: string,
    reviewNote: string | null,
    reviewedAt = new Date().toISOString(),
  ): Promise<DailyReportReviewRecordV1> {
    const existing = await this.get(draftId);

    if (existing.status === "APPROVED") {
      return existing;
    }

    if (existing.status === "REJECTED") {
      throw new Error("Rejected draft cannot be approved");
    }

    const approvedDraft = {
      ...existing.draft,
      status: "APPROVED" as const,
    };
    const command: ApprovedDailyReportCommandV1 = approvedDailyReportCommandV1Schema.parse({
      schemaVersion: 1,
      commandType: "APPROVE_DAILY_REPORT",
      commandId: `command-${existing.draftId}`,
      idempotencyKey: `approve:${existing.tenantId}:${existing.projectId}:${existing.draftId}`,
      tenantId: existing.tenantId,
      projectId: existing.projectId,
      draftId: existing.draftId,
      reviewedBy,
      reviewedAt,
      approvedDraft,
      humanEditedFieldPaths: existing.humanEditedFieldPaths,
      reviewNote,
    });
    const event: AgentEventV1 = agentEventV1Schema.parse({
      schemaVersion: 1,
      eventId: `event-${existing.draftId}`,
      eventType: "PROJECT_EXECUTION_APPROVED",
      tenantId: existing.tenantId,
      projectId: existing.projectId,
      aggregateId: existing.draftId,
      aggregateVersion: 1,
      occurredAt: reviewedAt,
      idempotencyKey: command.idempotencyKey,
      payload: {
        commandId: command.commandId,
        draftId: existing.draftId,
        reviewedBy,
      },
    });
    const record = dailyReportReviewRecordV1Schema.parse({
      ...existing,
      status: "APPROVED",
      draft: approvedDraft,
      approvedCommand: command,
      approvalEvent: event,
      rejection: null,
      updatedAt: reviewedAt,
    });
    await this.#write(record);
    return record;
  }

  async reject(
    draftId: string,
    rejectedBy: string,
    reason: string,
    rejectedAt = new Date().toISOString(),
  ): Promise<DailyReportReviewRecordV1> {
    const existing = await this.get(draftId);

    if (existing.status === "APPROVED") {
      throw new Error("Approved draft cannot be rejected");
    }

    if (existing.status === "REJECTED") {
      return existing;
    }

    const rejectedDraft = {
      ...existing.draft,
      status: "REJECTED" as const,
    };
    const record = dailyReportReviewRecordV1Schema.parse({
      ...existing,
      status: "REJECTED",
      draft: rejectedDraft,
      rejection: {
        rejectedBy,
        rejectedAt,
        reason,
      },
      updatedAt: rejectedAt,
    });
    await this.#write(record);
    return record;
  }
}
