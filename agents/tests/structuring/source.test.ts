import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  detectProjectUpdateImageMediaType,
  getProjectUpdateSourceType,
  hashProjectUpdateSource,
  normalizeProjectUpdateSource,
} from "../../src/structuring/source.js";
import { createJpegFixture, createPngFixture } from "./image-fixtures.js";

describe("A1 multimodal source", () => {
  it("detects supported image signatures", () => {
    expect(
      detectProjectUpdateImageMediaType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(detectProjectUpdateImageMediaType(Buffer.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
  });

  it("normalizes combined text and image sources with a stable hash", () => {
    const image = createPngFixture();
    const source = normalizeProjectUpdateSource({
      text: "  AT-001 completed  ",
      image: {
        data: image,
        mediaType: "image/png",
        fileName: "update.png",
        sha256: createHash("sha256").update(image).digest("hex"),
      },
    });

    expect(getProjectUpdateSourceType(source)).toBe("TEXT_IMAGE");
    expect(source.text).toBe("AT-001 completed");
    expect(hashProjectUpdateSource(source)).toBe(hashProjectUpdateSource(source));
  });

  it("rejects an image with an invalid checksum", () => {
    expect(() =>
      normalizeProjectUpdateSource({
        image: {
          data: createJpegFixture(),
          mediaType: "image/jpeg",
          fileName: "update.jpg",
          sha256: "0".repeat(64),
        },
      }),
    ).toThrow("checksum");
  });
});
