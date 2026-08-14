import "dotenv/config";
import { resolve } from "node:path";
import { runPhase11ArtifactLifecycle } from "../operations/index.js";
import { prisma } from "../prisma.js";

function numberArgument(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : Number(process.argv[index + 1]);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const decisions = await runPhase11ArtifactLifecycle(prisma, {
    apply,
    artifactRoot: resolve(process.env.PHASE9_ARTIFACT_ROOT ?? "data/artifacts"),
    limit: numberArgument("--limit", 100),
  });
  process.stdout.write(
    `${JSON.stringify({ mode: apply ? "apply" : "dry-run", decisions }, null, 2)}\n`,
  );
  if (!apply) process.stdout.write("Dry-run only. Add --apply after review.\n");
  if (decisions.some((decision) => decision.action === "FAILED")) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(
      `Phase 11 artifact lifecycle failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
