import { z } from "zod";

export const MAX_PROJECT_UPDATE_IMAGE_PIXELS = 40_000_000;
export const MAX_PROJECT_UPDATE_IMAGE_SIDE = 20_000;
export const MAX_PROJECT_UPDATE_IMAGE_FRAMES = 1;

export const projectUpdateImageMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export type ProjectUpdateImageMediaType = z.infer<typeof projectUpdateImageMediaTypeSchema>;

export const projectUpdateExifOrientationSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

export type ProjectUpdateExifOrientation = z.infer<typeof projectUpdateExifOrientationSchema>;

export const projectUpdateImageInspectionSchema = z
  .object({
    mediaType: projectUpdateImageMediaTypeSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    displayWidth: z.number().int().positive(),
    displayHeight: z.number().int().positive(),
    pixelCount: z.number().int().positive(),
    frameCount: z.number().int().positive(),
    exifOrientation: projectUpdateExifOrientationSchema.nullable(),
  })
  .strict();

export type ProjectUpdateImageInspection = z.infer<typeof projectUpdateImageInspectionSchema>;

type ParsedImageMetadata = {
  width: number;
  height: number;
  frameCount: number;
  exifOrientation: ProjectUpdateExifOrientation | null;
};

function startsWith(data: Uint8Array, signature: readonly number[]) {
  return signature.every((value, index) => data[index] === value);
}

function requireBytes(bytes: Buffer, offset: number, length: number, message: string) {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(message);
  }
}

function checkedDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Project update image dimensions are invalid");
  }

  return { width, height };
}

function readUInt24LE(bytes: Buffer, offset: number) {
  requireBytes(bytes, offset, 3, "Project update WEBP dimensions are truncated");
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function parseTiffOrientation(
  bytes: Buffer,
  inputOffset: number,
  inputLength: number,
): ProjectUpdateExifOrientation | null {
  let offset = inputOffset;
  const end = inputOffset + inputLength;

  if (inputLength >= 6 && bytes.toString("ascii", offset, offset + 6) === "Exif\u0000\u0000") {
    offset += 6;
  }

  if (offset + 8 > end) {
    return null;
  }

  const byteOrder = bytes.toString("ascii", offset, offset + 2);
  const littleEndian = byteOrder === "II" ? true : byteOrder === "MM" ? false : null;

  if (littleEndian === null) {
    return null;
  }

  const readUInt16 = (position: number) => {
    if (position + 2 > end) {
      throw new Error("EXIF metadata is truncated");
    }

    return littleEndian ? bytes.readUInt16LE(position) : bytes.readUInt16BE(position);
  };
  const readUInt32 = (position: number) => {
    if (position + 4 > end) {
      throw new Error("EXIF metadata is truncated");
    }

    return littleEndian ? bytes.readUInt32LE(position) : bytes.readUInt32BE(position);
  };

  if (readUInt16(offset + 2) !== 42) {
    return null;
  }

  const firstIfdOffset = readUInt32(offset + 4);
  const firstIfd = offset + firstIfdOffset;

  if (firstIfd + 2 > end) {
    return null;
  }

  const entryCount = readUInt16(firstIfd);

  if (entryCount > 1_024) {
    throw new Error("EXIF metadata contains too many entries");
  }

  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = firstIfd + 2 + index * 12;

    if (entryOffset + 12 > end) {
      throw new Error("EXIF metadata entry is truncated");
    }

    const tag = readUInt16(entryOffset);
    const type = readUInt16(entryOffset + 2);
    const count = readUInt32(entryOffset + 4);

    if (tag !== 0x0112 || type !== 3 || count !== 1) {
      continue;
    }

    const orientation = readUInt16(entryOffset + 8);

    return orientation >= 1 && orientation <= 8
      ? (orientation as ProjectUpdateExifOrientation)
      : null;
  }

  return null;
}

function parsePng(bytes: Buffer): ParsedImageMetadata {
  requireBytes(bytes, 0, 33, "Project update PNG header is truncated");

  if (bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("Project update PNG is missing its IHDR chunk");
  }

  const dimensions = checkedDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  let frameCount = 1;
  let exifOrientation: ProjectUpdateExifOrientation | null = null;
  let offset = 8;

  while (offset + 12 <= bytes.byteLength) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + chunkLength + 4;

    requireBytes(
      bytes,
      dataOffset,
      chunkLength + 4,
      `Project update PNG ${chunkType} chunk is truncated`,
    );

    if (chunkType === "acTL") {
      requireBytes(bytes, dataOffset, 8, "Project update PNG animation metadata is truncated");
      frameCount = bytes.readUInt32BE(dataOffset);
    } else if (chunkType === "eXIf") {
      exifOrientation = parseTiffOrientation(bytes, dataOffset, chunkLength);
    }

    offset = nextOffset;

    if (chunkType === "IEND") {
      break;
    }
  }

  if (frameCount <= 0) {
    throw new Error("Project update PNG frame count is invalid");
  }

  return {
    ...dimensions,
    frameCount,
    exifOrientation,
  };
}

