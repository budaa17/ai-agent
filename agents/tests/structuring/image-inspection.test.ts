import { describe, expect, it } from "vitest";
import {
  inspectProjectUpdateImage,
  MAX_PROJECT_UPDATE_IMAGE_PIXELS,
} from "../../src/structuring/index.js";
import {
  createGifFixture,
  createJpegFixture,
  createPngFixture,
  createWebpFixture,
} from "./image-fixtures.js";

describe("A1 project-update image inspection", () => {
  it("reads PNG dimensions and pixel count", () => {
    expect(inspectProjectUpdateImage(createPngFixture(640, 480))).toEqual({
      mediaType: "image/png",
      width: 640,
      height: 480,
      displayWidth: 640,
      displayHeight: 480,
      pixelCount: 307_200,
      frameCount: 1,
      exifOrientation: null,
    });
  });

  it("reads JPEG EXIF orientation and display dimensions", () => {
    expect(inspectProjectUpdateImage(createJpegFixture(400, 300, 6))).toMatchObject({
      mediaType: "image/jpeg",
      width: 400,
      height: 300,
      displayWidth: 300,
      displayHeight: 400,
      exifOrientation: 6,
    });
  });

  it("reads PNG and WEBP EXIF orientation metadata", () => {
    expect(inspectProjectUpdateImage(createPngFixture(320, 240, 8))).toMatchObject({
      mediaType: "image/png",
      displayWidth: 240,
      displayHeight: 320,
      exifOrientation: 8,
    });
    expect(inspectProjectUpdateImage(createWebpFixture(800, 600, false, 3))).toMatchObject({
      mediaType: "image/webp",
      displayWidth: 800,
      displayHeight: 600,
      exifOrientation: 3,
    });
  });

  it("reads WEBP and GIF dimensions", () => {
    expect(inspectProjectUpdateImage(createWebpFixture(1_024, 768))).toMatchObject({
      mediaType: "image/webp",
      width: 1_024,
      height: 768,
      frameCount: 1,
    });
    expect(inspectProjectUpdateImage(createGifFixture(320, 240))).toMatchObject({
      mediaType: "image/gif",
      width: 320,
      height: 240,
      frameCount: 1,
    });
  });

  it("rejects images above the pixel budget", () => {
    expect(() => inspectProjectUpdateImage(createPngFixture(10_000, 5_000))).toThrow(
      `${MAX_PROJECT_UPDATE_IMAGE_PIXELS} pixels`,
    );
  });

  it("rejects an image side above the dimension budget", () => {
    expect(() => inspectProjectUpdateImage(createPngFixture(20_001, 1))).toThrow(
      "side must not exceed 20000 pixels",
    );
  });

  it("rejects animated or multi-frame images", () => {
    expect(() => inspectProjectUpdateImage(createGifFixture(1, 1, 2))).toThrow(
      "Animated or multi-frame",
    );
    expect(() => inspectProjectUpdateImage(createWebpFixture(1, 1, true))).toThrow(
      "Animated or multi-frame",
    );
  });

  it("rejects a signature-only malformed image", () => {
    expect(() =>
      inspectProjectUpdateImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toThrow("header is truncated");
  });
});
