import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { z } from "zod";
import {
  inspectProjectUpdateImage,
  MAX_PROJECT_UPDATE_IMAGE_PIXELS,
  projectUpdateImageInspectionSchema,
  projectUpdateImageMediaTypeSchema,
  type ProjectUpdateImageMediaType,
} from "./image-inspection.js";

export const MAX_PROJECT_UPDATE_MODEL_IMAGE_SIDE = 2_048;
export const MAX_PROJECT_UPDATE_PREPROCESSED_BYTES = 10 * 1024 * 1024;

export const projectUpdateImagePreprocessingOperationSchema = z.enum([
  "AUTO_ORIENT",
  "RESIZE",
  "METADATA_STRIP",
  "COMPRESS",
  "FORMAT_CONVERSION",
]);

export const projectUpdateImagePreprocessingSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    sourceFileName: z.string().trim().min(1).max(500),
    sourceSizeBytes: z.number().int().positive(),
    source: projectUpdateImageInspectionSchema,
    outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
    outputFileName: z.string().trim().min(1).max(500),
    outputSizeBytes: z.number().int().positive(),
    output: projectUpdateImageInspectionSchema,
    operations: z.array(projectUpdateImagePreprocessingOperationSchema).min(2).max(5),
    orientationApplied: z.boolean(),
    resized: z.boolean(),
    formatChanged: z.boolean(),
    metadataStripped: z.literal(true),
  })
  .strict()
  .superRefine((metadata, context) => {
    const operationChecks = [
      ["AUTO_ORIENT", metadata.orientationApplied],
      ["RESIZE", metadata.resized],
      ["FORMAT_CONVERSION", metadata.formatChanged],
    ] as const;

    for (const [operation, expected] of operationChecks) {
      if (metadata.operations.includes(operation) !== expected) {
        context.addIssue({
          code: "custom",
          message: `${operation} operation metadata is inconsistent`,
          path: ["operations"],
        });
      }
    }

    if (
      !metadata.operations.includes("METADATA_STRIP") ||
      !metadata.operations.includes("COMPRESS")
    ) {
      context.addIssue({
        code: "custom",
        message: "Preprocessed images require metadata stripping and compression",
        path: ["operations"],
      });
    }

    if (metadata.formatChanged !== (metadata.source.mediaType !== metadata.output.mediaType)) {
      context.addIssue({
        code: "custom",
        message: "Image format-change metadata is inconsistent",
        path: ["formatChanged"],
      });
    }

    if (metadata.output.exifOrientation !== null) {
      context.addIssue({
        code: "custom",
        message: "Preprocessed output must not retain EXIF orientation",
        path: ["output", "exifOrientation"],
      });
    }

    if (
      metadata.output.width > MAX_PROJECT_UPDATE_MODEL_IMAGE_SIDE ||
      metadata.output.height > MAX_PROJECT_UPDATE_MODEL_IMAGE_SIDE
    ) {
      context.addIssue({
        code: "custom",
        message: `Preprocessed output side must not exceed ${MAX_PROJECT_UPDATE_MODEL_IMAGE_SIDE} pixels`,
        path: ["output"],
      });
    }
  });

export type ProjectUpdateImagePreprocessing = z.infer<typeof projectUpdateImagePreprocessingSchema>;

export type ProjectUpdateImagePreprocessingInput = {
  data: Uint8Array;
  mediaType: ProjectUpdateImageMediaType;
  fileName: string;
  sha256: string;
};

export type PreprocessedProjectUpdateImage = {
  data: Uint8Array;
  mediaType: ProjectUpdateImageMediaType;
  fileName: string;
  sha256: string;
  preprocessing: ProjectUpdateImagePreprocessing;
};

