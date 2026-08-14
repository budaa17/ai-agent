import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pdfPageProfileV1Schema, type PdfPageProfileV1 } from "./contracts.js";

export type PdfNormalizedRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextSpan = {
  text: string;
  pageNumber: number;
  region: PdfNormalizedRegion;
  originPt: readonly [number, number];
};

export type PdfVectorPath = {
  pageNumber: number;
  region: PdfNormalizedRegion;
  boundsPt: readonly [number, number, number, number];
};

export type InspectedPdfPage = PdfPageProfileV1 & {
  textSpans: readonly PdfTextSpan[];
  vectorPaths: readonly PdfVectorPath[];
};

export type InspectedPdfDocument = {
  pageCount: number;
  pages: readonly InspectedPdfPage[];
  text: string;
};

const imageOperators = new Set<number>([
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintSolidColorImageMask,
]);

const directVectorOperators = new Set<number>([
  OPS.moveTo,
  OPS.lineTo,
  OPS.curveTo,
  OPS.curveTo2,
  OPS.curveTo3,
  OPS.rectangle,
  OPS.rawFillPath,
]);

function normalizedRotation(value: number): 0 | 90 | 180 | 270 {
  const rotation = ((value % 360) + 360) % 360;
  if (rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270) {
    return rotation;
  }
  throw new Error(`Unsupported PDF page rotation: ${value}`);
}

function normalizeViewportRectangle(
  rectangle: readonly number[],
  width: number,
  height: number,
): PdfNormalizedRegion {
  const x1 = Math.min(rectangle[0] ?? 0, rectangle[2] ?? 0);
  const y1 = Math.min(rectangle[1] ?? 0, rectangle[3] ?? 0);
  const x2 = Math.max(rectangle[0] ?? 0, rectangle[2] ?? 0);
  const y2 = Math.max(rectangle[1] ?? 0, rectangle[3] ?? 0);
  const safeWidth = Math.max(1, x2 - x1);
  const safeHeight = Math.max(1, y2 - y1);
  const x = Math.max(0, Math.min(1, x1 / width));
  const y = Math.max(0, Math.min(1, y1 / height));

  return {
    x,
    y,
    width: Math.max(Number.EPSILON, Math.min(1 - x, safeWidth / width)),
    height: Math.max(Number.EPSILON, Math.min(1 - y, safeHeight / height)),
  };
}

function pageContentMode(
  vectorOperatorCount: number,
  imageOperatorCount: number,
): PdfPageProfileV1["contentMode"] {
  if (vectorOperatorCount > 0 && imageOperatorCount > 0) {
    return "MIXED";
  }
  if (vectorOperatorCount > 0) {
    return "VECTOR";
  }
  if (imageOperatorCount > 0) {
    return "RASTER";
  }
  return "EMPTY";
}

export async function inspectPdfDocument(
  data: Uint8Array,
  options: { maxPages: number },
): Promise<InspectedPdfDocument> {
  if (data.byteLength < 8 || Buffer.from(data.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("File signature is not a PDF document");
  }

  const loadingTask = getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    isEvalSupported: false,
    stopAtErrors: true,
    useSystemFonts: false,
    verbosity: 0,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > options.maxPages) {
      throw new Error(
        `PDF page count ${document.numPages} exceeds allowed range 1-${options.maxPages}`,
      );
    }

    const pages: InspectedPdfPage[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const operatorList = await page.getOperatorList();
      const textContent = await page.getTextContent({
        disableNormalization: false,
        includeMarkedContent: false,
      });
      const textSpans: PdfTextSpan[] = [];

      for (const item of textContent.items) {
        if (!("str" in item) || item.str.trim().length === 0) {
          continue;
        }

        const originX = Number(item.transform[4] ?? 0);
        const originY = Number(item.transform[5] ?? 0);
        const textHeight = Math.max(1, Math.abs(item.height));
        const textWidth = Math.max(1, Math.abs(item.width));
        const viewportRectangle = viewport.convertToViewportRectangle([
          originX,
          originY - textHeight,
          originX + textWidth,
          originY,
        ]);
        textSpans.push({
          text: item.str.trim(),
          pageNumber,
          region: normalizeViewportRectangle(viewportRectangle, viewport.width, viewport.height),
          originPt: [originX, originY],
        });
      }

      let vectorOperatorCount = 0;
      let imageOperatorCount = 0;
      const vectorPaths: PdfVectorPath[] = [];

      operatorList.fnArray.forEach((operator, index) => {
        if (imageOperators.has(operator)) {
          imageOperatorCount += 1;
        }

        if (directVectorOperators.has(operator)) {
          vectorOperatorCount += 1;
        }

        if (operator !== OPS.constructPath) {
          return;
        }

        vectorOperatorCount += 1;
        const args = operatorList.argsArray[index] as unknown[] | undefined;
        const minMax = args?.[2];
        if (
          !Array.isArray(minMax) &&
          !(minMax instanceof Float32Array) &&
          !(minMax instanceof Float64Array)
        ) {
          return;
        }

        const values = Array.from(minMax);
        if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
          return;
        }

        const bounds = [
          Number(values[0]),
          Number(values[1]),
          Number(values[2]),
          Number(values[3]),
        ] as const;
        const viewportRectangle = viewport.convertToViewportRectangle([...bounds]);
        vectorPaths.push({
          pageNumber,
          region: normalizeViewportRectangle(viewportRectangle, viewport.width, viewport.height),
          boundsPt: bounds,
        });
      });

      const profile = pdfPageProfileV1Schema.parse({
        schemaVersion: 1,
        pageNumber,
        widthPt: viewport.width,
        heightPt: viewport.height,
        rotation: normalizedRotation(page.rotate),
        vectorOperatorCount,
        imageOperatorCount,
        textItemCount: textSpans.length,
        contentMode: pageContentMode(vectorOperatorCount, imageOperatorCount),
      });
      pages.push({ ...profile, textSpans, vectorPaths });
      page.cleanup();
    }

    return {
      pageCount: document.numPages,
      pages,
      text: pages.flatMap((page) => page.textSpans.map((span) => span.text)).join("\n"),
    };
  } finally {
    await loadingTask.destroy();
  }
}