function isJpegStartOfFrame(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function parseJpeg(bytes: Buffer): ParsedImageMetadata {
  requireBytes(bytes, 0, 4, "Project update JPEG header is truncated");

  let offset = 2;
  let width: number | null = null;
  let height: number | null = null;
  let exifOrientation: ProjectUpdateExifOrientation | null = null;

  while (offset < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) {
      offset += 1;
    }

    while (offset < bytes.byteLength && bytes[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= bytes.byteLength) {
      break;
    }

    const marker = bytes[offset]!;
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      continue;
    }

    requireBytes(bytes, offset, 2, "Project update JPEG segment length is truncated");
    const segmentLength = bytes.readUInt16BE(offset);

    if (segmentLength < 2) {
      throw new Error("Project update JPEG segment length is invalid");
    }

    const payloadOffset = offset + 2;
    const payloadLength = segmentLength - 2;
    requireBytes(bytes, payloadOffset, payloadLength, "Project update JPEG segment is truncated");

    if (marker === 0xe1) {
      exifOrientation = parseTiffOrientation(bytes, payloadOffset, payloadLength);
    } else if (isJpegStartOfFrame(marker)) {
      requireBytes(bytes, payloadOffset, 5, "Project update JPEG dimensions are truncated");
      height = bytes.readUInt16BE(payloadOffset + 1);
      width = bytes.readUInt16BE(payloadOffset + 3);
    }

    offset += segmentLength;
  }

  if (width === null || height === null) {
    throw new Error("Project update JPEG dimensions were not found");
  }

  return {
    ...checkedDimensions(width, height),
    frameCount: 1,
    exifOrientation,
  };
}

function skipGifSubBlocks(bytes: Buffer, inputOffset: number) {
  let offset = inputOffset;

  while (true) {
    requireBytes(bytes, offset, 1, "Project update GIF data is truncated");
    const blockLength = bytes[offset]!;
    offset += 1;

    if (blockLength === 0) {
      return offset;
    }

    requireBytes(bytes, offset, blockLength, "Project update GIF data block is truncated");
    offset += blockLength;
  }
}

function parseGif(bytes: Buffer): ParsedImageMetadata {
  requireBytes(bytes, 0, 13, "Project update GIF header is truncated");
  const dimensions = checkedDimensions(bytes.readUInt16LE(6), bytes.readUInt16LE(8));
  const globalColorTableFlag = (bytes[10]! & 0x80) !== 0;
  const globalColorTableSize = 3 * 2 ** ((bytes[10]! & 0x07) + 1);
  let offset = 13 + (globalColorTableFlag ? globalColorTableSize : 0);
  let frameCount = 0;

  while (offset < bytes.byteLength) {
    const blockType = bytes[offset]!;
    offset += 1;

    if (blockType === 0x3b) {
      break;
    }

    if (blockType === 0x21) {
      requireBytes(bytes, offset, 1, "Project update GIF extension is truncated");
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }

    if (blockType !== 0x2c) {
      throw new Error("Project update GIF contains an invalid block");
    }

    requireBytes(bytes, offset, 9, "Project update GIF image descriptor is truncated");
    const localPacked = bytes[offset + 8]!;
    offset += 9;

    if ((localPacked & 0x80) !== 0) {
      offset += 3 * 2 ** ((localPacked & 0x07) + 1);
    }

    requireBytes(bytes, offset, 1, "Project update GIF LZW metadata is truncated");
    offset += 1;
    offset = skipGifSubBlocks(bytes, offset);
    frameCount += 1;
  }

  if (frameCount === 0) {
    throw new Error("Project update GIF contains no image frames");
  }

  return {
    ...dimensions,
    frameCount,
    exifOrientation: null,
  };
}

