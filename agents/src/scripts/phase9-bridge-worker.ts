import "dotenv/config";
import { PgBoss } from "pg-boss";
import {
  PHASE9_BRIDGE_QUEUES,
  UNROUTED_PHASE9_QUEUES,
  registerPhase9BridgeWorker,
} from "../jobs/phase9-bridge.js";
import { createAgentLogger, startSentryErrorReporter } from "../runtime/logging.js";

async function main() {
  const logger = createAgentLogger({ service: "buildwatch-phase9-bridge-worker" });
  const errorReporter = startSentryErrorReporter();
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.trim() === "") {
    throw new Error("DATABASE_URL is required");
  }
  const boss = new PgBoss(connectionString);
  boss.on("error", (error) => {
    errorReporter.captureException(error);
    logger.error("phase9_bridge_boss_error", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
  });
  await boss.start();
  const workerIds = await registerPhase9BridgeWorker(boss);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await boss.stop({ graceful: true, timeout: 30_000 });
    await errorReporter.flush();
    logger.info("phase9_bridge_worker_stopped");
  };
  process.once("SIGINT", () => {
    stop().catch(() => (process.exitCode = 1));
  });
  process.once("SIGTERM", () => {
    stop().catch(() => (process.exitCode = 1));
  });

  logger.info("phase9_bridge_worker_started", {
    bridgedQueues: [...PHASE9_BRIDGE_QUEUES],
    unroutedQueues: [...UNROUTED_PHASE9_QUEUES],
    workerIds,
    sentryEnabled: errorReporter.enabled,
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 9 bridge worker failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
