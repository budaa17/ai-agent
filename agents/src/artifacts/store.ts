import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  artifactRetentionV1Schema,
  signedArtifactReadReferenceV1Schema,
  storedArtifactV1Schema,
  type ArtifactRetentionV1,
  type MalwareScanResultV1,
  type SignedArtifactReadReferenceV1,
  type StoredArtifactV1,
} from "./contracts.js";

export type PutArtifactInput = {
  artifactId: string;
  tenantId: string;
  projectId: string;
  mediaType: string;
  data: Uint8Array;
  malwareScan: MalwareScanResultV1;
  retention: ArtifactRetentionV1;
};

export interface ArtifactStore {
  put(input: PutArtifactInput): Promise<StoredArtifactV1>;
  read(artifact: StoredArtifactV1): Promise<Uint8Array>;
  delete(artifact: StoredArtifactV1): Promise<boolean>;
  createSignedReadReference(
    artifact: StoredArtifactV1,
    ttlSeconds: number,
  ): Promise<SignedArtifactReadReferenceV1>;
}

function sha256(data: Uint8Array | string) {
  return createHash("sha256").update(data).digest("hex");
}

function safeSegment(value: string, name: string) {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) {
    throw new Error(`${name} contains unsafe path characters`);
  }

  return value;
}

function extensionFor(mediaType: string) {
  const extensions: Record<string, string> = {
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/json": ".json",
    "text/html": ".html",
    "text/markdown": ".md",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  };

  return extensions[mediaType] ?? ".bin";
}

function signaturePayload(
  reference: Omit<SignedArtifactReadReferenceV1, "schemaVersion" | "referenceId" | "accessToken">,
) {
  return [
    reference.artifactId,
    reference.tenantId,
    reference.projectId,
    reference.storageKey,
    reference.sha256,
    reference.expiresAt,
  ].join("\0");
}

export class LocalArtifactStore implements ArtifactStore {
  readonly #root: string;
  readonly #signingSecret: string;
  readonly #now: () => Date;

  constructor(root: string, signingSecret: string, now = () => new Date()) {
    if (Buffer.byteLength(signingSecret, "utf8") < 32) {
      throw new Error("Artifact signing secret must contain at least 32 bytes");
    }

    this.#root = path.resolve(root);
    this.#signingSecret = signingSecret;
    this.#now = now;
  }

  #absolutePath(storageKey: string) {
    const target = path.resolve(this.#root, ...storageKey.split("/"));
    const relative = path.relative(this.#root, target);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Artifact path escapes the configured store");
    }

    return target;
  }

  async put(input: PutArtifactInput): Promise<StoredArtifactV1> {
    if (input.malwareScan.status !== "CLEAN") {
      throw new Error("Artifact store accepts only clean scan results");
    }

    const tenantId = safeSegment(input.tenantId, "tenantId");
    const projectId = safeSegment(input.projectId, "projectId");
    const artifactId = safeSegment(input.artifactId, "artifactId");
    const contentSha256 = sha256(input.data);

    if (contentSha256 !== input.malwareScan.sha256) {
      throw new Error("Artifact bytes do not match the malware-scanned checksum");
    }

    const storageKey = [
      tenantId,
      projectId,
      `${artifactId}-${contentSha256}${extensionFor(input.mediaType)}`,
    ].join("/");
    const target = this.#absolutePath(storageKey);
    const retention = artifactRetentionV1Schema.parse(input.retention);
    const artifact = storedArtifactV1Schema.parse({
      schemaVersion: 1,
      artifactId,
      tenantId,
      projectId,
      mediaType: input.mediaType,
      sha256: contentSha256,
      sizeBytes: input.data.byteLength,
      storageKey,
      malwareScan: input.malwareScan,
      retention,
    });
    const metadataTarget = `${target}.metadata.json`;

    await mkdir(path.dirname(target), { recursive: true });

    try {
      await writeFile(target, input.data, { flag: "wx" });
    } catch (error) {
      const exists =
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST";

      if (!exists) {
        throw error;
      }

      const existing = await readFile(target);

      if (sha256(existing) !== contentSha256) {
        throw new Error("Immutable artifact checksum conflict", { cause: error });
      }
    }

    await writeFile(metadataTarget, `${JSON.stringify(artifact, null, 2)}\n`, {
      encoding: "utf8",
      flag: "w",
    });
    return artifact;
  }

