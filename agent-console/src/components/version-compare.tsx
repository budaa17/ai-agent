import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { GitCompare } from "lucide-react";
import { buildWatchApi } from "../api/client";
import type { Workspace } from "../api/schemas";
import { entityNumber, entityString, formatDate } from "../lib/format";
import { Badge, Card, DataTable, EmptyState, ErrorState, LoadingState, Select } from "./ui";

type Row = Record<string, unknown>;

type VersionGroup = {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly Row[];
};

function describe(row: Row): string {
  const number = entityNumber(row, "versionNumber");
  const status = entityString(row, "status");
  const created = formatDate(entityString(row, "createdAt"));
  return `${number === null ? entityString(row, "id") : `Хувилбар ${number}`} · ${status} · ${created}`;
}

const MAX_CELL_CHARS = 140;

/**
 * Diff values can be whole collections. Dumping the raw JSON turns one row into
 * a wall of text and hides the small changes above it, so arrays are summarised
 * by length and anything else is clipped.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `${value.length} мөр`;
  if (typeof value !== "object") return String(value);
  const json = JSON.stringify(value);
  return json.length <= MAX_CELL_CHARS ? json : `${json.slice(0, MAX_CELL_CHARS)}…`;
}

/**
 * Answers "what actually changed between revision 1 and 2". Version rows only
 * carry a source hash, which proves something differs but never says what — the
 * comparison endpoint is the only way to see the fields.
 */
export function VersionCompare({
  projectId,
  workspace,
}: {
  projectId: string;
  workspace: Workspace;
}) {
  const groups = useMemo<VersionGroup[]>(
    () =>
      [
        {
          key: "QUANTITY_TAKEOFF",
          label: "Тоо хэмжээ",
          rows: workspace.commercial.quantityVersions,
        },
        { key: "ESTIMATE", label: "Төсөв", rows: workspace.commercial.estimateVersions },
        { key: "SCHEDULE", label: "Хуваарь", rows: workspace.schedule.versions },
        { key: "BASELINE", label: "Суурь хувилбар", rows: workspace.commercial.baselines },
      ].filter((group) => group.rows.length >= 2),
    [workspace],
  );

  const [groupKey, setGroupKey] = useState(() => groups[0]?.key ?? "");
  const group = groups.find((candidate) => candidate.key === groupKey) ?? groups[0] ?? null;

  // Newest against the one before it is the question people actually ask.
  const sorted = useMemo(
    () =>
      [...(group?.rows ?? [])].sort(
        (left, right) =>
          (entityNumber(right, "versionNumber") ?? 0) - (entityNumber(left, "versionNumber") ?? 0),
      ),
    [group],
  );
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const effectiveLeft = leftId !== "" ? leftId : (entityString(sorted[0] ?? {}, "id") ?? "");
  const effectiveRight = rightId !== "" ? rightId : (entityString(sorted[1] ?? {}, "id") ?? "");

  const comparison = useQuery({
    queryKey: ["versions-compare", projectId, effectiveLeft, effectiveRight],
    enabled: effectiveLeft !== "—" && effectiveRight !== "—" && effectiveLeft !== effectiveRight,
    queryFn: () => buildWatchApi.compareVersions(projectId, effectiveLeft, effectiveRight),
    staleTime: 60_000,
  });

  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Харьцуулах хувилбар алга"
          description="Нэг төрөлд дор хаяж хоёр хувилбар үүсмэгц ялгааг энд харуулна."
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">VERSION DIFF</p>
          <h2>Хувилбар хоорондын өөрчлөлт</h2>
        </div>
        {comparison.data === undefined ? null : (
          <Badge tone={comparison.data.differences.length === 0 ? "success" : "warning"}>
            {comparison.data.differences.length} ялгаа
          </Badge>
        )}
      </div>

      <div className="compare-controls">
        <Select
          aria-label="Төрөл"
          value={group?.key ?? ""}
          onChange={(event) => {
            setGroupKey(event.target.value);
            setLeftId("");
            setRightId("");
          }}
        >
          {groups.map((candidate) => (
            <option key={candidate.key} value={candidate.key}>
              {candidate.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Шинэ хувилбар"
          value={effectiveLeft}
          onChange={(event) => setLeftId(event.target.value)}
        >
          {sorted.map((row) => (
            <option key={entityString(row, "id")} value={entityString(row, "id")}>
              {describe(row)}
            </option>
          ))}
        </Select>
        <span className="compare-arrow">
          <GitCompare />
        </span>
        <Select
          aria-label="Харьцуулах хувилбар"
          value={effectiveRight}
          onChange={(event) => setRightId(event.target.value)}
        >
          {sorted.map((row) => (
            <option key={entityString(row, "id")} value={entityString(row, "id")}>
              {describe(row)}
            </option>
          ))}
        </Select>
      </div>

      {effectiveLeft === effectiveRight ? (
        <p className="muted-note">Хоёр өөр хувилбар сонгоно уу.</p>
      ) : comparison.isPending ? (
        <LoadingState label="Ялгааг тооцоолж байна…" />
      ) : comparison.isError ? (
        <ErrorState error={comparison.error} retry={() => void comparison.refetch()} />
      ) : comparison.data.differences.length === 0 ? (
        <p className="muted-note">Энэ хоёр хувилбарын хооронд талбарын ялгаа олдсонгүй.</p>
      ) : (
        <DataTable
          headers={["Талбар", "Шинэ", "Хуучин"]}
          rows={comparison.data.differences.map((difference) => [
            <code key="path">{difference.path}</code>,
            cell(difference.left),
            cell(difference.right),
          ])}
        />
      )}
    </Card>
  );
}
