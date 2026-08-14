import "dotenv/config";

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { createChatModel } from "../agent/index.js";
import {
  a1RealImageEvaluationCaseV1Schema,
  a1RealImageEvaluationManifestV1Schema,
  assertReleaseReadyImageWorkspace,
} from "../phase2/index.js";
import { createLocalAgentRuntimeGuard } from "../runtime/index.js";
import {
  extractDailyReportDraft,
  loadProjectUpdateImage,
  resolveA1ModelRuntimeConfig,
} from "../structuring/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";

function valueAfter(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function optionalValueAfter(args: readonly string[], name: string) {
  return args.includes(name) ? valueAfter(args, name) : undefined;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const predictionCheckpointV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    datasetId: z.string().trim().min(1).max(200),
    workspaceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    cases: z.array(a1RealImageEvaluationCaseV1Schema).max(10_000),
  })
  .strict();

async function readOptionalJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    const missing =
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT";

    if (missing) {
      return null;
    }

    throw error;
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function main() {
  const args = process.argv.slice(2).filter((item) => item !== "--");
  const workspacePath = path.resolve(valueAfter(args, "--workspace"));
  const outputPath = path.resolve(valueAfter(args, "--output"));
  const modelId = args.includes("--model") ? valueAfter(args, "--model") : undefined;
  const delayMs = z.coerce
    .number()
    .int()
    .min(0)
    .max(60_000)
    .parse(optionalValueAfter(args, "--delay-ms") ?? "250");
  const workspaceText = await readFile(workspacePath, "utf8");
  const workspaceSha256 = sha256(workspaceText);
  const workspace = assertReleaseReadyImageWorkspace(JSON.parse(workspaceText));
  const checkpointPath = `${outputPath}.progress.json`;

  if (args.includes("--fresh")) {
    await rm(checkpointPath, { force: true });
  }

  const checkpointInput = args.includes("--fresh") ? null : await readOptionalJson(checkpointPath);
  const checkpoint =
    checkpointInput === null ? null : predictionCheckpointV1Schema.parse(checkpointInput);

  if (
    checkpoint !== null &&
    (checkpoint.datasetId !== workspace.datasetId || checkpoint.workspaceSha256 !== workspaceSha256)
  ) {
    throw new Error(
      "Prediction checkpoint does not match the reviewed workspace; use --fresh after verifying label changes",
    );
  }

  const modelConfig = resolveA1ModelRuntimeConfig(process.env, {
    help: false,
    modelId,
  });
  const model = createChatModel(modelConfig);
  const runtimeGuard = createLocalAgentRuntimeGuard(process.env);
  const telemetry = startLangfuseTelemetry(process.env);
  const cases = [...(checkpoint?.cases ?? [])];
  const completedCaseIds = new Set(cases.map((item) => item.golden.caseId));

  try {
    for (const [index, annotation] of workspace.cases.entries()) {
      if (completedCaseIds.has(annotation.caseId)) {
        process.stdout.write(
          `[${index + 1}/${workspace.cases.length}] ${annotation.caseId} (resumed)\n`,
        );
        continue;
      }

      const image = await loadProjectUpdateImage(
        path.resolve(path.dirname(workspacePath), annotation.artifactPath),
      );
      const artifact = {
        artifactId: annotation.caseId,
        kind: "SOURCE_IMAGE" as const,
        mediaType: image.mediaType,
        sha256: image.sha256,
        storageKey: annotation.artifactPath.replaceAll("\\", "/"),
        sizeBytes: image.data.byteLength,
      };
      const result = await extractDailyReportDraft({
        model,
        tenantId: "tenant-evaluation",
        projectId: "project-anonymized-evaluation",
        sourceText: annotation.sourceText ?? undefined,
        sourceImages: [{ image, artifact }],
        referenceDate: new Date().toISOString().slice(0, 10),
        requestId: `phase2-real-image-${annotation.caseId}`,
        runtimeGuard,
        telemetryEnabled: true,
        recordTelemetryContent: false,
      });
      const predictedKinds = [
        ...new Set(result.draft.photoObservations.map((observation) => observation.kind)),
      ];
      const visibleRegionEvidence =
        predictedKinds.length === 0 ||
        result.draft.photoObservations.every((observation) =>
          observation.evidence.some(
            (evidence) => evidence.sourceType === "IMAGE" && evidence.imageRegion !== null,
          ),
        );
      const numericProgress = result.draft.progressEntries.some(
        (entry) => entry.progressPercent !== null,
      );
      const groundedProgress = result.draft.fieldConfidence.some(
        (field) =>
          field.fieldPath.endsWith(".progressPercent") &&
          field.evidence.some(
            (evidence) => evidence.sourceType === "IMAGE" && evidence.imageRegion !== null,
          ),
      );

      cases.push({
        golden: {
          schemaVersion: 1 as const,
          caseId: annotation.caseId,
          synthetic: false as const,
          sceneFamily: annotation.sceneFamily!,
          difficulty: annotation.difficulty!,
          description:
            annotation.notes ?? `Human-reviewed anonymized image: ${annotation.sourceFileName}`,
          expectedKinds: annotation.expectedKinds,
          forbidAutomaticAlert: true as const,
          forbidAutomaticSafetyDecision: true as const,
          forbidUngroundedNumericProgress: true as const,
          requireVisibleRegionEvidence: annotation.requireVisibleRegionEvidence!,
          artifactSha256: image.sha256,
          sourceText: annotation.sourceText,
        },
        prediction: {
          caseId: annotation.caseId,
          predictedKinds,
          automaticAlertCreated: false,
          automaticSafetyDecisionCreated: false,
          ungroundedNumericProgressClaim: numericProgress && !groundedProgress,
          visibleRegionEvidence,
        },
      });
      completedCaseIds.add(annotation.caseId);
      await writeJsonAtomic(checkpointPath, {
        schemaVersion: 1,
        datasetId: workspace.datasetId,
        workspaceSha256,
        cases,
      });
      process.stdout.write(`[${index + 1}/${workspace.cases.length}] ${annotation.caseId}\n`);

      if (delayMs > 0 && index < workspace.cases.length - 1) {
        await delay(delayMs);
      }
    }
  } finally {
    await telemetry.shutdown();
  }

  const manifest = a1RealImageEvaluationManifestV1Schema.parse({
    schemaVersion: 1,
    datasetId: workspace.datasetId,
    reviewedBy: workspace.reviewedBy,
    reviewedAt: workspace.reviewedAt,
    anonymized: true,
    collectionConsentConfirmed: true,
    cases,
  });
  await writeJsonAtomic(outputPath, manifest);
  await rm(checkpointPath, { force: true });
  process.stdout.write(
    `${JSON.stringify({
      status: "PREDICTIONS_COMPLETE",
      cases: manifest.cases.length,
      provider: modelConfig.provider,
      model: modelConfig.modelId,
      manifest: outputPath,
    })}\n`,
  );
}

main().catch((error) => {
  console.error(
    `A1 image prediction failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
