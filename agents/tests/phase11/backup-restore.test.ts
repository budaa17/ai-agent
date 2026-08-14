import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPhase11Backup,
  phase11RestorePreludeSql,
  restorePhase11Backup,
  verifyPhase11BackupManifestSignature,
  type Phase11ProcessRunner,
} from "../../src/operations/index.js";

describe("BuildWatch Phase 11 backup and restore", () => {
  it("resets all application schemas before the transactional restore", () => {
    expect(phase11RestorePreludeSql).toBe(
      [
        "DROP SCHEMA IF EXISTS public CASCADE;",
        "DROP SCHEMA IF EXISTS pgboss CASCADE;",
        "CREATE SCHEMA public;",
        "CREATE SCHEMA pgboss;",
        "",
      ].join("\n"),
    );
  });

  it("mounts the writable artifact volume at the restore parent", async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const compose = await readFile(join(repositoryRoot, "docker-compose.production.yml"), "utf8");
    const parentMounts = compose.match(/- artifact-data:\/app\/data(?:\r?\n)/gu) ?? [];

    expect(parentMounts).toHaveLength(2);
    expect(compose).not.toContain("- artifact-data:/app/data/artifacts");
  });

  it("creates a signed database/artifact manifest and restores through staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildwatch-backup-"));
    const artifacts = join(root, "artifacts");
    const backups = join(root, "backups");
    const signingKey = "backup-signing-key-for-phase11-tests-001";
    const processCalls: Array<{ executable: string; args: readonly string[] }> = [];
    const runner: Phase11ProcessRunner = async (executable, args, environment) => {
      processCalls.push({ executable, args });
      expect(args.join(" ")).not.toContain("database-password");
      expect(environment.PGPASSWORD).toBe("database-password");
      if (executable === "pg_dump") {
        const fileIndex = args.indexOf("--file");
        await writeFile(args[fileIndex + 1]!, "deterministic-database-dump");
      }
    };
    try {
      await mkdir(join(artifacts, "tenant", "project"), { recursive: true });
      await writeFile(join(artifacts, "tenant", "project", "photo.png"), "original-artifact");
      const backup = await createPhase11Backup({
        databaseUrl:
          "postgresql://buildwatch:database-password@127.0.0.1:5432/buildwatch?sslmode=disable",
        artifactRoot: artifacts,
        backupRoot: backups,
        signingKey,
        appRelease: "phase11-test",
        now: () => new Date("2026-08-04T03:04:05.000Z"),
        processRunner: runner,
      });
      expect(backup.manifest.database.format).toBe("PG_CUSTOM");
      expect(backup.manifest.artifacts.files).toEqual([
        expect.objectContaining({ path: "tenant/project/photo.png", sizeBytes: 17 }),
      ]);
      expect(verifyPhase11BackupManifestSignature(backup.manifest, signingKey).backupId).toBe(
        backup.manifest.backupId,
      );

      await writeFile(join(artifacts, "tenant", "project", "photo.png"), "changed-after-backup");
      const restored = await restorePhase11Backup({
        backupDirectory: backup.directory,
        databaseUrl:
          "postgresql://buildwatch:database-password@127.0.0.1:5432/buildwatch?sslmode=disable",
        artifactRoot: artifacts,
        signingKey,
        confirmation: `RESTORE:${backup.manifest.backupId}`,
        nodeEnv: "test",
        allowProductionRestore: false,
        restoreProcessRunner: async ({ databaseDump, database, environment }) => {
          processCalls.push({
            executable: "restore-pipeline",
            args: [databaseDump, database],
          });
          expect(databaseDump).toBe(join(backup.directory, "database.dump"));
          expect(database).toBe("buildwatch");
          expect(environment.PGPASSWORD).toBe("database-password");
        },
      });
      expect(await readFile(join(artifacts, "tenant", "project", "photo.png"), "utf8")).toBe(
        "original-artifact",
      );
      expect(restored.preservedArtifactRoot).not.toBeNull();
      expect(processCalls.map((call) => call.executable)).toEqual(["pg_dump", "restore-pipeline"]);

      await expect(
        restorePhase11Backup({
          backupDirectory: backup.directory,
          databaseUrl:
            "postgresql://buildwatch:database-password@127.0.0.1:5432/buildwatch?sslmode=disable",
          artifactRoot: artifacts,
          signingKey,
          confirmation: `RESTORE:${backup.manifest.backupId}`,
          nodeEnv: "test",
          allowProductionRestore: false,
          restoreProcessRunner: async () => {
            throw new Error("restore runner must not be called");
          },
        }),
      ).rejects.toThrow("Artifact preservation path already exists");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed on signature tampering and production restore opt-in", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildwatch-backup-guard-"));
    const signingKey = "backup-signing-key-for-phase11-tests-002";
    const runner: Phase11ProcessRunner = async (executable, args) => {
      if (executable === "pg_dump") {
        await writeFile(args[args.indexOf("--file") + 1]!, "dump");
      }
    };
    try {
      const backup = await createPhase11Backup({
        databaseUrl: "postgresql://user:password@localhost:5432/buildwatch",
        artifactRoot: join(root, "missing-artifacts"),
        backupRoot: join(root, "backups"),
        signingKey,
        appRelease: "phase11-test",
        now: () => new Date("2026-08-04T04:00:00.000Z"),
        processRunner: runner,
      });
      expect(() =>
        verifyPhase11BackupManifestSignature(
          { ...backup.manifest, appRelease: "tampered" },
          signingKey,
        ),
      ).toThrow("signature is invalid");
      await expect(
        restorePhase11Backup({
          backupDirectory: backup.directory,
          databaseUrl: "postgresql://user:password@localhost:5432/buildwatch",
          artifactRoot: join(root, "restore-artifacts"),
          signingKey,
          confirmation: `RESTORE:${backup.manifest.backupId}`,
          nodeEnv: "production",
          allowProductionRestore: false,
        }),
      ).rejects.toThrow("PHASE11_ALLOW_PRODUCTION_RESTORE=true");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
