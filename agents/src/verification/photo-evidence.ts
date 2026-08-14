import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  photoEvidenceByteInspectionV1Schema,
  photoEvidenceEvaluationRequestV1Schema,
  photoEvidenceEvaluationV1Schema,
  type BuildWatchSourceReference,
  type PhotoEvidenceByteInspectionV1,
  type PhotoEvidenceEvaluationRequestV1,
  type PhotoEvidenceEvaluationV1,
  type PhotoEvidenceHistoryEntryV1,
  type PhotoEvidenceSubmissionV1,
} from "../contracts/index.js";
import {
  inspectProjectUpdateImage,
  MAX_PROJECT_UPDATE_IMAGE_PIXELS,
  type ProjectUpdateImageMediaType,
} from "../structuring/image-inspection.js";

type PhotoCheck = PhotoEvidenceEvaluationV1["photoResults"][number]["checks"][number];
type PhotoCheckCode = PhotoCheck["code"];
type PhotoCheckResult = PhotoCheck["result"];

type DuplicateCandidate = {
  photoId: string;
  artifactId: string;
  reportDate: string;
  capturedAt: string;
  reportedWorkItemId: string;
  sha256: string;
  perceptualHash: string | null;
  sourceRefs: BuildWatchSourceReference[];
};

type PreliminaryPhotoResult = {
  photo: PhotoEvidenceSubmissionV1;
  checks: Map<PhotoCheckCode, PhotoCheck>;
  exactDuplicate: DuplicateCandidate | null;
  nearDuplicate: DuplicateCandidate | null;
  nearDuplicateDistance: number | null;
  reusedCandidate: DuplicateCandidate | null;
  usableForEvidence: boolean;
};

const INTRINSIC_CHECK_CODES = [
  "PE-01",
  "PE-02",
  "PE-03",
  "PE-04",
  "PE-05",
  "PE-06",
  "PE-09",
  "PE-10",
] as const satisfies readonly PhotoCheckCode[];

const ALL_CHECK_CODES = [
  "PE-01",
  "PE-02",
  "PE-03",
  "PE-04",
  "PE-05",
  "PE-06",
  "PE-07",
  "PE-08",
  "PE-09",
  "PE-10",
] as const satisfies readonly PhotoCheckCode[];

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedId(prefix: string, value: string): string {
  const candidate = `${prefix}-${value}`;
  return candidate.length <= 200 ? candidate : `${prefix}-${sha256(candidate).slice(0, 32)}`;
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
}

function dedupeSources(sources: readonly BuildWatchSourceReference[]): BuildWatchSourceReference[] {
  const byId = new Map<string, BuildWatchSourceReference>();
  for (const source of sources) {
    byId.set(source.sourceRefId, source);
  }
  return [...byId.values()].sort((left, right) =>
    left.sourceRefId.localeCompare(right.sourceRefId),
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function canonicalRequest(request: PhotoEvidenceEvaluationRequestV1) {
  const sourceSort = (sources: readonly BuildWatchSourceReference[]) =>
    [...sources].sort((left, right) => left.sourceRefId.localeCompare(right.sourceRefId));
  return {
    ...request,
    policy: {
      ...request.policy,
      requiredAngles: [...request.policy.requiredAngles].sort(),
      sourceRefs: sourceSort(request.policy.sourceRefs),
    },
    photos: [...request.photos]
      .map((photo) => ({
        ...photo,
        observedAngles: [...photo.observedAngles].sort(),
        privacySignals: [...photo.privacySignals].sort(),
        sourceRefs: sourceSort(photo.sourceRefs),
      }))
      .sort((left, right) => left.photoId.localeCompare(right.photoId)),
    history: [...request.history]
      .map((photo) => ({
        ...photo,
        sourceRefs: sourceSort(photo.sourceRefs),
      }))
      .sort(compareCandidates),
  };
}

function failedInspection(
  expectedMediaType: ProjectUpdateImageMediaType,
  data: Uint8Array,
  errorCode: PhotoEvidenceByteInspectionV1["errorCode"],
  actualMediaType: ProjectUpdateImageMediaType | null,
): PhotoEvidenceByteInspectionV1 {
  return photoEvidenceByteInspectionV1Schema.parse({
    schemaVersion: 1,
    inspectionType: "PHOTO_BYTE_INSPECTION",
    expectedMediaType,
    actualMediaType,
    sizeBytes: data.byteLength,
    sha256: sha256(data),
    decoded: false,
    widthPixels: null,
    heightPixels: null,
    sharpnessScore: null,
    brightnessScore: null,
    perceptualHash: null,
    errorCode,
    methodVersion: "buildwatch-photo-inspection-v1",
    deterministic: true,
  });
}

function calculateImageScores(pixels: Uint8Array, width: number, height: number) {
  let brightnessTotal = 0;
  let edgeTotal = 0;
  let edgeCount = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = pixels[index]!;
      brightnessTotal += value;
      if (x > 0) {
        edgeTotal += Math.abs(value - pixels[index - 1]!);
        edgeCount += 1;
      }
      if (y > 0) {
        edgeTotal += Math.abs(value - pixels[index - width]!);
        edgeCount += 1;
      }
    }
  }
  const brightness = brightnessTotal / Math.max(1, pixels.length) / 255;
  const meanEdge = edgeTotal / Math.max(1, edgeCount);
  return {
    brightnessScore: roundScore(brightness),
    sharpnessScore: roundScore(meanEdge / 32),
  };
}

