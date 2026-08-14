import "dotenv/config";
import { resolve } from "node:path";
import { createPhase11Backup } from "../operations/index.js";

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const signingKey = process.env.PHASE11_BACKUP_SIGNING_KEY?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!signingKey) throw new Error("PHASE11_BACKUP_SIGNING_KEY is required");
  const result = await createPhase11Backup({
    databaseUrl,
    artifactRoot: resolve(process.env.PHASE9_ARTIFACT_ROOT ?? "data/artifacts"),
    backupRoot: resolve(process.env.PHASE11_BACKUP_ROOT ?? "backups"),
    signingKey,
    appRelease: process.env.APP_RELEASE?.trim() || "development",
  });
  process.stdout.write(
    `Phase 11 backup completed: ${result.manifest.backupId}\nDirectory: ${result.directory}\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Phase 11 backup failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
