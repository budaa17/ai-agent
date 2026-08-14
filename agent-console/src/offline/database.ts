import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DailyReportDraftRequest } from "../api/client";
import type { Workspace } from "../api/schemas";

export type LocalDraftStatus = "DRAFT" | "QUEUED" | "SUBMITTED" | "CONFLICT";
export type OutboxStatus = "PENDING" | "SYNCING" | "RETRY" | "CONFLICT" | "SENT";

export interface LocalPhoto {
  id: string;
  projectId: string;
  fileName: string;
  mediaType: string;
  bytes: ArrayBuffer;
  sizeBytes: number;
  sha256: string;
  capturedAt: string;
  planItemId: string | null;
  latitude: number | null;
  longitude: number | null;
  orientation: number | null;
  uploadedArtifactId: string | null;
  createdAt: string;
}

export interface LocalDailyDraft {
  id: string;
  projectId: string;
  request: Omit<DailyReportDraftRequest, "photos">;
  photoIds: string[];
  status: LocalDraftStatus;
  updatedAt: string;
}

export interface DailyReportOutboxEntry {
  id: string;
  kind: "DAILY_REPORT";
  projectId: string;
  draftId: string;
  request: Omit<DailyReportDraftRequest, "photos">;
  photoIds: string[];
  status: OutboxStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  correlationId: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

export interface WorkspaceCacheEntry {
  projectId: string;
  workspace: Workspace;
  cachedAt: string;
}

interface BuildWatchDatabase extends DBSchema {
  workspaces: {
    key: string;
    value: WorkspaceCacheEntry;
  };
  dailyDrafts: {
    key: string;
    value: LocalDailyDraft;
    indexes: { "by-project": string; "by-status": LocalDraftStatus };
  };
  photos: {
    key: string;
    value: LocalPhoto;
    indexes: { "by-project": string };
  };
  outbox: {
    key: string;
    value: DailyReportOutboxEntry;
    indexes: { "by-project": string; "by-status": OutboxStatus };
  };
}

let databasePromise: Promise<IDBPDatabase<BuildWatchDatabase>> | null = null;

export function buildWatchDatabase(): Promise<IDBPDatabase<BuildWatchDatabase>> {
  databasePromise ??= openDB<BuildWatchDatabase>("buildwatch-pwa", 1, {
    upgrade(database) {
      database.createObjectStore("workspaces", { keyPath: "projectId" });
      const drafts = database.createObjectStore("dailyDrafts", { keyPath: "id" });
      drafts.createIndex("by-project", "projectId");
      drafts.createIndex("by-status", "status");
      const photos = database.createObjectStore("photos", { keyPath: "id" });
      photos.createIndex("by-project", "projectId");
      const outbox = database.createObjectStore("outbox", { keyPath: "id" });
      outbox.createIndex("by-project", "projectId");
      outbox.createIndex("by-status", "status");
    },
  });
  return databasePromise;
}

export async function cacheWorkspace(workspace: Workspace): Promise<void> {
  const database = await buildWatchDatabase();
  await database.put("workspaces", {
    projectId: workspace.project.id,
    workspace,
    cachedAt: new Date().toISOString(),
  });
}

export async function cachedWorkspace(projectId: string): Promise<WorkspaceCacheEntry | undefined> {
  return (await buildWatchDatabase()).get("workspaces", projectId);
}

export async function saveDailyDraft(draft: LocalDailyDraft): Promise<void> {
  await (await buildWatchDatabase()).put("dailyDrafts", draft);
}

export async function getDailyDraft(draftId: string): Promise<LocalDailyDraft | undefined> {
  return (await buildWatchDatabase()).get("dailyDrafts", draftId);
}

export async function listProjectDrafts(projectId: string): Promise<LocalDailyDraft[]> {
  return (await buildWatchDatabase()).getAllFromIndex("dailyDrafts", "by-project", projectId);
}

export async function saveLocalPhoto(photo: LocalPhoto): Promise<void> {
  await (await buildWatchDatabase()).put("photos", photo);
}

export async function getLocalPhoto(photoId: string): Promise<LocalPhoto | undefined> {
  return (await buildWatchDatabase()).get("photos", photoId);
}

export async function removeLocalPhoto(photoId: string): Promise<void> {
  await (await buildWatchDatabase()).delete("photos", photoId);
}

export async function saveOutboxEntry(entry: DailyReportOutboxEntry): Promise<void> {
  await (await buildWatchDatabase()).put("outbox", entry);
}

export async function getOutboxEntry(entryId: string): Promise<DailyReportOutboxEntry | undefined> {
  return (await buildWatchDatabase()).get("outbox", entryId);
}

export async function listOutboxEntries(projectId?: string): Promise<DailyReportOutboxEntry[]> {
  const database = await buildWatchDatabase();
  const entries =
    projectId === undefined
      ? await database.getAll("outbox")
      : await database.getAllFromIndex("outbox", "by-project", projectId);
  return entries.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function clearBuildWatchDatabaseForTests(): Promise<void> {
  const database = await buildWatchDatabase();
  await Promise.all(
    (["workspaces", "dailyDrafts", "photos", "outbox"] as const).map((store) =>
      database.clear(store),
    ),
  );
}