function perceptualDifferenceHash(pixels: Uint8Array): string {
  let bits = 0n;
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      bits <<= 1n;
      const offset = row * 9 + column;
      if (pixels[offset]! > pixels[offset + 1]!) {
        bits |= 1n;
      }
    }
  }
  return bits.toString(16).padStart(16, "0");
}

export async function inspectPhotoEvidenceBytes(input: {
  data: Uint8Array;
  mediaType: ProjectUpdateImageMediaType;
}): Promise<PhotoEvidenceByteInspectionV1> {
  let inspected: ReturnType<typeof inspectProjectUpdateImage> | null = null;
  try {
    inspected = inspectProjectUpdateImage(input.data);
    if (inspected.mediaType !== input.mediaType) {
      return failedInspection(
        input.mediaType,
        input.data,
        "MEDIA_TYPE_MISMATCH",
        inspected.mediaType,
      );
    }
    const image = sharp(Buffer.from(input.data), {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_PROJECT_UPDATE_IMAGE_PIXELS,
      sequentialRead: true,
    }).autoOrient();
    const quality = await image
      .clone()
      .greyscale()
      .resize({
        width: 256,
        height: 256,
        fit: "inside",
        withoutEnlargement: true,
      })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hashPixels = await image
      .clone()
      .greyscale()
      .resize(9, 8, { fit: "fill" })
      .raw()
      .toBuffer();
    const scores = calculateImageScores(quality.data, quality.info.width, quality.info.height);
    return photoEvidenceByteInspectionV1Schema.parse({
      schemaVersion: 1,
      inspectionType: "PHOTO_BYTE_INSPECTION",
      expectedMediaType: input.mediaType,
      actualMediaType: inspected.mediaType,
      sizeBytes: input.data.byteLength,
      sha256: sha256(input.data),
      decoded: true,
      widthPixels: inspected.displayWidth,
      heightPixels: inspected.displayHeight,
      sharpnessScore: scores.sharpnessScore,
      brightnessScore: scores.brightnessScore,
      perceptualHash: perceptualDifferenceHash(hashPixels),
      errorCode: null,
      methodVersion: "buildwatch-photo-inspection-v1",
      deterministic: true,
    });
  } catch {
    return failedInspection(
      input.mediaType,
      input.data,
      "IMAGE_DECODE_FAILED",
      inspected?.mediaType ?? null,
    );
  }
}

function compareCandidates(left: DuplicateCandidate, right: DuplicateCandidate): number {
  return (
    left.reportDate.localeCompare(right.reportDate) ||
    left.capturedAt.localeCompare(right.capturedAt) ||
    left.photoId.localeCompare(right.photoId)
  );
}

function hammingDistance(left: string, right: string): number {
  let difference = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (difference > 0n) {
    count += Number(difference & 1n);
    difference >>= 1n;
  }
  return count;
}

function calculationSource(request: PhotoEvidenceEvaluationRequestV1): BuildWatchSourceReference {
  return {
    sourceRefId: boundedId("source-photo-evaluation", request.requestId),
    tenantId: request.tenantId,
    projectId: request.projectId,
    sourceType: "SYSTEM_CALCULATION",
    sourceId: boundedId("photo-evaluation", request.requestId),
    sourceVersionId: request.policy.policyVersionId,
    artifactId: null,
    pageNumber: null,
    sheetName: null,
    rowNumber: null,
    fieldPath: null,
    region: null,
    asOf: request.generatedAt,
    sha256: null,
  };
}

