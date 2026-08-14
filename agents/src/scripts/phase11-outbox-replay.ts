import "dotenv/config";
import { replayPhase11OutboxEvent } from "../operations/index.js";
import { prisma } from "../prisma.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const eventId = argument("--event");
  const tenantId = argument("--tenant");
  const projectId = argument("--project");
  const reason = argument("--reason");
  if (!eventId || !tenantId || !projectId || !reason) {
    throw new Error("--event, --tenant, --project, and --reason are required");
  }
  const result = await replayPhase11OutboxEvent(prisma, {
    eventId,
    tenantId,
    projectId,
    reason,
    apply: process.argv.includes("--apply"),
    allowFailed: process.argv.includes("--allow-failed"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.applied) process.stdout.write("Dry-run only. Add --apply after review.\n");
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Phase 11 outbox replay failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