  async read(artifactInput: StoredArtifactV1): Promise<Uint8Array> {
    const artifact = storedArtifactV1Schema.parse(artifactInput);
    const data = await readFile(this.#absolutePath(artifact.storageKey));

    if (data.byteLength !== artifact.sizeBytes || sha256(data) !== artifact.sha256) {
      throw new Error("Stored artifact integrity check failed");
    }

    return data;
  }

  async delete(artifactInput: StoredArtifactV1): Promise<boolean> {
    const artifact = storedArtifactV1Schema.parse(artifactInput);

    if (artifact.retention.legalHold) {
      throw new Error("Legal-hold artifacts cannot be deleted");
    }

    const target = this.#absolutePath(artifact.storageKey);
    await Promise.all([
      rm(target, { force: true }),
      rm(`${target}.metadata.json`, { force: true }),
    ]);
    return true;
  }

  async createSignedReadReference(
    artifactInput: StoredArtifactV1,
    ttlSeconds: number,
  ): Promise<SignedArtifactReadReferenceV1> {
    const artifact = storedArtifactV1Schema.parse(artifactInput);

    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3_600) {
      throw new Error("Signed artifact reference TTL must be 1-3600 seconds");
    }

    const expiresAt = new Date(this.#now().getTime() + ttlSeconds * 1_000).toISOString();
    const unsigned = {
      artifactId: artifact.artifactId,
      tenantId: artifact.tenantId,
      projectId: artifact.projectId,
      storageKey: artifact.storageKey,
      sha256: artifact.sha256,
      expiresAt,
    };
    const accessToken = createHmac("sha256", this.#signingSecret)
      .update(signaturePayload(unsigned))
      .digest("base64url");

    return signedArtifactReadReferenceV1Schema.parse({
      schemaVersion: 1,
      referenceId: `artifact-read-${sha256(`${artifact.artifactId}:${expiresAt}`).slice(0, 20)}`,
      ...unsigned,
      accessToken,
    });
  }

  verifySignedReadReference(input: SignedArtifactReadReferenceV1): boolean {
    const reference = signedArtifactReadReferenceV1Schema.safeParse(input);

    if (!reference.success || Date.parse(reference.data.expiresAt) <= this.#now().getTime()) {
      return false;
    }

    const expected = createHmac("sha256", this.#signingSecret)
      .update(
        signaturePayload({
          artifactId: reference.data.artifactId,
          tenantId: reference.data.tenantId,
          projectId: reference.data.projectId,
          storageKey: reference.data.storageKey,
          sha256: reference.data.sha256,
          expiresAt: reference.data.expiresAt,
        }),
      )
      .digest();
    const actual = Buffer.from(reference.data.accessToken, "base64url");

    return actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  }

  async sweepExpired(): Promise<number> {
    const metadataFiles: string[] = [];

    const visit = async (directory: string): Promise<void> => {
      let entries;

      try {
        entries = await readdir(directory, {
          withFileTypes: true,
        });
      } catch (error) {
        const missing =
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT";

        if (missing) {
          return;
        }

        throw error;
      }

      await Promise.all(
        entries.map(async (entry) => {
          const target = path.join(directory, entry.name);

          if (entry.isDirectory()) {
            await visit(target);
          } else if (entry.name.endsWith(".metadata.json")) {
            metadataFiles.push(target);
          }
        }),
      );
    };

    await visit(this.#root);
    let deleted = 0;

    for (const metadataFile of metadataFiles) {
      const artifact = storedArtifactV1Schema.parse(
        JSON.parse(await readFile(metadataFile, "utf8")),
      );

      if (
        !artifact.retention.legalHold &&
        artifact.retention.expiresAt !== null &&
        Date.parse(artifact.retention.expiresAt) <= this.#now().getTime()
      ) {
        await this.delete(artifact);
        deleted += 1;
      }
    }

    return deleted;
  }
}
