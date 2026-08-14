import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";

const backupFileSchema = z
  .object({
    path: z.string().min(1).max(2_000),
    sizeBytes: z.number().int().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();

export const phase11BackupManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    backupId: z.string().regex(/^buildwatch-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$/u),
    generatedAt: z.string().datetime({ offset: true }),
    appRelease: z.string().min(1).max(200),
    database: backupFileSchema.extend({ format: z.literal("PG_CUSTOM") }).strict(),
    artifacts: z.object({ files: z.array(backupFileSchema).max(100_000) }).strict(),
    signature: z
      .object({
        algorithm: z.literal("HMAC-SHA256"),
        value: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict();

export type Phase11BackupManifest = z.infer<typeof phase11BackupManifestSchema>;

export type Phase11ProcessRunner = (
  executable: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv,
) => Promise<void>;

export type Phase11RestoreProcessRunner = (input: {
  databaseDump: string;
  database: string;
  environment: NodeJS.ProcessEnv;
}) => Promise<void>;

export const phase11RestorePreludeSql = [
  "DROP SCHEMA IF EXISTS public CASCADE;",
  "DROP SCHEMA IF EXISTS pgboss CASCADE;",
  "CREATE SCHEMA public;",
  "CREATE SCHEMA pgboss;",
  "",
].join("\n");

export const runPhase11Process: Phase11ProcessRunner = (executable, args, environment) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(executable, [...args], {
      env: environment,
      shell: false,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${executable} exited with ${code ?? signal ?? "unknown"}`));
    });
  });

function boundedProcessError(value: string): string {
  return value
    .replace(/[\r\n\u0000-\u001f]+/gu, " ")
    .trim()
    .slice(-4_000);
}

export const runPhase11RestoreProcess: Phase11RestoreProcessRunner = ({
  databaseDump,
  database,
  environment,
}) =>
  new Promise((resolvePromise, reject) => {
    const pgRestore = spawn(
      "pg_restore",
      ["--clean", "--if-exists", "--no-owner", "--no-acl", "--file=-", databaseDump],
      {
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    const psql = spawn(
      "psql",
      ["--no-psqlrc", "--set=ON_ERROR_STOP=1", "--single-transaction", "--dbname", database],
      {
        env: environment,
        shell: false,
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let settled = false;
    let restoreSucceeded = false;
    let restoreError = "";
    let psqlError = "";
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error === undefined) {
        resolvePromise();
        return;
      }
      if (pgRestore.exitCode === null) pgRestore.kill();
      if (psql.exitCode === null) psql.kill();
      reject(error);
    };
    pgRestore.stderr.on("data", (chunk: Buffer) => {
      restoreError = `${restoreError}${chunk.toString("utf8")}`.slice(-16_000);
    });
    psql.stderr.on("data", (chunk: Buffer) => {
      psqlError = `${psqlError}${chunk.toString("utf8")}`.slice(-16_000);
    });
    pgRestore.once("error", (error) => finish(error));
    psql.once("error", (error) => finish(error));
    psql.stdin.once("error", (error) => finish(error));
    psql.stdin.write(phase11RestorePreludeSql);
    pgRestore.stdout.pipe(psql.stdin, { end: false });
    pgRestore.once("close", (code, signal) => {
      if (code !== 0) {
        finish(
          new Error(
            `pg_restore exited with ${code ?? signal ?? "unknown"}: ${boundedProcessError(restoreError)}`,
          ),
        );
        return;
      }
      restoreSucceeded = true;
      psql.stdin.end();
    });
    psql.once("close", (code, signal) => {
      if (code !== 0) {
        finish(
          new Error(
            `psql restore exited with ${code ?? signal ?? "unknown"}: ${boundedProcessError(psqlError)}`,
          ),
        );
        return;
      }
      if (!restoreSucceeded) {
        finish(new Error("psql restore closed before pg_restore completed"));
        return;
      }
      finish();
    });
  });

function safeRelativePath(value: string): string {
  const normalized = value.replace(/\\/gu, "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/u.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error(`Unsafe backup path: ${value}`);
  }
  return normalized;
}

function safeChild(root: string, path: string): string {
  const target = resolve(root, ...safeRelativePath(path).split("/"));
  const relativePath = relative(root, target);
  if (
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Backup path escaped its configured root");
  }
  return target;
}

async function sha256File(path: string): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    hash.update(bytes);
    sizeBytes += bytes.length;
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

async function listRegularFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = resolve(directory, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error("Backup refuses symbolic links");
    if (metadata.isDirectory()) files.push(...(await listRegularFiles(root, path)));
    else if (metadata.isFile()) files.push(path);
    else throw new Error("Backup refuses non-regular artifact entries");
  }
  return files;
}

function databaseEnvironment(databaseUrl: string): {
  environment: NodeJS.ProcessEnv;
  database: string;
} {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use postgresql://");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (database.length === 0) throw new Error("DATABASE_URL must include a database");
  return {
    database,
    environment: {
      ...process.env,
      PGHOST: url.hostname,
      PGPORT: url.port || "5432",
      PGUSER: decodeURIComponent(url.username),
      PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: database,
      ...(url.searchParams.get("sslmode") === null
        ? {}
        : { PGSSLMODE: url.searchParams.get("sslmode") ?? undefined }),
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function manifestPayload(manifest: Omit<Phase11BackupManifest, "signature">) {
  return canonicalJson({
    schemaVersion: manifest.schemaVersion,
    backupId: manifest.backupId,
    generatedAt: manifest.generatedAt,
    appRelease: manifest.appRelease,
    database: manifest.database,
    artifacts: manifest.artifacts,
  });
}

function requireSigningKey(value: string): string {
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error("Backup signing key must contain at least 32 bytes");
  }
  return value;
}

export function signPhase11BackupManifest(
  manifest: Omit<Phase11BackupManifest, "signature">,
  signingKey: string,
): Phase11BackupManifest {
  const value = createHmac("sha256", requireSigningKey(signingKey))
    .update(manifestPayload(manifest))
    .digest("hex");
  return phase11BackupManifestSchema.parse({
    ...manifest,
    signature: { algorithm: "HMAC-SHA256", value },
  });
}

export function verifyPhase11BackupManifestSignature(
  manifestInput: unknown,
  signingKey: string,
): Phase11BackupManifest {
  const manifest = phase11BackupManifestSchema.parse(manifestInput);
  const expected = createHmac("sha256", requireSigningKey(signingKey))
    .update(
      manifestPayload({
        schemaVersion: manifest.schemaVersion,
        backupId: manifest.backupId,
        generatedAt: manifest.generatedAt,
        appRelease: manifest.appRelease,
        database: manifest.database,
        artifacts: manifest.artifacts,
      }),
    )
    .digest();
  const supplied = Buffer.from(manifest.signature.value, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new Error("Backup manifest signature is invalid");
  }
  return manifest;
}

function backupId(now: Date): string {
  const timestamp = now
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
  const suffix = createHash("sha256")
    .update(`${timestamp}:${process.pid}:${process.hrtime.bigint()}`)
    .digest("hex")
    .slice(0, 8);
  return `buildwatch-${timestamp}-${suffix}`;
}

export async function createPhase11Backup(options: {
  databaseUrl: string;
  artifactRoot: string;
  backupRoot: string;
  signingKey: string;
  appRelease: string;
  now?: () => Date;
  processRunner?: Phase11ProcessRunner;
}): Promise<{ directory: string; manifest: Phase11BackupManifest }> {
  const now = options.now?.() ?? new Date();
  const root = resolve(options.backupRoot);
  const id = backupId(now);
  const directory = safeChild(root, id);
  const artifactDestination = safeChild(directory, "artifacts");
  const databaseDump = safeChild(directory, "database.dump");
  await mkdir(artifactDestination, { recursive: true });
  try {
    const database = databaseEnvironment(options.databaseUrl);
    await (options.processRunner ?? runPhase11Process)(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--file",
        databaseDump,
        "--dbname",
        database.database,
      ],
      database.environment,
    );
    const artifactRoot = resolve(options.artifactRoot);
    const sourceFiles = await stat(artifactRoot)
      .then((metadata) => (metadata.isDirectory() ? listRegularFiles(artifactRoot) : []))
      .catch((error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? [] : Promise.reject(error),
      );
    const artifactFiles = [];
    for (const source of sourceFiles) {
      const relativePath = safeRelativePath(relative(artifactRoot, source).split(sep).join("/"));
      const destination = safeChild(artifactDestination, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(source, destination);
      artifactFiles.push({ path: relativePath, ...(await sha256File(destination)) });
    }
    artifactFiles.sort((left, right) => left.path.localeCompare(right.path));
    const unsigned = {
      schemaVersion: 1 as const,
      backupId: id,
      generatedAt: now.toISOString(),
      appRelease: options.appRelease,
      database: {
        path: "database.dump",
        format: "PG_CUSTOM" as const,
        ...(await sha256File(databaseDump)),
      },
      artifacts: { files: artifactFiles },
    };
    const manifest = signPhase11BackupManifest(unsigned, options.signingKey);
    await writeFile(
      safeChild(directory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    return { directory, manifest };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

async function verifyBackupFiles(directory: string, manifest: Phase11BackupManifest) {
  const databasePath = safeChild(directory, manifest.database.path);
  if (
    JSON.stringify(await sha256File(databasePath)) !==
    JSON.stringify({
      sha256: manifest.database.sha256,
      sizeBytes: manifest.database.sizeBytes,
    })
  ) {
    throw new Error("Database backup checksum is invalid");
  }
  for (const file of manifest.artifacts.files) {
    const path = safeChild(safeChild(directory, "artifacts"), file.path);
    const digest = await sha256File(path);
    if (digest.sha256 !== file.sha256 || digest.sizeBytes !== file.sizeBytes) {
      throw new Error(`Artifact backup checksum is invalid: ${file.path}`);
    }
  }
}

export async function restorePhase11Backup(options: {
  backupDirectory: string;
  databaseUrl: string;
  artifactRoot: string;
  signingKey: string;
  confirmation: string;
  nodeEnv: string;
  allowProductionRestore: boolean;
  restoreProcessRunner?: Phase11RestoreProcessRunner;
}): Promise<{ manifest: Phase11BackupManifest; preservedArtifactRoot: string | null }> {
  const directory = resolve(options.backupDirectory);
  const manifest = verifyPhase11BackupManifestSignature(
    JSON.parse(await readFile(safeChild(directory, "manifest.json"), "utf8")) as unknown,
    options.signingKey,
  );
  if (options.confirmation !== `RESTORE:${manifest.backupId}`) {
    throw new Error(`Restore requires --confirm RESTORE:${manifest.backupId}`);
  }
  if (options.nodeEnv === "production" && !options.allowProductionRestore) {
    throw new Error("Production restore requires PHASE11_ALLOW_PRODUCTION_RESTORE=true");
  }
  await verifyBackupFiles(directory, manifest);

  const artifactRoot = resolve(options.artifactRoot);
  const parent = dirname(artifactRoot);
  const staging = resolve(parent, `.${basename(artifactRoot)}-restore-${manifest.backupId}`);
  if (relative(parent, staging).startsWith("..")) {
    throw new Error("Artifact restore staging escaped its configured parent");
  }
  const existing = await stat(artifactRoot)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return false;
      throw error;
    });
  const preservedArtifactRoot = existing
    ? resolve(parent, `${basename(artifactRoot)}.pre-${manifest.backupId}`)
    : null;
  if (preservedArtifactRoot !== null) {
    const preservationExists = await stat(preservedArtifactRoot)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    if (preservationExists) {
      throw new Error(`Artifact preservation path already exists: ${preservedArtifactRoot}`);
    }
  }
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  try {
    for (const file of manifest.artifacts.files) {
      const source = safeChild(safeChild(directory, "artifacts"), file.path);
      const target = safeChild(staging, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    const database = databaseEnvironment(options.databaseUrl);
    await (options.restoreProcessRunner ?? runPhase11RestoreProcess)({
      databaseDump: safeChild(directory, manifest.database.path),
      database: database.database,
      environment: database.environment,
    });
    if (preservedArtifactRoot !== null) await rename(artifactRoot, preservedArtifactRoot);
    try {
      await rename(staging, artifactRoot);
    } catch (error) {
      if (preservedArtifactRoot !== null) await rename(preservedArtifactRoot, artifactRoot);
      throw error;
    }
    return { manifest, preservedArtifactRoot };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
