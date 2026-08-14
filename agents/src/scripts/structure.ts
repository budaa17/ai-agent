import "dotenv/config";

import { ZodError } from "zod";
import { createChatModel } from "../agent/index.js";
import { prisma } from "../prisma.js";
import {
  extractProjectUpdate,
  loadProjectUpdateImage,
  loadProjectUpdateTextFile,
  parseStructureCliArguments,
  registerProjectUpdateDraft,
  resolveA1StructureRuntimeConfig,
} from "../structuring/index.js";
import { startLangfuseTelemetry } from "../telemetry/index.js";
import {
  createLocalAgentRuntimeGuard,
  createProductionAgentRuntimeGuard,
} from "../runtime/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd structure -- --text "<project update>" [options]
  pnpm.cmd structure -- --file <utf8-file> [options]
  pnpm.cmd structure -- --image <image-file> [options]

Options:
  --text <value>                     Text to structure
  --file <path>                      UTF-8 text file to structure
  --image <path>                     PNG, JPEG, WEBP, or GIF to structure
  --reference-date <YYYY-MM-DD>      Date used for relative expressions
  --tenant <id-or-slug>              Draft tenant scope
  --project <id-or-code>             Optional draft project scope
  --model <id>                       OpenAI model ID
  --no-persist                       Print without saving the draft
  --record-telemetry-content         Send source and output to telemetry
  --help                             Show this help
`.trim();

function formatError(error: unknown) {
  if (error instanceof ZodError) {
    return error.issues
      .map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`)
      .join("; ");
  }

  return error instanceof Error ? error.message : String(error);
}

async function resolveSource(arguments_: ReturnType<typeof parseStructureCliArguments>) {
  const sourceText = arguments_.text
    ? arguments_.text
    : arguments_.file
      ? await loadProjectUpdateTextFile(arguments_.file)
      : undefined;
  const sourceImage = arguments_.image ? await loadProjectUpdateImage(arguments_.image) : undefined;

  if (!sourceText && !sourceImage) {
    throw new Error("Either --text, --file, or --image is required");
  }

  return { sourceText, sourceImage };
}

async function main() {
  const arguments_ = parseStructureCliArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  const source = await resolveSource(arguments_);
  const config = resolveA1StructureRuntimeConfig(process.env, arguments_);
  const telemetry = startLangfuseTelemetry(process.env);
  const model = createChatModel(config);
  const runtimeGuard = config.persist
    ? createProductionAgentRuntimeGuard(process.env, prisma)
    : createLocalAgentRuntimeGuard(process.env);
  const referenceDate = arguments_.referenceDate ?? new Date().toISOString().slice(0, 10);

  try {
    if (config.persist) {
      const result = await registerProjectUpdateDraft({
        tenantRef: config.tenantRef,
        projectRef: config.projectRef,
        sourceText: source.sourceText,
        sourceImage: source.sourceImage,
        referenceDate,
        model,
        provider: config.provider,
        modelId: config.modelId,
        recordTelemetryContent: arguments_.recordTelemetryContent,
        runtimeGuard,
      });

      console.log(JSON.stringify(result.draft, null, 2));
      console.log(
        `draftId=${result.draftId} status=${result.status} provider=${config.provider} model=${config.modelId} finish=${result.extraction?.finishReason ?? "reused"}`,
      );
    } else {
      const result = await extractProjectUpdate({
        model,
        sourceText: source.sourceText,
        sourceImage: source.sourceImage,
        referenceDate,
        recordTelemetryContent: arguments_.recordTelemetryContent,
        tenantId: config.tenantRef,
        runtimeGuard,
      });

      console.log(JSON.stringify(result.draft, null, 2));
      console.log(
        `persist=no provider=${config.provider} model=${config.modelId} finish=${result.finishReason}`,
      );
    }
  } finally {
    await prisma.$disconnect();
    await telemetry.shutdown();
  }
}

void main().catch((error) => {
  console.error(`Structure failed: ${formatError(error)}`);
  process.exitCode = 1;
});
