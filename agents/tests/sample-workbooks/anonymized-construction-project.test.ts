import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sampleWorkbookManifestV1Schema } from "../../src/contracts/index.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sampleDirectory = new URL("../../data/sample-workbooks/", import.meta.url);
const manifestPath = fileURLToPath(
  new URL("anonymized-construction-project-synthetic-v1.manifest.json", sampleDirectory),
);
const workbookPath = fileURLToPath(
  new URL("anonymized-construction-project-synthetic-v1.xlsx", sampleDirectory),
);

const manifest = sampleWorkbookManifestV1Schema.parse(
  JSON.parse(readFileSync(manifestPath, "utf8")),
);

type ZipEntry = {
  name: string;
  encrypted: boolean;
};

function findSignatureBackwards(bytes: Buffer, signature: number): number {
  for (let offset = bytes.length - 4; offset >= 0; offset -= 1) {
    if (bytes.readUInt32LE(offset) === signature) {
      return offset;
    }
  }

  return -1;
}

function listZipEntries(bytes: Buffer): ZipEntry[] {
  const endOfCentralDirectory = findSignatureBackwards(bytes, 0x06054b50);

  if (endOfCentralDirectory < 0) {
    throw new Error("ZIP end-of-central-directory record is missing");
  }

  const entryCount = bytes.readUInt16LE(endOfCentralDirectory + 10);
  let offset = bytes.readUInt32LE(endOfCentralDirectory + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central-directory entry ${index}`);
    }

    const flags = bytes.readUInt16LE(offset + 8);
    const fileNameLength = bytes.readUInt16LE(offset + 28);
    const extraFieldLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const fileNameStart = offset + 46;
    const name = bytes.subarray(fileNameStart, fileNameStart + fileNameLength).toString("utf8");

    entries.push({
      name,
      encrypted: (flags & 0x1) !== 0,
    });
    offset = fileNameStart + fileNameLength + extraFieldLength + commentLength;
  }

  return entries;
}

describe("anonymized construction project synthetic workbook", () => {
  it("uses a strict, explicit synthetic classification", () => {
    expect(repositoryRoot).toMatch(/[\\/]agents[\\/]$/);
    expect(manifest.classification).toBe("SYNTHETIC_ANONYMIZED");
    expect(manifest.source.workbookClaim).toBe("SELF_DESCRIBED_SYNTHETIC");
    expect(manifest.usage.satisfiesAnonymizedRealSampleRequirement).toBe(false);
    expect(manifest.usage.agentContextAllowed).toBe(false);
    expect(manifest.usage.goldenAnswerAllowed).toBe(false);
    expect(manifest.sheets).toHaveLength(9);

    expect(
      sampleWorkbookManifestV1Schema.safeParse({
        ...manifest,
        futureField: "requires a schema version change",
      }).success,
    ).toBe(false);
  });

  it("matches the immutable file size and SHA-256", () => {
    const workbook = readFileSync(workbookPath);

    expect(workbook.length).toBe(manifest.file.sizeBytes);
    expect(createHash("sha256").update(workbook).digest("hex")).toBe(manifest.file.sha256);
    expect(workbook.subarray(0, 4).toString("hex")).toBe("504b0304");
  });

  it("contains no encrypted or executable XLSX package entries", () => {
    const entries = listZipEntries(readFileSync(workbookPath));
    const names = entries.map((entry) => entry.name);

    expect(entries).toHaveLength(31);
    expect(entries.every((entry) => !entry.encrypted)).toBe(true);
    expect(
      names.filter((name) => /(vbaProject|externalLinks|embeddings|activeX|oleObject)/i.test(name)),
    ).toEqual([]);
    expect(
      names.filter((name) => {
        const normalized = name.replaceAll("\\", "/");
        return normalized.startsWith("/") || normalized.split("/").includes("..");
      }),
    ).toEqual([]);
    expect(names.filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))).toHaveLength(
      manifest.integrity.sheetCount,
    );
  });

  it("records the audited row counts and referential integrity", () => {
    const counts = Object.fromEntries(
      manifest.sheets.map((sheet) => [sheet.name, sheet.recordCount]),
    );

    expect(counts).toMatchObject({
      Work_Plan: 20,
      Daily_Reports: 76,
      Attendance: 336,
      Materials: 36,
      Costs: 71,
    });
    expect(manifest.integrity).toMatchObject({
      workItemCount: 20,
      dependencyEdgeCount: 28,
      duplicateWorkItemCodeCount: 0,
      missingWorkItemReferenceCount: 0,
      missingDependencyCount: 0,
      dependencyCycleNodeCount: 0,
    });
  });
});
