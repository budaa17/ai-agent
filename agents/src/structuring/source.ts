import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import {
  BuiltInImageMalwareScanner,
  projectUpdateImageSecurityV1Schema,
  scanProjectUpdateImage,
  type MalwareScanner,
  type ProjectUpdateImageSecurityV1,
} from "../artifacts/index.js";
import {
  inspectProjectUpdateImage,
  projectUpdateImageMediaTypeSchema,
  type ProjectUpdateImageMediaType,
} from "./image-inspection.js";
import {
  preprocessProjectUpdateImage,
  projectUpdateImagePreprocessingSchema,
  type ProjectUpdateImagePreprocessing,
} from "./image-preprocessing.js";

export {
  assertProjectUpdateImageWithinLimits,
  detectProjectUpdateImageMediaType,
  inspectProjectUpdateImage,
  MAX_PROJECT_UPDATE_IMAGE_FRAMES,
  MAX_PROJECT_UPDATE_IMAGE_PIXELS,
  MAX_PROJECT_UPDATE_IMAGE_SIDE,
  projectUpdateExifOrientationSchema,
  projectUpdateImageInspectionSchema,
  projectUpdateImageMediaTypeSchema,
  type ProjectUpdateExifOrientation,
  type ProjectUpdateImageInspection,
  type ProjectUpdateImageMediaType,
} from "./image-inspection.js";
export {
  MAX_PROJECT_UPDATE_MODEL_IMAGE_SIDE,
  MAX_PROJECT_UPDATE_PREPROCESSED_BYTES,
  preprocessProjectUpdateImage,
  projectUpdateImagePreprocessingOperationSchema,
  projectUpdateImagePreprocessingSchema,
  type PreprocessedProjectUpdateImage,
  type ProjectUpdateImagePreprocessing,
  type ProjectUpdateImagePreprocessingInput,
} from "./image-preprocessing.js";

export const MAX_PROJECT_UPDATE_IMAGE_BYTES = 10 * 1024 * 1024;

export interface ProjectUpdateImageSource {
  data: Uint8Array;
  mediaType: ProjectUpdateImageMediaType;
  fileName: string;
  sha256: string;
  preprocessing?: ProjectUpdateImagePreprocessing;
  security?: ProjectUpdateImageSecurityV1;
}

export interface ProjectUpdateSource {
  text?: string;
  image?: ProjectUpdateImageSource;
}

export const projectUpdateImageSourceProvenanceSchema = z
  .object({
    schemaVersion: z.literal(1),
    preprocessing: projectUpdateImagePreprocessingSchema.optional(),
    security: projectUpdateImageSecurityV1Schema.optional(),
  })
  .strict()
  .refine(
    (provenance) => provenance.preprocessing !== undefined || provenance.security !== undefined,
    "Image provenance requires preprocessing or security metadata",
  );

export type ProjectUpdateImageSourceProvenance = z.infer<
  typeof projectUpdateImageSourceProvenanceSchema
>;

const extensionMediaTypes: Record<string, ProjectUpdateImageMediaType> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function imageSha256(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

export function normalizeProjectUpdateSource(input: ProjectUpdateSource): ProjectUpdateSource {
  const text = input.text?.trim();
  const image = input.image;

  if (text && text.length > 20_000) {
    throw new Error("Project update text must not exceed 20000 characters");
  }

  if (image) {
    if (image.data.byteLength === 0) {
      throw new Error("Project update image is empty");
    }

    if (image.data.byteLength > MAX_PROJECT_UPDATE_IMAGE_BYTES) {
      throw new Error("Project update image must not exceed 10 MB");
    }

    projectUpdateImageMediaTypeSchema.parse(image.mediaType);
    const inspection = inspectProjectUpdateImage(image.data);
    const detectedMediaType = inspection.mediaType;

    if (detectedMediaType !== image.mediaType) {
      throw new Error(
        `Project update image bytes are ${detectedMediaType}, not ${image.mediaType}`,
      );
    }

    if (!image.fileName.trim()) {
      throw new Error("Project update image filename is required");
    }

    if (image.sha256 !== imageSha256(image.data)) {
      throw new Error("Project update image checksum does not match its bytes");
    }

    if (image.preprocessing !== undefined) {
      const preprocessing = projectUpdateImagePreprocessingSchema.parse(image.preprocessing);

      if (
        preprocessing.outputSha256 !== image.sha256 ||
        preprocessing.outputFileName !== image.fileName ||
        preprocessing.outputSizeBytes !== image.data.byteLength ||
        preprocessing.output.mediaType !== image.mediaType ||
        JSON.stringify(preprocessing.output) !== JSON.stringify(inspection)
      ) {
        throw new Error("Project update image preprocessing provenance does not match its output");
      }
    }

    if (image.security !== undefined) {
      const security = projectUpdateImageSecurityV1Schema.parse(image.security);
      const expectedSourceSha256 = image.preprocessing?.sourceSha256 ?? image.sha256;

      if (security.sourceSha256 !== expectedSourceSha256) {
        throw new Error("Project update image security provenance does not match its source");
      }
    }
  }

  if (!text && !image) {
    throw new Error("Either text or an image is required");
  }

  return {
    ...(text ? { text } : {}),
    ...(image ? { image } : {}),
  };
}

export async function loadProjectUpdateTextFile(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}

export async function loadProjectUpdateImage(
  path: string,
  options: {
    malwareScanner?: MalwareScanner;
  } = {},
): Promise<ProjectUpdateImageSource> {
  const absolutePath = resolve(process.cwd(), path);
  const data = await readFile(absolutePath);

  if (data.byteLength === 0) {
    throw new Error("Project update image is empty");
  }

  if (data.byteLength > MAX_PROJECT_UPDATE_IMAGE_BYTES) {
    throw new Error("Project update image must not exceed 10 MB");
  }

  const mediaType = inspectProjectUpdateImage(data).mediaType;
  const extensionMediaType = extensionMediaTypes[extname(absolutePath).toLowerCase()];

  if (extensionMediaType && extensionMediaType !== mediaType) {
    throw new Error(`Image extension ${extname(absolutePath)} does not match ${mediaType}`);
  }

  const source = {
    data,
    mediaType,
    fileName: basename(absolutePath),
    sha256: imageSha256(data),
  };
  const security = await scanProjectUpdateImage(
    options.malwareScanner ?? new BuiltInImageMalwareScanner(),
    source,
  );
  const preprocessed = await preprocessProjectUpdateImage(source);

  return normalizeProjectUpdateSource({
    image: {
      ...preprocessed,
      security,
    },
  }).image!;
}

export function getProjectUpdateSourceType(source: ProjectUpdateSource) {
  const normalized = normalizeProjectUpdateSource(source);

  if (normalized.text && normalized.image) {
    return "TEXT_IMAGE" as const;
  }

  return normalized.image ? ("IMAGE" as const) : ("TEXT" as const);
}

export function hashProjectUpdateSource(source: ProjectUpdateSource) {
  const normalized = normalizeProjectUpdateSource(source);
  const hash = createHash("sha256");

  hash.update("a1-project-update-source-v1\0");
  hash.update(normalized.text ?? "");
  hash.update("\0");

  if (normalized.image) {
    hash.update(normalized.image.mediaType);
    hash.update("\0");
    hash.update(normalized.image.data);
  }

  return hash.digest("hex");
}
