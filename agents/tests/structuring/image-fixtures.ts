export function createPngFixture(
  width = 1,
  height = 1,
  orientation?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdr),
    ...(orientation === undefined
      ? []
      : [createPngChunk("eXIf", createTiffOrientationFixture(orientation))]),
    createPngChunk("IDAT", Buffer.alloc(0)),
    createPngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function createPngChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(data.byteLength + 12);
  chunk.writeUInt32BE(data.byteLength, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  return chunk;
}

function createTiffOrientationFixture(orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8) {
  const tiff = Buffer.alloc(26);
  tiff.write("II", 0, "ascii");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt32LE(0, 22);
  return tiff;
}

export function createJpegFixture(
  width = 1,
  height = 1,
  orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 = 1,
): Buffer {
  const exifPayload = Buffer.concat([
    Buffer.from("Exif\u0000\u0000", "ascii"),
    createTiffOrientationFixture(orientation),
  ]);

  const app1 = Buffer.alloc(4 + exifPayload.byteLength);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(exifPayload.byteLength + 2, 2);
  exifPayload.copy(app1, 4);

  const sof = Buffer.alloc(13);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(11, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 1;
  sof[10] = 1;
  sof[11] = 0x11;
  sof[12] = 0;

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]);
}

export function createGifFixture(width = 1, height = 1, frameCount = 1): Buffer {
  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  const frames = Array.from({ length: frameCount }, () =>
    Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0]),
  );

  return Buffer.concat([header, ...frames, Buffer.from([0x3b])]);
}

export function createWebpFixture(
  width = 1,
  height = 1,
  animated = false,
  orientation?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = (animated ? 0x02 : 0) | (orientation === undefined ? 0 : 0x08);
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const chunks = [
    createWebpChunk("VP8X", vp8x),
    ...(orientation === undefined
      ? []
      : [createWebpChunk("EXIF", createTiffOrientationFixture(orientation))]),
  ];
  const payload = Buffer.concat([Buffer.from("WEBP", "ascii"), ...chunks]);
  const bytes = Buffer.alloc(payload.byteLength + 8);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(payload.byteLength, 4);
  payload.copy(bytes, 8);
  return bytes;
}

function createWebpChunk(type: string, data: Buffer) {
  const chunk = Buffer.alloc(8 + data.byteLength + (data.byteLength % 2));
  chunk.write(type, 0, "ascii");
  chunk.writeUInt32LE(data.byteLength, 4);
  data.copy(chunk, 8);
  return chunk;
}
