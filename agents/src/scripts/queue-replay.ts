import "dotenv/config";

import { PgBoss } from "pg-boss";
import { PROJECT_ANALYSIS_QUEUE } from "../analysis/index.js";
import { A2_OBSERVATION_QUEUE } from "../recommendations/index.js";
import { A3_DOCUMENT_QUEUE } from "../reporting/index.js";
import { replayDeadLetterQueue } from "../runtime/index.js";
import { A1_INTAKE_QUEUE } from "../structuring/index.js";

const allowedQueues = new Set([
  A1_INTAKE_QUEUE,
  A2_OBSERVATION_QUEUE,
  A3_DOCUMENT_QUEUE,
  PROJECT_ANALYSIS_QUEUE,
]);

function queueArgument(args: readonly string[]) {
  const index = args.indexOf("--queue");
  const value = index < 0 ? undefined : args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error("--queue requires a value");
  }

  if (!allowedQueues.has(value)) {
    throw new Error(`Queue must be one of: ${[...allowedQueues].join(", ")}`);
  }

  return value;
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for queue replay");
  }

  const queue = queueArgument(process.argv.slice(2).filter((arg) => arg !== "--"));
  const boss = new PgBoss(connectionString);
  await boss.start();

  try {
    const replayed = await replayDeadLetterQueue(boss, queue);
    process.stdout.write(`${JSON.stringify({ queue, replayed })}\n`);
  } finally {
    await boss.stop({ graceful: true, timeout: 10_000 });
  }
}

main().catch((error) => {
  console.error(`Queue replay failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
