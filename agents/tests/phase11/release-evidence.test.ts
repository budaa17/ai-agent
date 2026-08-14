import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validatePhase11ReleaseEvidence,
  type Phase11ReleaseEvidence,
} from "../../src/operations/index.js";

describe("BuildWatch Phase 11 full release evidence", () => {
  it("reports a missing external manifest without exposing a raw filesystem error", async () => {
    const root = await mkdtemp(join(tmpdir(), "buildwatch-release-evidence-missing-"));
    try {
      await expect(
        validatePhase11ReleaseEvidence(join(root, "phase11-evidence.json")),
      ).rejects.toThrow("Release evidence manifest was not found");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts distinct, checksum-bound external evidence", async () => {
    const fixture = await createFixture();
    try {
      const manifest = await validatePhase11ReleaseEvidence(fixture.manifestPath);
      expect(manifest.release).toBe("v2.2.0");
      expect(manifest.photoDataset.imageCount).toBe(60);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("fails closed when an evidence artifact is changed", async () => {
    const fixture = await createFixture();
    try {
      await writeFile(join(fixture.root, "evidence", "artifact-01.txt"), "tampered");
      await expect(validatePhase11ReleaseEvidence(fixture.manifestPath)).rejects.toThrow(
        "checksum mismatch",
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "buildwatch-release-evidence-"));
  const evidenceDirectory = join(root, "evidence");
  await mkdir(evidenceDirectory);
  const references = [];
  for (let index = 1; index <= 16; index += 1) {
    const path = `evidence/artifact-${String(index).padStart(2, "0")}.txt`;
    const content = `independent release evidence ${index}`;
    await writeFile(join(root, path), content);
    references.push({
      path,
      sha256: createHash("sha256").update(content).digest("hex"),
      result: "PASS" as const,
      issuer: `Accountable reviewer ${index}`,
      issuedAt: "2026-08-04T08:00:00.000Z",
    });
  }
  const manifest: Phase11ReleaseEvidence = {
    schemaVersion: 1,
    release: "v2.2.0",
    generatedAt: "2026-08-04T08:01:00.000Z",
    deployedBaseUrl: "https://buildwatch.example.com",
    drawingBoq: {
      caseCount: 10,
      datasetManifest: references[0]!,
      engineerReview: references[1]!,
    },
    photoDataset: {
      imageCount: 60,
      datasetManifest: references[2]!,
      ownerConsent: references[3]!,
      humanReview: references[4]!,
    },
    deployment: {
      twoTenantIsolation: references[5]!,
      authRbacRefresh: references[6]!,
      offlineFieldTest: references[7]!,
      productionLoadTest: references[8]!,
      independentSecurityAssessment: references[9]!,
      backupRestoreDrill: references[10]!,
      sentryAlert: references[11]!,
      langfuseTraceCost: references[12]!,
    },
    signoffs: [
      { role: "DOMAIN_ENGINEER", evidence: references[13]! },
      { role: "SECURITY_OWNER", evidence: references[14]! },
      { role: "OPERATIONS_OWNER", evidence: references[15]! },
    ],
  };
  const manifestPath = join(root, "phase11-evidence.json");
  await writeFile(manifestPath, JSON.stringify(manifest));
  return { root, manifestPath };
}