function makeCheck(input: {
  request: PhotoEvidenceEvaluationRequestV1;
  photo: PhotoEvidenceSubmissionV1;
  code: PhotoCheckCode;
  result: PhotoCheckResult;
  score: number | null;
  message: string;
  calculation: BuildWatchSourceReference;
  extraSources?: readonly BuildWatchSourceReference[];
}): PhotoCheck {
  return {
    checkId: boundedId(
      "photo-check",
      `${input.request.requestId}-${input.photo.photoId}-${input.code}`,
    ),
    photoArtifactId: input.photo.artifactId,
    code: input.code,
    result: input.result,
    score: input.score === null ? null : roundScore(input.score),
    message: input.message,
    deterministic: true,
    sourceRefs: dedupeSources([
      ...input.photo.sourceRefs,
      ...input.request.policy.sourceRefs,
      input.calculation,
      ...(input.extraSources ?? []),
    ]),
  };
}

function asCandidate(
  photo: PhotoEvidenceSubmissionV1 | PhotoEvidenceHistoryEntryV1,
): DuplicateCandidate {
  if ("inspection" in photo) {
    return {
      photoId: photo.photoId,
      artifactId: photo.artifactId,
      reportDate: photo.reportDate,
      capturedAt: photo.capturedAt,
      reportedWorkItemId: photo.reportedWorkItemId,
      sha256: photo.inspection.sha256,
      perceptualHash: photo.inspection.perceptualHash,
      sourceRefs: photo.sourceRefs,
    };
  }
  return photo;
}

function findNearDuplicate(
  photo: PhotoEvidenceSubmissionV1,
  candidates: readonly DuplicateCandidate[],
  threshold: number,
): { candidate: DuplicateCandidate; distance: number } | null {
  const hash = photo.inspection.perceptualHash;
  if (hash === null) {
    return null;
  }
  const matches = candidates
    .filter((candidate) => candidate.perceptualHash !== null)
    .map((candidate) => ({
      candidate,
      distance: hammingDistance(hash, candidate.perceptualHash!),
    }))
    .filter((match) => match.distance <= threshold)
    .sort(
      (left, right) =>
        left.distance - right.distance || compareCandidates(left.candidate, right.candidate),
    );
  return matches[0] ?? null;
}

function chronologicalCheck(
  request: PhotoEvidenceEvaluationRequestV1,
  photo: PhotoEvidenceSubmissionV1,
) {
  const captured = Date.parse(photo.capturedAt);
  const uploaded = Date.parse(photo.uploadedAt);
  const ageMinutes = (uploaded - captured) / 60_000;
  const valid =
    photo.reportDate === request.reportDate &&
    photo.capturedAt.slice(0, 10) === request.reportDate &&
    ageMinutes >= 0 &&
    ageMinutes <= request.policy.maxPhotoAgeMinutes;
  return { valid, ageMinutes };
}