function parseWebp(bytes: Buffer): ParsedImageMetadata {
  requireBytes(bytes, 0, 20, "Project update WEBP header is truncated");
  const declaredEnd = bytes.readUInt32LE(4) + 8;

  if (declaredEnd > bytes.byteLength) {
    throw new Error("Project update WEBP container is truncated");
  }

  let offset = 12;
  let width: number | null = null;
  let height: number | null = null;
  let animationDeclared = false;
  let animationFrames = 0;
  let exifOrientation: ProjectUpdateExifOrientation | null = null;

  while (offset + 8 <= declaredEnd) {
    const chunkType = bytes.toString("ascii", offset, offset + 4);
    const chunkLength = bytes.readUInt32LE(offset + 4);
    const payloadOffset = offset + 8;

    requireBytes(
      bytes,
      payloadOffset,
      chunkLength,
      `Project update WEBP ${chunkType} chunk is truncated`,
    );

    if (chunkType === "VP8X") {
      requireBytes(bytes, payloadOffset, 10, "Project update WEBP VP8X header is truncated");
      animationDeclared = (bytes[payloadOffset]! & 0x02) !== 0;
      width = readUInt24LE(bytes, payloadOffset + 4) + 1;
      height = readUInt24LE(bytes, payloadOffset + 7) + 1;
    } else if (chunkType === "VP8 ") {
      requireBytes(bytes, payloadOffset, 10, "Project update WEBP VP8 header is truncated");

      if (!startsWith(bytes.subarray(payloadOffset + 3), [0x9d, 0x01, 0x2a])) {
        throw new Error("Project update WEBP VP8 frame header is invalid");
      }

      width = bytes.readUInt16LE(payloadOffset + 6) & 0x3fff;
      height = bytes.readUInt16LE(payloadOffset + 8) & 0x3fff;
    } else if (chunkType === "VP8L") {
      requireBytes(bytes, payloadOffset, 5, "Project update WEBP VP8L header is truncated");

      if (bytes[payloadOffset] !== 0x2f) {
        throw new Error("Project update WEBP VP8L signature is invalid");
      }

      const packed = bytes.readUInt32LE(payloadOffset + 1);
      width = (packed & 0x3fff) + 1;
      height = ((packed >>> 14) & 0x3fff) + 1;
    } else if (chunkType === "ANMF") {
      animationFrames += 1;
    } else if (chunkType === "EXIF") {
      exifOrientation = parseTiffOrientation(bytes, payloadOffset, chunkLength);
    }

    offset = payloadOffset + chunkLength + (chunkLength % 2);
  }

  if (width === null || height === null) {
    throw new Error("Project update WEBP dimensions were not found");
  }

  return {
    ...checkedDimensions(width, height),
    frameCount: animationFrames > 0 ? animationFrames : animationDeclared ? 2 : 1,
    exifOrientation,
  };
}

export function detectProjectUpdateImageMediaType(data: Uint8Array): ProjectUpdateImageMediaType {
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  if (startsWith(data, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }

  if (
    startsWith(data, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...data.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  const gifHeader = String.fromCharCode(...data.slice(0, 6));

  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") {
    return "image/gif";
  }

  throw new Error("Unsupported or invalid image; use PNG, JPEG, WEBP, or GIF");
}

export function assertProjectUpdateImageWithinLimits(inspection: ProjectUpdateImageInspection) {
  if (
    inspection.width > MAX_PROJECT_UPDATE_IMAGE_SIDE ||
    inspection.height > MAX_PROJECT_UPDATE_IMAGE_SIDE
  ) {
    throw new Error(
      `Project update image side must not exceed ${MAX_PROJECT_UPDATE_IMAGE_SIDE} pixels`,
    );
  }

  if (
    !Number.isSafeInteger(inspection.pixelCount) ||
    inspection.pixelCount > MAX_PROJECT_UPDATE_IMAGE_PIXELS
  ) {
    throw new Error(
      `Project update image must not exceed ${MAX_PROJECT_UPDATE_IMAGE_PIXELS} pixels`,
    );
  }

  if (inspection.frameCount > MAX_PROJECT_UPDATE_IMAGE_FRAMES) {
    throw new Error("Animated or multi-frame project update images are not supported");
  }
}

export function inspectProjectUpdateImage(data: Uint8Array): ProjectUpdateImageInspection {
  const bytes = Buffer.from(data);
  const mediaType = detectProjectUpdateImageMediaType(bytes);
  const metadata =
    mediaType === "image/png"
      ? parsePng(bytes)
      : mediaType === "image/jpeg"
        ? parseJpeg(bytes)
        : mediaType === "image/webp"
          ? parseWebp(bytes)
          : parseGif(bytes);
  const swapsDisplayDimensions =
    metadata.exifOrientation !== null &&
    metadata.exifOrientation >= 5 &&
    metadata.exifOrientation <= 8;
  const inspection = projectUpdateImageInspectionSchema.parse({
    mediaType,
    width: metadata.width,
    height: metadata.height,
    displayWidth: swapsDisplayDimensions ? metadata.height : metadata.width,
    displayHeight: swapsDisplayDimensions ? metadata.width : metadata.height,
    pixelCount: metadata.width * metadata.height,
    frameCount: metadata.frameCount,
    exifOrientation: metadata.exifOrientation,
  });

  assertProjectUpdateImageWithinLimits(inspection);
  return inspection;
}
