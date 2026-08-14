import { createHmac, timingSafeEqual } from "node:crypto";
import {
  Phase9ApiError,
  phase9AuditEntrySchema,
  phase9ProjectPageSchema,
  type Phase9AuthenticatedPrincipal,
  type Phase9Role,
} from "./contracts.js";
import { effectiveProjectRole, requireProjectPermission } from "./authorization.js";
import type { Phase9Store, Phase9VersionSnapshotRecord } from "./store.js";

interface ProjectCursor {
  tenantId: string;
  userId: string;
  code: string;
  id: string;
}

function compareProjects(
  left: Readonly<{ code: string; id: string }>,
  right: Readonly<{ code: string; id: string }>,
): number {
  return left.code.localeCompare(right.code) || left.id.localeCompare(right.id);
}

function diffValues(
  left: unknown,
  right: unknown,
  path = "$",
  output: Array<{ path: string; left: unknown; right: unknown }> = [],
): Array<{ path: string; left: unknown; right: unknown }> {
  if (output.length >= 500 || Object.is(left, right)) return output;
  if (
    left !== null &&
    right !== null &&
    typeof left === "object" &&
    typeof right === "object" &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const keys = new Set([
      ...Object.keys(left as Record<string, unknown>),
      ...Object.keys(right as Record<string, unknown>),
    ]);
    for (const key of [...keys].sort()) {
      diffValues(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${path}.${key}`,
        output,
      );
    }
    return output;
  }
  output.push({ path, left, right });
  return output;
}

export class Phase9ProjectService {
  readonly #cursorSecret: Buffer;

  constructor(
    private readonly store: Phase9Store,
    cursorSecret: string,
  ) {
    if (Buffer.byteLength(cursorSecret) < 32) {
      throw new Error("Phase 9 cursor secret must be at least 32 bytes");
    }
    this.#cursorSecret = Buffer.from(cursorSecret, "utf8");
  }

  #encodeCursor(cursor: ProjectCursor): string {
    const payload = Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#cursorSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  #decodeCursor(value: string, principal: Phase9AuthenticatedPrincipal): ProjectCursor {
    try {
      const [payload, signature, extra] = value.split(".");
      if (payload === undefined || signature === undefined || extra !== undefined)
        throw new Error();
      const expected = createHmac("sha256", this.#cursorSecret).update(payload).digest();
      const actual = Buffer.from(signature, "base64url");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
        throw new Error();
      const cursor = JSON.parse(
        Buffer.from(payload, "base64url").toString("utf8"),
      ) as ProjectCursor;
      if (
        cursor.tenantId !== principal.tenantId ||
        cursor.userId !== principal.userId ||
        typeof cursor.code !== "string" ||
        typeof cursor.id !== "string"
      ) {
        throw new Error();
      }
      return cursor;
    } catch {
      throw new Phase9ApiError("CURSOR_INVALID", 400, "Invalid cursor");
    }
  }

  async listProjects(
    principal: Phase9AuthenticatedPrincipal,
    input: Readonly<{ cursor?: string; limit: number }>,
  ) {
    const page = await this.store.read(async (transaction) => {
      const [projects, memberships] = await Promise.all([
        transaction.listProjects(principal.tenantId),
        transaction.listMemberships(principal.tenantId, principal.userId),
      ]);
      const roleByProject = new Map(
        memberships.map((membership) => [membership.projectId, membership.role]),
      );
      const visible = projects
        .map((project) => ({
          project,
          role: effectiveProjectRole(principal, roleByProject.get(project.id) ?? null),
        }))
        .filter(
          (entry): entry is { project: (typeof projects)[number]; role: Phase9Role } =>
            entry.role !== null,
        )
        .sort((left, right) => compareProjects(left.project, right.project));
      const cursor =
        input.cursor === undefined ? null : this.#decodeCursor(input.cursor, principal);
      const afterCursor =
        cursor === null
          ? visible
          : visible.filter(
              (entry) => compareProjects(entry.project, { code: cursor.code, id: cursor.id }) > 0,
            );
      const selected = afterCursor.slice(0, input.limit + 1);
      const hasMore = selected.length > input.limit;
      const data = selected.slice(0, input.limit);
      const last = data.at(-1);
      return {
        data: data.map(({ project, role }) => ({
          id: project.id,
          code: project.code,
          name: project.name,
          status: project.status,
          role,
          plannedStart: project.plannedStart,
          plannedEnd: project.plannedEnd,
          rowVersion: project.rowVersion,
        })),
        page: {
          nextCursor:
            hasMore && last !== undefined
              ? this.#encodeCursor({
                  tenantId: principal.tenantId,
                  userId: principal.userId,
                  code: last.project.code,
                  id: last.project.id,
                })
              : null,
          hasMore,
        },
      };
    });
    return phase9ProjectPageSchema.parse(page);
  }

  async requireProject(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    permission: Parameters<typeof requireProjectPermission>[2],
  ) {
    return this.store.read(async (transaction) => {
      const [project, membership] = await Promise.all([
        transaction.getProject(principal.tenantId, projectId),
        transaction.findMembership(principal.tenantId, projectId, principal.userId),
      ]);
      const role = requireProjectPermission(principal, membership?.role ?? null, permission);
      if (project === null) {
        throw new Phase9ApiError("PROJECT_NOT_FOUND", 404, "Project not found");
      }
      return { project, role };
    });
  }

  async compareVersions(
    principal: Phase9AuthenticatedPrincipal,
    projectId: string,
    leftId: string,
    rightId: string,
  ) {
    await this.requireProject(principal, projectId, "PROJECT_READ");
    return this.store.read(async (transaction) => {
      const [left, right] = await Promise.all([
        transaction.getVersionSnapshot(principal.tenantId, projectId, leftId),
        transaction.getVersionSnapshot(principal.tenantId, projectId, rightId),
      ]);
      if (left === null || right === null || left.targetType !== right.targetType) {
        throw new Phase9ApiError("RESOURCE_NOT_FOUND", 404, "Version not found");
      }
      return {
        targetType: left.targetType,
        left: this.#versionMetadata(left),
        right: this.#versionMetadata(right),
        differences: diffValues(left.content, right.content),
      };
    });
  }

  #versionMetadata(version: Phase9VersionSnapshotRecord) {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      sourceHash: version.sourceHash,
      createdAt: version.createdAt,
    };
  }

  async latestForecast(principal: Phase9AuthenticatedPrincipal, projectId: string, asOf: string) {
    await this.requireProject(principal, projectId, "FORECAST_READ");
    return this.store.read(async (transaction) => {
      const forecast = await transaction.getLatestForecast(principal.tenantId, projectId, asOf);
      return forecast;
    });
  }

  async listAudit(principal: Phase9AuthenticatedPrincipal, projectId: string, limit: number) {
    await this.requireProject(principal, projectId, "AUDIT_READ");
    return this.store.read(async (transaction) =>
      (await transaction.listAudit(principal.tenantId, projectId))
        .sort(
          (left, right) =>
            Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
            left.id.localeCompare(right.id),
        )
        .slice(0, limit)
        .map((record) => phase9AuditEntrySchema.parse(record)),
    );
  }
}