function buildPreliminaryResults(
  request: PhotoEvidenceEvaluationRequestV1,
  calculation: BuildWatchSourceReference,
): PreliminaryPhotoResult[] {
  const previousCandidates = request.history.map(asCandidate).sort(compareCandidates);
  const results: PreliminaryPhotoResult[] = [];
  const photos = [...request.photos].sort((left, right) =>
    left.photoId.localeCompare(right.photoId),
  );

  for (const photo of photos) {
    const checks = new Map<PhotoCheckCode, PhotoCheck>();
    checks.set(
      "PE-01",
      makeCheck({
        request,
        photo,
        code: "PE-01",
        result: photo.inspection.decoded ? "PASS" : "FAIL",
        score: photo.inspection.decoded ? 1 : 0,
        message: photo.inspection.decoded
          ? "Зургийн файл амжилттай нээгдэж, төрөл баталгаажсан."
          : `Зургийн файл нээгдсэнгүй: ${photo.inspection.errorCode}.`,
        calculation,
      }),
    );

    const qualityAvailable =
      photo.inspection.decoded &&
      photo.inspection.sharpnessScore !== null &&
      photo.inspection.brightnessScore !== null;
    const qualityPass =
      qualityAvailable &&
      photo.inspection.sharpnessScore! >= request.policy.minimumSharpnessScore &&
      photo.inspection.brightnessScore! >= request.policy.minimumBrightnessScore &&
      photo.inspection.brightnessScore! <= request.policy.maximumBrightnessScore;
    checks.set(
      "PE-02",
      makeCheck({
        request,
        photo,
        code: "PE-02",
        result: !qualityAvailable ? "NOT_APPLICABLE" : qualityPass ? "PASS" : "FAIL",
        score: qualityAvailable
          ? Math.min(
              photo.inspection.sharpnessScore!,
              photo.inspection.brightnessScore!,
              1 - photo.inspection.brightnessScore!,
            )
          : null,
        message: !qualityAvailable
          ? "Decode амжилтгүй тул blur/brightness шалгалт хийгдээгүй."
          : qualityPass
            ? "Зургийн sharpness болон exposure босго хангасан."
            : "Зураг blur, хэт харанхуй эсвэл хэт гэрэлтэй байна.",
        calculation,
      }),
    );

    const exactDuplicate =
      previousCandidates.find((candidate) => candidate.sha256 === photo.inspection.sha256) ?? null;
    const nearMatch =
      exactDuplicate === null
        ? findNearDuplicate(
            photo,
            previousCandidates,
            request.policy.nearDuplicateHammingDistanceThreshold,
          )
        : null;
    checks.set(
      "PE-03",
      makeCheck({
        request,
        photo,
        code: "PE-03",
        result: exactDuplicate !== null ? "FAIL" : nearMatch !== null ? "WARNING" : "PASS",
        score: exactDuplicate !== null ? 0 : nearMatch !== null ? 1 - nearMatch.distance / 64 : 1,
        message:
          exactDuplicate !== null
            ? `SHA-256 exact duplicate: ${exactDuplicate.photoId}.`
            : nearMatch !== null
              ? `Perceptual near-duplicate review шаардлагатай: ${nearMatch.candidate.photoId}, distance=${nearMatch.distance}.`
              : "Exact болон near-duplicate илрээгүй.",
        calculation,
        extraSources: exactDuplicate?.sourceRefs ?? nearMatch?.candidate.sourceRefs,
      }),
    );

    const olderCandidates = previousCandidates.filter(
      (candidate) => candidate.reportDate < request.reportDate,
    );
    const olderExact =
      olderCandidates.find((candidate) => candidate.sha256 === photo.inspection.sha256) ?? null;
    const olderNear =
      olderExact === null
        ? findNearDuplicate(
            photo,
            olderCandidates,
            request.policy.nearDuplicateHammingDistanceThreshold,
          )
        : null;
    const reusedCandidate = olderExact ?? olderNear?.candidate ?? null;
    checks.set(
      "PE-04",
      makeCheck({
        request,
        photo,
        code: "PE-04",
        result: olderExact !== null ? "FAIL" : olderNear !== null ? "WARNING" : "PASS",
        score: olderExact !== null ? 0 : olderNear !== null ? 1 - olderNear.distance / 64 : 1,
        message:
          olderExact !== null
            ? `Өмнөх өдрийн exact зураг дахин ашиглагдсан: ${olderExact.reportDate}.`
            : olderNear !== null
              ? `Өмнөх өдрийн төстэй зураг human review шаардлагатай: ${olderNear.candidate.reportDate}.`
              : "Өмнөх өдрийн зураг дахин ашигласан signal илрээгүй.",
        calculation,
        extraSources: reusedCandidate?.sourceRefs,
      }),
    );

    const chronology = chronologicalCheck(request, photo);
    checks.set(
      "PE-05",
      makeCheck({
        request,
        photo,
        code: "PE-05",
        result: chronology.valid ? "PASS" : "FAIL",
        score: chronology.valid ? 1 : 0,
        message: chronology.valid
          ? "Capture/upload timestamp report date болон age policy-тэй нийцсэн."
          : `Capture/report/upload timestamp зөрсөн; age=${chronology.ageMinutes.toFixed(2)} минут.`,
        calculation,
      }),
    );

    const linkValid =
      photo.reportedWorkItemId === request.workItemId &&
      (photo.detectedWorkItemId === null || photo.detectedWorkItemId === request.workItemId);
    checks.set(
      "PE-06",
      makeCheck({
        request,
        photo,
        code: "PE-06",
        result: linkValid ? "PASS" : "FAIL",
        score: linkValid ? 1 : 0,
        message: linkValid
          ? "Зураг зөв project/work item scope-т холбогдсон."
          : "Reported/detected work item нь evaluation work item-тэй зөрсөн.",
        calculation,
      }),
    );

    const contradictionResult: PhotoCheckResult =
      photo.contradictionSignal === "CONTRADICTS"
        ? "FAIL"
        : photo.contradictionSignal === "UNCERTAIN"
          ? "WARNING"
          : photo.contradictionSignal === "NOT_ASSESSED"
            ? "NOT_APPLICABLE"
            : "PASS";
    checks.set(
      "PE-09",
      makeCheck({
        request,
        photo,
        code: "PE-09",
        result: contradictionResult,
        score:
          contradictionResult === "PASS"
            ? 1
            : contradictionResult === "FAIL"
              ? 0
              : contradictionResult === "WARNING"
                ? 0.5
                : null,
        message:
          photo.contradictionSignal === "CONTRADICTS"
            ? "Зураг нь текстийн мэдүүлэгтэй илэрхий зөрчилтэй."
            : photo.contradictionSignal === "UNCERTAIN"
              ? "Текст/зураг нийцэл тодорхойгүй тул review шаардлагатай."
              : photo.contradictionSignal === "SUPPORTS"
                ? "Зураг текстийн мэдүүлгийг дэмжсэн."
                : "Текст/зураг contradiction шалгалт шаардагдаагүй.",
        calculation,
      }),
    );

    const privacySafe = photo.privacyStatus === "CLEARED" || photo.privacyStatus === "REDACTED";
    checks.set(
      "PE-10",
      makeCheck({
        request,
        photo,
        code: "PE-10",
        result: privacySafe ? "PASS" : "FAIL",
        score: privacySafe ? 1 : 0,
        message:
          photo.privacyStatus === "REDACTED"
            ? "Privacy signal redaction-аар хамгаалагдсан."
            : photo.privacyStatus === "CLEARED"
              ? "Нууцлалын хориглох signal илрээгүй."
              : `Нууцлалын review шаардлагатай: ${photo.privacySignals.join(", ") || "RESTRICTED"}.`,
        calculation,
      }),
    );

    const usableForEvidence = INTRINSIC_CHECK_CODES.every(
      (code) => checks.get(code)?.result !== "FAIL",
    );
    results.push({
      photo,
      checks,
      exactDuplicate,
      nearDuplicate: nearMatch?.candidate ?? null,
      nearDuplicateDistance: nearMatch?.distance ?? null,
      reusedCandidate,
      usableForEvidence,
    });
    previousCandidates.push(asCandidate(photo));
    previousCandidates.sort(compareCandidates);
  }
  return results;
}

