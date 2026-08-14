import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProjectUpdateImage,
  normalizeProjectUpdateSource,
  preprocessProjectUpdateImage,
} from "../../src/structuring/index.js";

const temporaryDirectories: string[] = [];

function sha256(data: Uint8Array) {
  return createHash("sha256").update(data).digest("hex");
}

async function createImage(
  width: number,
  height: number,
  format: "jpeg" | "png" | "gif",
  orientation?: number,
) {
  let pipeline = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: {
        r: 32,
        g: 96,
        b: 160,
      },
    },
  });

  if (orientation !== undefined) {
    pipeline = pipeline.withMetadata({ orientation });
  }

  if (format === "jpeg") {
    return pipeline.jpeg({ quality: 95 }).toBuffer();
  }

  return format === "png" ? pipeline.png().toBuffer() : pipeline.gif().toBuffer();
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("A1 image preprocessing", () => {
  it("applies EXIF orientation and strips source metadata", async () => {
    const data = await createImage(1_200, 600, "jpeg", 6);
    const result = await preprocessProjectUpdateImage({
      data,
      mediaType: "image/jpeg",
      fileName: "site-photo.jpg",
      sha256: sha256(data),
    });
    const metadata = await sharp(result.data).metadata();

    expect(result.fileName).toBe("site-photo.normalized.jpg");
    expect(result.preprocessing.source.exifOrientation).toBe(6);
    expect(result.preprocessing.output).toMatchObject({
      width: 600,
      height: 1_200,
      exifOrientation: null,
    });
    expect(result.preprocessing.orientationApplied).toBe(true);
    expect(result.preprocessing.operations).toContain("AUTO_ORIENT");
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(result.sha256).toBe(sha256(result.data));
  });

  it("resizes large inputs inside the model image budget", async () => {
    const data = await createImage(4_000, 2_000, "jpeg");
    const result = await preprocessProjectUpdateImage({
      data,
      mediaType: "image/jpeg",
      fileName: "wide.jpg",
      sha256: sha256(data),
    });

    expect(result.preprocessing.output).toMatchObject({
      width: 2_048,
      height: 1_024,
    });
    expect(result.preprocessing.resized).toBe(true);
    expect(result.preprocessing.operations).toContain("RESIZE");
  });

  it("does not enlarge a small PNG", async () => {
    const data = await createImage(320, 240, "png");
    const result = await preprocessProjectUpdateImage({
      data,
      mediaType: "image/png",
      fileName: "small.png",
      sha256: sha256(data),
    });

    expect(result.mediaType).toBe("image/png");
    expect(result.preprocessing.output).toMatchObject({
      width: 320,
      height: 240,
    });
    expect(result.preprocessing.resized).toBe(false);
  });

  it("converts a static GIF to normalized PNG", async () => {
    const data = await createImage(640, 480, "gif");
    const result = await preprocessProjectUpdateImage({
      data,
      mediaType: "image/gif",
      fileName: "legacy.gif",
      sha256: sha256(data),
    });

    expect(result.mediaType).toBe("image/png");
    expect(result.fileName).toBe("legacy.normalized.png");
    expect(result.preprocessing.formatChanged).toBe(true);
    expect(result.preprocessing.operations).toContain("FORMAT_CONVERSION");
  });

  it("rejects tampered transformation provenance", async () => {
    const data = await createImage(320, 240, "png");
    const result = await preprocessProjectUpdateImage({
      data,
      mediaType: "image/png",
      fileName: "small.png",
      sha256: sha256(data),
    });

    expect(() =>
      normalizeProjectUpdateSource({
        image: {
          ...result,
          preprocessing: {
            ...result.preprocessing,
            outputSizeBytes: result.preprocessing.outputSizeBytes + 1,
          },
        },
      }),
    ).toThrow(/provenance does not match/);
  });

  it("preprocesses a filesystem image before returning it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-image-"));
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "phone.jpg");
    const data = await createImage(1_200, 600, "jpeg", 6);
    await writeFile(inputPath, data);

    const result = await loadProjectUpdateImage(inputPath);

    expect(result.fileName).toBe("phone.normalized.jpg");
    expect(result.preprocessing).toMatchObject({
      sourceFileName: "phone.jpg",
      sourceSha256: sha256(data),
      orientationApplied: true,
    });
    expect(result.preprocessing?.output).toMatchObject({
      width: 600,
      height: 1_200,
      exifOrientation: null,
    });
  });

  it("rejects a misleading filesystem extension", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "buildwatch-image-"));
    temporaryDirectories.push(directory);
    const inputPath = path.join(directory, "misleading.png");
    await writeFile(inputPath, await createImage(320, 240, "jpeg"));

    await expect(loadProjectUpdateImage(inputPath)).rejects.toThrow(
      /extension .* does not match image\/jpeg/,
    );
  });
});
