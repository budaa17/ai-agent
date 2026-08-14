import {
  BuildWatchApiError,
  buildWatchApi,
  sha256Hex,
  type DailyReportDraftRequest,
} from "../api/client";
import {
  getDailyDraft,
  getLocalPhoto,
  getOutboxEntry,
  listOutboxEntries,
  saveDailyDraft,
  saveLocalPhoto,
  saveOutboxEntry,
  type DailyReportOutboxEntry,
  type LocalDailyDraft,
  type LocalPhoto,
} from "./database";

export type SyncEvent =
  | { type: "SYNC_STARTED"; entryId: string }
  | { type: "SYNC_SUCCEEDED"; entryId: string }
  | { type: "SYNC_RETRY"; entryId: string; message: string }
  | { type: "SYNC_CONFLICT"; entryId: string; message: string };

const listeners = new Set<(event: SyncEvent) => void>();
let syncPromise: Promise<void> | null = null;

function emit(event: SyncEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeOutbox(listener: (event: SyncEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export async function addPhotoToDraft(input: {
  projectId: string;
  file: File;
  capturedAt?: string;
  planItemId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  orientation?: number | null;
}): Promise<LocalPhoto> {
  const photo: LocalPhoto = {
    id: newId("photo"),
    projectId: input.projectId,
    fileName: input.file.name,
    mediaType: input.file.type,
    bytes: await input.file.arrayBuffer(),
    sizeBytes: input.file.size,
    sha256: await sha256Hex(input.file),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    planItemId: input.planItemId ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    orientation: input.orientation ?? null,
    uploadedArtifactId: null,
    createdAt: new Date().toISOString(),
  };
  await saveLocalPhoto(photo);
  return photo;
}

export async function persistDraft(input: {
  draftId?: string;
  projectId: string;
  request: Omit<DailyReportDraftRequest, "photos">;
  photoIds: string[];
}): Promise<LocalDailyDraft> {
  const draft: LocalDailyDraft = {
    id: input.draftId ?? newId("draft"),
    projectId: input.projectId,
    request: input.request,
    photoIds: [...new Set(input.photoIds)],
    status: "DRAFT",
    updatedAt: new Date().toISOString(),
  };
  await saveDailyDraft(draft);
  return draft;
}

export async function queueDailyReport(draft: LocalDailyDraft): Promise<DailyReportOutboxEntry> {
  const current = await getDailyDraft(draft.id);
  const source = current ?? draft;
  const now = new Date().toISOString();
  const entry: DailyReportOutboxEntry = {
    id: newId("daily-report"),
    kind: "DAILY_REPORT",
    projectId: source.projectId,
    draftId: source.id,
    request: source.request,
    photoIds: source.photoIds,
    status: "PENDING",
    attemptCount: 0,
    nextAttemptAt: null,
    lastError: null,
    correlationId: null,
    createdAt: now,
    updatedAt: now,
    sentAt: null,
  };
  await saveOutboxEntry(entry);
  await saveDailyDraft({ ...source, status: "QUEUED", updatedAt: now });
  return entry;
}

function online(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function retryDelay(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
}

async function uploadQueuedPhoto(
  entry: DailyReportOutboxEntry,
  photoId: string,
): Promise<LocalPhoto> {
  const photo = await getLocalPhoto(photoId);
  if (photo === undefined) {
    throw new BuildWatchApiError({
      code: "OFFLINE_PHOTO_MISSING",
      message: `Offline зураг олдсонгүй: ${photoId}`,
      status: 409,
    });
  }
  if (photo.uploadedArtifactId !== null) return photo;
  const uploaded = await buildWatchApi.uploadArtifact(
    entry.projectId,
    new Blob([photo.bytes], { type: photo.mediaType }),
    photo.fileName,
    `${entry.id}-artifact-${photo.id}`,
    photo.sha256,
  );
  const updated = { ...photo, uploadedArtifactId: uploaded.artifactId };
  await saveLocalPhoto(updated);
  return updated;
}

async function processEntry(entry: DailyReportOutboxEntry): Promise<void> {
  const startedAt = new Date().toISOString();
  await saveOutboxEntry({ ...entry, status: "SYNCING", updatedAt: startedAt });
  emit({ type: "SYNC_STARTED", entryId: entry.id });
  try {
    const photos: NonNullable<DailyReportDraftRequest["photos"]> = [];
    for (const photoId of entry.photoIds) {
      const photo = await uploadQueuedPhoto(entry, photoId);
      if (photo.uploadedArtifactId === null) throw new Error("Uploaded artifact id missing");
      photos.push({
        fileAssetId: photo.uploadedArtifactId,
        capturedAt: photo.capturedAt,
        planItemId: photo.planItemId,
        latitude: photo.latitude,
        longitude: photo.longitude,
        orientation: photo.orientation,
      });
    }
    await buildWatchApi.submitDailyReport(entry.projectId, { ...entry.request, photos }, entry.id);
    const sentAt = new Date().toISOString();
    await saveOutboxEntry({
      ...entry,
      status: "SENT",
      attemptCount: entry.attemptCount + 1,
      nextAttemptAt: null,
      lastError: null,
      updatedAt: sentAt,
      sentAt,
    });
    const draft = await getDailyDraft(entry.draftId);
    if (draft !== undefined)
      await saveDailyDraft({ ...draft, status: "SUBMITTED", updatedAt: sentAt });
    emit({ type: "SYNC_SUCCEEDED", entryId: entry.id });
  } catch (error) {
    const attemptCount = entry.attemptCount + 1;
    const message = error instanceof Error ? error.message : String(error);
    const correlationId = error instanceof BuildWatchApiError ? error.correlationId : null;
    const isConflict =
      error instanceof BuildWatchApiError && error.status >= 400 && error.status < 500;
    const updatedAt = new Date().toISOString();
    await saveOutboxEntry({
      ...entry,
      status: isConflict ? "CONFLICT" : "RETRY",
      attemptCount,
      nextAttemptAt: isConflict
        ? null
        : new Date(Date.now() + retryDelay(attemptCount)).toISOString(),
      lastError: message,
      correlationId,
      updatedAt,
    });
    const draft = await getDailyDraft(entry.draftId);
    if (isConflict && draft !== undefined) {
      await saveDailyDraft({ ...draft, status: "CONFLICT", updatedAt });
    }
    emit(
      isConflict
        ? { type: "SYNC_CONFLICT", entryId: entry.id, message }
        : { type: "SYNC_RETRY", entryId: entry.id, message },
    );
  }
}

async function runSync(): Promise<void> {
  if (!online()) return;
  const entries = await listOutboxEntries();
  for (const entry of entries) {
    if (!online()) return;
    if (entry.status !== "PENDING" && entry.status !== "RETRY") continue;
    if (entry.nextAttemptAt !== null && Date.parse(entry.nextAttemptAt) > Date.now()) continue;
    await processEntry(entry);
  }
}

export function syncOutbox(): Promise<void> {
  syncPromise ??= runSync().finally(() => {
    syncPromise = null;
  });
  return syncPromise;
}

export async function retryOutboxEntry(entryId: string, newIdempotencyKey = false): Promise<void> {
  const entry = await getOutboxEntry(entryId);
  if (entry === undefined) return;
  const now = new Date().toISOString();
  if (newIdempotencyKey) {
    const replacement = {
      ...entry,
      id: newId("daily-report"),
      status: "PENDING" as const,
      attemptCount: 0,
      nextAttemptAt: null,
      lastError: null,
      correlationId: null,
      createdAt: now,
      updatedAt: now,
      sentAt: null,
    };
    await saveOutboxEntry({ ...entry, status: "SENT", updatedAt: now, sentAt: now });
    await saveOutboxEntry(replacement);
  } else {
    await saveOutboxEntry({
      ...entry,
      status: "PENDING",
      nextAttemptAt: null,
      lastError: null,
      updatedAt: now,
    });
  }
  await syncOutbox();
}