export function evaluatePhotoEvidence(requestInput: unknown): PhotoEvidenceEvaluationV1 {
  const request = photoEvidenceEvaluationRequestV1Schema.parse(requestInput);
  const calculation = calculationSource(request);
  const preliminary = buildPreliminaryResults(request, calculation);
  const usable = preliminary.filter((result) => result.usableForEvidence);
  const requiredAngles = [...request.policy.requiredAngles].sort();
  const observedAngles = [
    ...new Set(usable.flatMap((result) => result.photo.observedAngles)),
  ].sort();
  const missingAngles = requiredAngles.filter((angle) => !observedAngles.includes(angle));
  const requiredAnglesComplete = missingAngles.length === 0;
  const referenceMarkerPresent = request.policy.referenceMarkerRequired
    ? usable.some((result) => result.photo.referenceMarkerPresent === true)
    : null;
  const aggregateSources = dedupeSources([
    ...request.policy.sourceRefs,
    calculation,
    ...request.photos.flatMap((photo) => photo.sourceRefs),
  ]);

  const photoResults = preliminary.map((result) => {
    result.checks.set(
      "PE-07",
      makeCheck({
        request,
        photo: result.photo,
        code: "PE-07",
        result:
          requiredAngles.length === 0 ? "NOT_APPLICABLE" : requiredAnglesComplete ? "PASS" : "FAIL",
        score:
          requiredAngles.length === 0
            ? null
            : requiredAnglesComplete
              ? 1
              : (requiredAngles.length - missingAngles.length) / requiredAngles.length,
        message:
          requiredAngles.length === 0
            ? "Required angle policy байхгүй."
            : requiredAnglesComplete
              ? "Required angle бүрэн бүрдсэн."
              : `Required angle дутуу: ${missingAngles.join(", ")}.`,
        calculation,
        extraSources: aggregateSources,
      }),
    );
    result.checks.set(
      "PE-08",
      makeCheck({
        request,
        photo: result.photo,
        code: "PE-08",
        result: !request.policy.referenceMarkerRequired
          ? "NOT_APPLICABLE"
          : referenceMarkerPresent
            ? "PASS"
            : "FAIL",
        score: !request.policy.referenceMarkerRequired ? null : referenceMarkerPresent ? 1 : 0,
        message: !request.policy.referenceMarkerRequired
          ? "Reference marker policy шаардаагүй."
          : referenceMarkerPresent
            ? "Measurement/reference marker evidence бүрдсэн."
            : "Measurement/reference marker evidence дутуу.",
        calculation,
        extraSources: aggregateSources,
      }),
    );
    const checks = ALL_CHECK_CODES.map((code) => result.checks.get(code)!);
    const acceptedForVerification = checks.every((check) =>
      ["PASS", "NOT_APPLICABLE"].includes(check.result),
    );
    return {
      photoId: result.photo.photoId,
      artifactId: result.photo.artifactId,
      exactDuplicateOfPhotoId: result.exactDuplicate?.photoId ?? null,
      nearDuplicateOfPhotoId: result.nearDuplicate?.photoId ?? null,
      nearDuplicateHammingDistance: result.nearDuplicateDistance,
      reusedFromReportDate: result.reusedCandidate?.reportDate ?? null,
      usableForEvidence: result.usableForEvidence,
      acceptedForVerification,
      requiresHumanReview: true as const,
      checks,
      sourceRefs: dedupeSources([
        ...result.photo.sourceRefs,
        ...checks.flatMap((check) => check.sourceRefs),
      ]),
    };
  });

  const requiredCount = request.policy.requiredPhotoCount;
  const creditedCount = Math.min(usable.length, requiredCount);
  const coveragePercent = requiredCount === 0 ? 100 : (creditedCount / requiredCount) * 100;
  const evidenceComplete =
    coveragePercent === 100 &&
    requiredAnglesComplete &&
    (!request.policy.referenceMarkerRequired || referenceMarkerPresent === true);
  const canonical = canonicalRequest(request);
  const requestHash = sha256(stableStringify(canonical));

  return photoEvidenceEvaluationV1Schema.parse({
    schemaVersion: 1,
    evaluationType: "PHOTO_EVIDENCE_EVALUATION",
    evaluationId: boundedId("photo-evaluation", request.requestId),
    requestId: request.requestId,
    idempotencyKey: request.idempotencyKey,
    requestHash,
    tenantId: request.tenantId,
    projectId: request.projectId,
    reportDate: request.reportDate,
    workItemId: request.workItemId,
    policyId: request.policy.policyId,
    policyVersionId: request.policy.policyVersionId,
    photoResults,
    coverage: {
      requiredCount,
      submittedCount: request.photos.length,
      usableCount: usable.length,
      creditedCount,
      coveragePercent,
      requiredAngles,
      observedAngles,
      missingAngles,
      requiredAnglesComplete,
      referenceMarkerRequired: request.policy.referenceMarkerRequired,
      referenceMarkerPresent,
      evidenceComplete,
      sourceRefs: aggregateSources,
    },
    automaticEvidenceAcceptanceAllowed:
      evidenceComplete && photoResults.every((photo) => photo.acceptedForVerification),
    requiresHumanReview: true,
    eligibleForProgressVerification: true,
    exactQuantityDerived: false,
    deterministic: true,
    generatedAt: request.generatedAt,
    sourceRefs: aggregateSources,
  });
}

export class PhotoEvidenceEvaluationGateway {
  readonly #byIdempotencyKey = new Map<string, PhotoEvidenceEvaluationV1>();

  evaluate(requestInput: unknown): PhotoEvidenceEvaluationV1 {
    const evaluation = evaluatePhotoEvidence(requestInput);
    const existing = this.#byIdempotencyKey.get(evaluation.idempotencyKey);
    if (existing !== undefined) {
      if (existing.requestHash !== evaluation.requestHash) {
        throw new Error("Photo evidence idempotency key was reused with different content");
      }
      return existing;
    }
    this.#byIdempotencyKey.set(evaluation.idempotencyKey, evaluation);
    return evaluation;
  }
}
