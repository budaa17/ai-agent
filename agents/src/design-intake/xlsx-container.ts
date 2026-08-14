export type XlsxContainerEntry = {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  compressionMethod: number;
};

export type XlsxContainerPolicy = {
  maxEntries: number;
  maxUncompressedBytes: number;
  maxCompressionRatio: number;
};

export type XlsxContainerInspection = {
  entries: readonly XlsxContainerEntry[];
};

function findEndOfCentralDirectory(data: Uint8Array): number {
  const minimumOffset = Math.max(0, data.byteLength - 65_557);
  for (let offset = data.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (
      data[offset] === 0x50 &&
      data[offset + 1] === 0x4b &&
      data[offset + 2] === 0x05 &&
      data[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("XLSX ZIP central directory was not found");
}

function safeEntryName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 1_000 &&
    !name.includes("\\") &&
    !name.startsWith("/") &&
    !/^[A-Za-z]:/u.test(name) &&
    !name.split("/").includes("..")
  );
}

export function inspectXlsxContainer(
  data: Uint8Array,
  policy: XlsxContainerPolicy,
): XlsxContainerInspection {
  if (data.byteLength < 22 || data[0] !== 0x50 || data[1] !== 0x4b) {
    throw new Error("File signature is not an XLSX ZIP package");
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const eocdOffset = findEndOfCentralDirectory(data);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0) {
    throw new Error("Multi-disk XLSX packages are not supported");
  }
  if (entryCount < 1 || entryCount > policy.maxEntries) {
    throw new Error(`XLSX entry count ${entryCount} exceeds allowed range 1-${policy.maxEntries}`);
  }
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset || centralDirectoryOffset < 0) {
    throw new Error("XLSX central directory is outside the package bounds");
  }

  const entries: XlsxContainerEntry[] = [];
  let offset = centralDirectoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("XLSX central directory entry is malformed");
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;

    if (entryEnd > data.byteLength) {
      throw new Error("XLSX central directory entry exceeds package bounds");
    }
    if ((flags & 0x0001) !== 0) {
      throw new Error("Encrypted XLSX entries are not supported");
    }
    if (![0, 8].includes(compressionMethod)) {
      throw new Error(`Unsupported XLSX compression method ${compressionMethod}`);
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error("ZIP64 XLSX packages are outside the narrow MVP");
    }

    const name = Buffer.from(data.subarray(offset + 46, offset + 46 + nameLength)).toString("utf8");
    if (!safeEntryName(name)) {
      throw new Error(`Unsafe XLSX package entry: ${name}`);
    }
    if (compressedSize > 0 && uncompressedSize / compressedSize > policy.maxCompressionRatio) {
      throw new Error(`XLSX compression ratio exceeds policy for ${name}`);
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > policy.maxUncompressedBytes) {
      throw new Error(`XLSX expanded size exceeds ${policy.maxUncompressedBytes} bytes`);
    }

    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
    });
    offset = entryEnd;
  }

  const names = new Set(entries.map((entry) => entry.name));
  for (const required of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml"]) {
    if (!names.has(required)) {
      throw new Error(`XLSX package is missing ${required}`);
    }
  }

  const forbidden = entries.find((entry) =>
    /(?:vbaProject\.bin|activeX\/|embeddings\/|externalLinks\/)/iu.test(entry.name),
  );
  if (forbidden !== undefined) {
    throw new Error(`Active or external XLSX content is blocked: ${forbidden.name}`);
  }

  return { entries };
}
