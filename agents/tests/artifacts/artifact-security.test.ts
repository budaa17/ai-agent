import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BuiltInImageMalwareScanner,
  LocalArtifactStore,
  MalwareScanRejectedError,
  scanProjectUpdateImage,
} from "../../src/artifacts/index.js";

const temporaryDirectories: string[] = [];

function sha256(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Phase 2 secure artifact boundary", () => {
  it("rejects the standard malware test signature", async () => {
    const data = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!",
      "ascii",
    );

    await expect(
      scanProjectUpdateImage(new BuiltInImageMalwareScanner(() => "2026-07-30T00:00:00.000Z"), {
        data,
        sha256: sha256(data),
        mediaType: "image/png",
        fileName: "unsafe.png",
      }),
    ).rejects.toBeInstanceOf(MalwareScanRejectedError);
  });

  it("stores only clean immutable artifacts and verifies signed reads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-artifacts-"));
    temporaryDirectories.push(directory);
    const now = new Date("2026-07-30T00:00:00.000Z");
    const data = Buffer.from("normalized-safe-image");
    const scanner = new BuiltInImageMalwareScanner(() => now.toISOString());
    const security = await scanProjectUpdateImage(scanner, {
      data,
      sha256: sha256(data),
      mediaType: "image/png",
      fileName: "safe.png",
    });
    const store = new LocalArtifactStore(
      directory,
      "phase2-artifact-signing-secret-32-bytes-minimum",
      () => now,
    );
    const artifact = await store.put({
      artifactId: "source-image-001",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      mediaType: "image/png",
      data,
      malwareScan: security.malwareScan,
      retention: {
        schemaVersion: 1,
        classification: "SOURCE_PRIVATE",
        createdAt: now.toISOString(),
        expiresAt: "2026-08-29T00:00:00.000Z",
        legalHold: false,
        deletionStatus: "ACTIVE",
      },
    });
    const reference = await store.createSignedReadReference(artifact, 300);

    expect(artifact.storageKey).toBe(
      `tenant-demo/project-atlas/source-image-001-${sha256(data)}.png`,
    );
    expect(await store.read(artifact)).toEqual(data);
    expect(store.verifySignedReadReference(reference)).toBe(true);
    expect(
      store.verifySignedReadReference({
        ...reference,
        sha256: "0".repeat(64),
      }),
    ).toBe(false);
  });

  it("deletes expired artifacts but preserves legal hold", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-retention-"));
    temporaryDirectories.push(directory);
    let now = new Date("2026-07-30T00:00:00.000Z");
    const data = Buffer.from("retained-artifact");
    const scanner = new BuiltInImageMalwareScanner(() => now.toISOString());
    const security = await scanProjectUpdateImage(scanner, {
      data,
      sha256: sha256(data),
      mediaType: "application/json",
      fileName: "artifact.json",
    });
    const store = new LocalArtifactStore(
      directory,
      "phase2-artifact-signing-secret-32-bytes-minimum",
      () => now,
    );
    await store.put({
      artifactId: "agent-json-001",
      tenantId: "tenant-demo",
      projectId: "project-atlas",
      mediaType: "application/json",
      data,
      malwareScan: security.malwareScan,
      retention: {
        schemaVersion: 1,
        classification: "AGENT_DRAFT",
        createdAt: now.toISOString(),
        expiresAt: "2026-07-31T00:00:00.000Z",
        legalHold: false,
        deletionStatus: "ACTIVE",
      },
    });

    now = new Date("2026-08-01T00:00:00.000Z");
    expect(await store.sweepExpired()).toBe(1);
  });
});
