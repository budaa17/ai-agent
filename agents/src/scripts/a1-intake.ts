import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PgBoss } from "pg-boss";
import {
  createA1IntakeJobPayload,
  enqueueA1Intake,
  loadProjectUpdateImage,
  loadProjectUpdateTextFile,
  parseStructureCliArguments,
  DEFAULT_A1_TENANT_REF,
} from "../structuring/index.js";

const HELP_TEXT = `
Usage:
  pnpm.cmd a1:intake -- --text "<project update>" [options]
  pnpm.cmd a1:intake -- --file <utf8-file> [options]
  pnpm.cmd a1:intake -- --image <image-file> [options]

Options:
  --text <value>                     Text to enqueue
  --file <path>                      UTF-8 text file to enqueue
  --image <path>                     PNG, JPEG, WEBP, or GIF to enqueue
  --reference-date <YYYY-MM-DD>      Date used for relative expressions
  --tenant <id-or-slug>              Draft tenant scope
  --project <id-or-code>             Optional draft project scope
  --help                             Show this help
`.trim();

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  const arguments_ = parseStructureCliArguments(process.argv.slice(2));

  if (arguments_.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (arguments_.persist === false) {
    throw new Error("A1 intake jobs are always persisted");
  }

  const sourceText = arguments_.text
    ? arguments_.text
    : arguments_.file
      ? await loadProjectUpdateTextFile(arguments_.file)
      : undefined;
  const sourceImage = arguments_.image ? await loadProjectUpdateImage(arguments_.image) : undefined;
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is required to enqueue A1 intake");
  }

  const payload = createA1IntakeJobPayload({
    requestId: randomUUID(),
    tenantRef: arguments_.tenantRef ?? process.env.A1_TENANT_ID?.trim() ?? DEFAULT_A1_TENANT_REF,
    projectRef: arguments_.projectRef ?? (process.env.A1_PROJECT?.trim() || undefined) ?? undefined,
    referenceDate: arguments_.referenceDate ?? new Date().toISOString().slice(0, 10),
    source: {
      text: sourceText,
      image: sourceImage,
    },
  });
  const boss = new PgBoss(connectionString);

  boss.on("error", (error) => {
    console.error(`A1 intake pg-boss error: ${error.message}`);
  });

  await boss.start();

  try {
    const jobId = await enqueueA1Intake(boss, payload);
    console.log(`A1 intake queued: job=${jobId} request=${payload.requestId}`);
  } finally {
    await boss.stop({ graceful: true, timeout: 30_000 });
  }
}

void main().catch((error) => {
  console.error(`A1 intake failed: ${formatError(error)}`);
  process.exitCode = 1;
});