const extensionByMediaType: Record<ProjectUpdateImageMediaType, string> = {
  "image/gif": ".png",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function sha256(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

function normalizedFileName(sourceFileName: string, mediaType: ProjectUpdateImageMediaType) {
  const parsed = path.parse(path.basename(sourceFileName));
  const stem = parsed.name.trim() || "project-update";
  return `${stem}.normalized${extensionByMediaType[mediaType]}`;
}

function outputMediaType(input: ProjectUpdateImageMediaType): ProjectUpdateImageMediaType {
  return input === "image/gif" ? "image/png" : input;
}

function buildPipeline(data: Uint8Array) {
  return sharp(Buffer.from(data), {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_PROJECT_UPDATE_IMAGE_PIXELS,
    sequentialRead: true,
  })
    .autoOrient()
    .resize({
      width: MAX_PROJECT_UPDATE_MODEL_IMAGE_SIDE,
      height: MAX_PROJECT_UPDATE_MODEL_IMAGE_SIDE,
      fit: "inside",
      withoutEnlargement: true,
      fastShrinkOnLoad: true,
    });
}

async function renderImage(data: Uint8Array, mediaType: ProjectUpdateImageMediaType) {
  const pipeline = buildPipeline(data);

  if (mediaType === "image/jpeg") {
    return pipeline
      .jpeg({
        quality: 85,
        chromaSubsampling: "4:4:4",
        optimiseCoding: true,
      })
      .toBuffer();
  }

  if (mediaType === "image/png" || mediaType === "image/gif") {
    return pipeline
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
      })
      .toBuffer();
  }

  return pipeline
    .webp({
      quality: 85,
      smartSubsample: true,
    })
    .toBuffer();
}

async function renderSizeFallback(data: Uint8Array) {
  return buildPipeline(data)
    .webp({
      quality: 80,
      smartSubsample: true,
    })
    .toBuffer();
}

async function assertMetadataWasStripped(data: Uint8Array) {
  const metadata = await sharp(Buffer.from(data), {
    animated: false,
    limitInputPixels: MAX_PROJECT_UPDATE_IMAGE_PIXELS,
  }).metadata();

  if (
    metadata.exif !== undefined ||
    metadata.icc !== undefined ||
    metadata.iptc !== undefined ||
    metadata.xmp !== undefined
  ) {
    throw new Error("Preprocessed project update image still contains metadata");
  }
}

export async function preprocessProjectUpdateImage(
  input: ProjectUpdateImagePreprocessingInput,
): Promise<PreprocessedProjectUpdateImage> {
  const fileName = path.basename(input.fileName.trim());

  if (!fileName) {
    throw new Error("Project update image filename is required");
  }

  projectUpdateImageMediaTypeSchema.parse(input.mediaType);
  const sourceSha256 = sha256(input.data);

  if (sourceSha256 !== input.sha256) {
    throw new Error("Project update source image checksum does not match its bytes");
  }

  const source = inspectProjectUpdateImage(input.data);

  if (source.mediaType !== input.mediaType) {
    throw new Error(`Project update image bytes are ${source.mediaType}, not ${input.mediaType}`);
  }

  let outputData = await renderImage(input.data, input.mediaType);
  let mediaType = outputMediaType(input.mediaType);

  if (outputData.byteLength > MAX_PROJECT_UPDATE_PREPROCESSED_BYTES) {
    outputData = await renderSizeFallback(input.data);
    mediaType = "image/webp";
  }

  if (outputData.byteLength > MAX_PROJECT_UPDATE_PREPROCESSED_BYTES) {
    throw new Error("Preprocessed project update image must not exceed 10 MB");
  }

  await assertMetadataWasStripped(outputData);
  const output = inspectProjectUpdateImage(outputData);

  if (output.mediaType !== mediaType) {
    throw new Error(
      `Preprocessed project update image bytes are ${output.mediaType}, not ${mediaType}`,
    );
  }

  const outputSha256 = sha256(outputData);
  const outputFileName = normalizedFileName(fileName, mediaType);
  const orientationApplied = source.exifOrientation !== null && source.exifOrientation !== 1;
  const resized = output.width !== source.displayWidth || output.height !== source.displayHeight;
  const formatChanged = source.mediaType !== output.mediaType;
  const operations = [
    ...(orientationApplied ? (["AUTO_ORIENT"] as const) : []),
    ...(resized ? (["RESIZE"] as const) : []),
    "METADATA_STRIP",
    "COMPRESS",
    ...(formatChanged ? (["FORMAT_CONVERSION"] as const) : []),
  ];
  const preprocessing = projectUpdateImagePreprocessingSchema.parse({
    schemaVersion: 1,
    sourceSha256,
    sourceFileName: fileName,
    sourceSizeBytes: input.data.byteLength,
    source,
    outputSha256,
    outputFileName,
    outputSizeBytes: outputData.byteLength,
    output,
    operations,
    orientationApplied,
    resized,
    formatChanged,
    metadataStripped: true,
  });

  return {
    data: outputData,
    mediaType,
    fileName: outputFileName,
    sha256: outputSha256,
    preprocessing,
  };
}
