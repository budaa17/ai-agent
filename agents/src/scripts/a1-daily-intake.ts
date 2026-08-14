import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { createChatModel } from "../agent/index.js";
import {
  projectAnalysisSnapshotV1Schema,
  type ProjectAnalysisSnapshotV1,
} from "../contracts/index.js";
import { buildBuildWatchSimulation } from "../simulation/index.js";
import {
  extractDailyReportDraft,
  FileDailyReportReviewStore,
  loadProjectUpdateImage,
  resolveA1ModelRuntimeConfig,
} from "../structuring/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";
import { createLocalAgentRuntimeGuard } from "../runtime/index.js";

type Options = {
  help: boolean;
  text?: string;
  file?: string;
  images: string[];
  tenantId: string;
  projectId: string;
  referenceDate: string;
  requestId?: string;
  snapshotPath?: string;
  storeDirectory: string;
  modelId?: string;
  recordTelemetryContent: boolean;
};

const HELP = `
Usage:
  pnpm.cmd agent:a1:intake -- --text "<daily report>" [options]
  pnpm.cmd agent:a1:intake -- --file <utf8-file> [options]
  pnpm.cmd agent:a1:intake -- --image <image-file> [options]

Options:
  --text <value>                   Daily-report text
  --file <path>                    UTF-8 daily-report text file
  --image <path>                   PNG/JPEG/WEBP/GIF; repeat up to 5 times
  --tenant <id>                    Tenant scope (default: tenant-demo)
  --project <id>                   Project scope (default: project-buildwatch-simulation)
  --reference-date <YYYY-MM-DD>    Relative-date reference
  --request-id <id>                Idempotent request ID
  --snapshot <json>                ProjectAnalysisSnapshotV1 JSON
  --store <directory>              Review store (default: data/a1-review)
  --model <id>                     OpenAI model ID
  --record-telemetry-content       Allow source/output telemetry content
  --help                           Show help
`.trim();

function valueAfter(argv: string[], index: number, name: string): string {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function parseArguments(argv: string[]): Options {
  const options: Options = {
    help: false,
    images: [],
    tenantId: "tenant-demo",
    projectId: "project-buildwatch-simulation",
    referenceDate: new Date().toISOString().slice(0, 10),
    storeDirectory: "data/a1-review",
    recordTelemetryContent: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--") {
      continue;
    }

    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }

    if (argument === "--record-telemetry-content") {
      options.recordTelemetryContent = true;
      continue;
    }

    const value = valueAfter(argv, index, argument);
    index += 1;

    if (argument === "--text") {
      options.text = value;
    } else if (argument === "--file") {
      options.file = value;
    } else if (argument === "--image") {
      options.images.push(value);
    } else if (argument === "--tenant") {
      options.tenantId = value;
    } else if (argument === "--project") {
      options.projectId = value;
    } else if (argument === "--reference-date") {
      options.referenceDate = value;
    } else if (argument === "--request-id") {
      options.requestId = value;
    } else if (argument === "--snapshot") {
      options.snapshotPath = value;
    } else if (argument === "--store") {
      options.storeDirectory = value;
    } else if (argument === "--model") {
      options.modelId = value;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.text !== undefined && options.file !== undefined) {
    throw new Error("Use either --text or --file, not both");
  }

  if (options.images.length > 5) {
    throw new Error("Use at most 5 --image values");
  }

  if (
    !options.help &&
    options.text === undefined &&
    options.file === undefined &&
    options.images.length === 0
  ) {
    throw new Error("Either --text, --file, or --image is required");
  }

  return options;
}

async function loadSnapshot(options: Options): Promise<ProjectAnalysisSnapshotV1> {
  if (options.snapshotPath !== undefined) {
    const content = await readFile(path.resolve(options.snapshotPath), "utf8");
    return projectAnalysisSnapshotV1Schema.parse(JSON.parse(content));
  }

  const simulation = buildBuildWatchSimulation();

  if (
    options.tenantId !== simulation.snapshot.tenantId ||
    options.projectId !== simulation.snapshot.projectId
  ) {
    throw new Error(
      "A non-simulation project requires --snapshot <ProjectAnalysisSnapshotV1.json>",
    );
  }

  return simulation.snapshot;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }

  const sourceText =
    options.text ??
    (options.file === undefined ? undefined : await readFile(path.resolve(options.file), "utf8"));
  const loadedImages = await Promise.all(
    options.images.map((imagePath) => loadProjectUpdateImage(imagePath)),
  );
  const sourceImages = [...new Map(loadedImages.map((image) => [image.sha256, image])).values()];
  const snapshot = await loadSnapshot(options);
  const store = new FileDailyReportReviewStore(options.storeDirectory);
  const imageInputs = await Promise.all(
    sourceImages.map(async (image) => ({
      image,
      artifact: await store.saveSourceImage(image),
    })),
  );
  const existingDrafts = (await store.list())
    .filter(
      (record) => record.tenantId === options.tenantId && record.projectId === options.projectId,
    )
    .map((record) => record.draft);
  const modelConfig = resolveA1ModelRuntimeConfig(process.env, {
    help: false,
    modelId: options.modelId,
  });
  const telemetry = startLangfuseTelemetry(process.env);
  const runtimeGuard = createLocalAgentRuntimeGuard(process.env);

  try {
    const result = await extractDailyReportDraft({
      model: createChatModel(modelConfig),
      tenantId: options.tenantId,
      projectId: options.projectId,
      sourceText,
      sourceImages: imageInputs,
      referenceDate: options.referenceDate,
      requestId: options.requestId,
      projectSnapshot: snapshot,
      existingDrafts,
      recordTelemetryContent: options.recordTelemetryContent,
      runtimeGuard,
    });
    const saved = await store.saveIntake(result.draft);

    process.stdout.write(`${JSON.stringify(saved.record.draft, null, 2)}\n`);
    process.stdout.write(
      [
        `draftId=${saved.record.draftId}`,
        `status=${saved.record.status}`,
        `reused=${saved.reused ? "yes" : "no"}`,
        `provider=${modelConfig.provider}`,
        `model=${modelConfig.modelId}`,
        `finish=${result.finishReason}`,
        `images=${imageInputs.length}`,
        `store=${path.resolve(options.storeDirectory)}`,
      ].join(" ") + "\n",
    );
  } finally {
    await telemetry.shutdown();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`A1 daily intake failed: ${message}\n`);
  process.exitCode = 1;
});
