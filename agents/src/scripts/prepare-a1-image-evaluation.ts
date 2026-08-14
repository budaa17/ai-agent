import "dotenv/config";

import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { a1ImageAnnotationWorkspaceV1Schema } from "../phase2/index.js";
import { loadProjectUpdateImage } from "../structuring/index.js";

const SUPPORTED_EXTENSIONS = new Set([".gif", ".jpeg", ".jpg", ".png", ".webp"]);

function valueAfter(args: readonly string[], name: string) {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }

  return value;
}

function optionalValueAfter(args: readonly string[], name: string) {
  return args.includes(name) ? valueAfter(args, name) : undefined;
}

async function imageFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return imageFiles(target);
      }

      return entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
        ? [target]
        : [];
    }),
  );

  return files.flat().sort();
}

function outputExtension(mediaType: string) {
  return (
    {
      "image/gif": ".gif",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    }[mediaType] ?? ".bin"
  );
}

async function main() {
  const args = process.argv.slice(2).filter((item) => item !== "--");
  const sourceDirectory = path.resolve(valueAfter(args, "--directory"));
  const outputPath = path.resolve(valueAfter(args, "--output"));
  const reviewer = valueAfter(args, "--reviewer");
  const datasetId =
    optionalValueAfter(args, "--dataset-id") ??
    `a1-real-images-${new Date().toISOString().slice(0, 10)}`;

  if (!args.includes("--anonymized") || !args.includes("--consent-confirmed")) {
    throw new Error(
      "Use both --anonymized and --consent-confirmed only after verifying privacy and collection consent",
    );
  }

  const files = await imageFiles(sourceDirectory);

  if (files.length === 0) {
    throw new Error("No supported image files were found");
  }

  const workspaceDirectory = path.dirname(outputPath);
  const assetDirectoryName = `${path.basename(outputPath, path.extname(outputPath))}.assets`;
  const assetDirectory = path.join(workspaceDirectory, assetDirectoryName);
  await mkdir(assetDirectory, { recursive: true });
  const unique = new Map<
    string,
    Awaited<ReturnType<typeof loadProjectUpdateImage>> & {
      sourceFileName: string;
    }
  >();

  for (const file of files) {
    const image = await loadProjectUpdateImage(file);
    unique.set(image.sha256, {
      ...image,
      sourceFileName: path.basename(file),
    });
  }

  const cases = [];
  let index = 0;

  for (const image of unique.values()) {
    index += 1;
    const fileName = `${String(index).padStart(3, "0")}-${image.sha256.slice(
      0,
      16,
    )}${outputExtension(image.mediaType)}`;
    const target = path.join(assetDirectory, fileName);
    await writeFile(target, image.data);
    cases.push({
      schemaVersion: 1 as const,
      caseId: `a1-image-real-${String(index).padStart(3, "0")}`,
      sourceFileName: image.sourceFileName,
      sourceText: null,
      artifactPath: `${assetDirectoryName}/${fileName}`,
      artifactSha256: image.sha256,
      sceneFamily: null,
      difficulty: null,
      expectedKinds: [],
      requireVisibleRegionEvidence: null,
      humanReviewed: false,
      notes: null,
    });
  }

  const workspace = a1ImageAnnotationWorkspaceV1Schema.parse({
    schemaVersion: 1,
    datasetId,
    reviewedBy: reviewer,
    reviewedAt: null,
    anonymized: true,
    collectionConsentConfirmed: true,
    cases,
  });
  await mkdir(workspaceDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");
  process.stdout.write(
    `${JSON.stringify({
      status: cases.length >= 60 ? "READY_FOR_LABELING" : "NEEDS_MORE_IMAGES",
      uniqueImages: cases.length,
      requiredImages: 60,
      workspace: outputPath,
      next: "Set sceneFamily, difficulty, expectedKinds, requireVisibleRegionEvidence, humanReviewed=true, and reviewedAt. CONTRADICTION cases also require sourceText.",
    })}\n`,
  );
}

main().catch((error) => {
  console.error(
    `A1 image workspace failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
