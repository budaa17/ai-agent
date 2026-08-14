import "dotenv/config";
import { resolve } from "node:path";
import { restorePhase11Backup } from "../operations/index.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const backup = argument("--backup");
  const confirmation = argument("--confirm");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const signingKey = process.env.PHASE11_BACKUP_SIGNING_KEY?.trim();
  if (!backup) throw new Error("--backup <directory> is required");
  if (!confirmation) throw new Error("--confirm RESTORE:<backup-id> is required");
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!signingKey) throw new Error("PHASE11_BACKUP_SIGNING_KEY is required");
  const result = await restorePhase11Backup({
    backupDirectory: resolve(backup),
    databaseUrl,
    artifactRoot: resolve(process.env.PHASE9_ARTIFACT_ROOT ?? "data/artifacts"),
    signingKey,
    confirmation,
    nodeEnv: process.env.NODE_ENV ?? "development",
    allowProductionRestore: process.env.PHASE11_ALLOW_PRODUCTION_RESTORE?.toLowerCase() === "true",
  });
  process.stdout.write(
    `Phase 11 restore completed: ${result.manifest.backupId}\nPreserved artifacts: ${result.preservedArtifactRoot ?? "none"}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 11 restore failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
