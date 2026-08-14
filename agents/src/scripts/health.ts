import "dotenv/config";

import { PgBoss } from "pg-boss";
import { AGENT_QUEUE_NAMES } from "../jobs/queue-names.js";
import { agentModelPricingConfigured, resolveAgentRuntimeBudgetConfig } from "../runtime/guard.js";
import { deadLetterQueueName } from "../runtime/queue.js";

const knownQueues = [...AGENT_QUEUE_NAMES];

async function main() {
  const ready = process.argv.includes("--ready");
  const result: Record<string, unknown> = {
    status: "ok",
    mode: ready ? "readiness" : "liveness",
    node: process.version,
    timestamp: new Date().toISOString(),
  };

  if (!ready) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const connectionString = process.env.DATABASE_URL?.trim();
  const worker = process.env.AGENT_WORKER?.trim().toLowerCase();
  const requiresOpenAi =
    process.env.AGENT_HEALTH_REQUIRE_OPENAI?.toLowerCase() === "true" ||
    worker === "a1" ||
    worker === "a2";
  const budget = resolveAgentRuntimeBudgetConfig(process.env);
  const pricingConfigured = agentModelPricingConfigured(budget);

  result.modelRuntime = {
    worker: worker ?? null,
    requiresOpenAi,
    pricingConfigured,
    maxInputTokens: budget.maxInputTokens,
    maxOutputTokens: budget.maxOutputTokens,
    maxRunCostMicroUsd: budget.maxRunCostMicroUsd,
    maxTenantMonthlyCostMicroUsd: budget.maxTenantMonthlyCostMicroUsd,
  };

  if (!connectionString) {
    throw new Error("DATABASE_URL is required for readiness");
  }

  if (requiresOpenAi && !process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required by the readiness policy");
  }

  if (requiresOpenAi && !pricingConfigured) {
    throw new Error("OpenAI pricing must be configured for the production budget policy");
  }

  const boss = new PgBoss(connectionString);
  await boss.start();

  try {
    const queueStates = await boss.getQueues([
      ...knownQueues,
      ...knownQueues.map(deadLetterQueueName),
    ]);
    result.queues = queueStates.map((queue) => ({
      name: queue.name,
      readyCount: queue.readyCount,
      activeCount: queue.activeCount,
      failedCount: queue.failedCount,
    }));
    result.database = "reachable";
  } finally {
    await boss.stop({ graceful: true, timeout: 5_000 });
  }

  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    })}\n`,
  );
  process.exitCode = 1;
});
