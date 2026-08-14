import type { PrismaClient } from "@prisma/client";

function metricSuffix(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

export async function collectPhase11OperationalGauges(
  client: PrismaClient,
  now = new Date(),
): Promise<Record<string, number>> {
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const month = now.toISOString().slice(0, 7);
  const [outbox, artifacts, reviewBacklog, usage, runs, failures, forecasts] = await Promise.all([
    client.outboxEvent.groupBy({ by: ["status"], _count: { _all: true } }),
    client.fileAsset.groupBy({ by: ["status"], _count: { _all: true } }),
    client.reviewTask.count({
      where: { status: { in: ["DRAFT", "REVIEW_REQUIRED"] } },
    }),
    client.agentUsageBudget.aggregate({
      where: { month },
      _sum: { usedMicroUsd: true },
    }),
    client.agentRun.aggregate({
      where: { startedAt: { gte: dayAgo } },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        estimatedCostMicroUsd: true,
      },
      _count: { _all: true },
    }),
    client.agentRun.groupBy({
      by: ["failureCategory"],
      where: {
        startedAt: { gte: dayAgo },
        status: { in: ["FAILED", "DEGRADED", "REJECTED"] },
      },
      _count: { _all: true },
      orderBy: { _count: { failureCategory: "desc" } },
      take: 50,
    }),
    client.forecastSnapshot.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 500,
      select: { projectId: true, delayDays: true },
    }),
  ]);

  const gauges: Record<string, number> = {
    review_backlog: reviewBacklog,
    agent_monthly_cost_micro_usd: usage._sum.usedMicroUsd ?? 0,
    agent_runs_24h: runs._count._all,
    agent_input_tokens_24h: runs._sum.inputTokens ?? 0,
    agent_output_tokens_24h: runs._sum.outputTokens ?? 0,
    agent_estimated_cost_micro_usd_24h: runs._sum.estimatedCostMicroUsd ?? 0,
  };
  for (const item of outbox) {
    gauges[`outbox_${metricSuffix(item.status)}`] = item._count._all;
  }
  for (const item of artifacts) {
    gauges[`artifact_${metricSuffix(item.status)}`] = item._count._all;
  }

  let imageFailures = 0;
  let quantityFailures = 0;
  for (const item of failures) {
    const suffix = metricSuffix(item.failureCategory || "unknown");
    gauges[`agent_failure_${suffix}_24h`] = item._count._all;
    if (/(?:image|vision|photo|ocr)/u.test(suffix)) imageFailures += item._count._all;
    if (/(?:quantity|boq|estimate|takeoff)/u.test(suffix)) quantityFailures += item._count._all;
  }
  gauges.agent_image_failures_24h = imageFailures;
  gauges.agent_quantity_failures_24h = quantityFailures;

  const latestByProject = new Map<string, number>();
  const completedProjects = new Set<string>();
  const driftValues: number[] = [];
  for (const forecast of forecasts) {
    if (forecast.delayDays === null || completedProjects.has(forecast.projectId)) continue;
    const delay = Number(forecast.delayDays.toString());
    const latest = latestByProject.get(forecast.projectId);
    if (latest === undefined) latestByProject.set(forecast.projectId, delay);
    else {
      driftValues.push(Math.abs(latest - delay));
      completedProjects.add(forecast.projectId);
    }
  }
  gauges.forecast_drift_project_count = driftValues.length;
  gauges.forecast_drift_days_average =
    driftValues.length === 0
      ? 0
      : driftValues.reduce((sum, value) => sum + value, 0) / driftValues.length;
  gauges.forecast_drift_days_max = driftValues.length === 0 ? 0 : Math.max(...driftValues);
  return gauges;
}
