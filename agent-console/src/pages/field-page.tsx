import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from "../components/ui";
import { JobHeadline } from "../components/job-headline";
import { useWorkspace } from "../hooks/use-workspace";
import { entityNumber, entityString, formatDate, formatNumber, materialCode } from "../lib/format";

type Row = Record<string, unknown>;

type ItemState = "BLOCKED" | "STARTED" | "WAITING";

const STATE_LABEL: Record<ItemState, string> = {
  BLOCKED: "Саадтай",
  STARTED: "Эхэлсэн",
  WAITING: "Хүлээгдэж буй",
};

/**
 * The supervisor's home screen: what has to be built today, on this phone,
 * before anything else. Everything the role cannot act on is left off.
 */
export function FieldPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const query = useWorkspace(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const workspace = query.data?.workspace;

  const plan = useMemo<Row | null>(() => {
    const plans = [...(workspace?.operations.plans ?? [])].sort((left, right) =>
      entityString(right, "planDate").localeCompare(entityString(left, "planDate")),
    );
    return plans[0] ?? null;
  }, [workspace]);

  const items = useMemo(() => {
    if (workspace === undefined || plan === null) return [];
    const planId = entityString(plan, "id");
    return workspace.operations.planItems
      .filter((item) => entityString(item, "planId") === planId)
      .sort(
        (left, right) =>
          (entityNumber(left, "sequence") ?? 0) - (entityNumber(right, "sequence") ?? 0),
      );
  }, [workspace, plan]);

  const stateFor = (item: Row): ItemState => {
    const preconditions = (item.preconditions as Row[] | undefined) ?? [];
    const materials = (item.materials as Row[] | undefined) ?? [];
    const blocked =
      preconditions.some((precondition) => precondition.satisfied !== true) ||
      materials.some((material) => (entityNumber(material, "shortageQuantity") ?? 0) > 0);
    if (blocked) return "BLOCKED";
    const reported = (workspace?.operations.progress ?? []).some(
      (row) => entityString(row, "planItemId") === entityString(item, "id"),
    );
    return reported ? "STARTED" : "WAITING";
  };

  const workItemFor = (item: Row): Row | undefined =>
    workspace?.workItems.find(
      (row) => entityString(row, "id") === entityString(item, "workItemId"),
    );

  /** Everything reported against this work item so far, across all reports. */
  const cumulativeFor = (item: Row): number =>
    (workspace?.operations.progress ?? [])
      .filter((row) => entityString(row, "workItemId") === entityString(item, "workItemId"))
      .reduce((sum, row) => sum + (entityNumber(row, "quantity") ?? 0), 0);

  /**
   * Contract quantity for the work item. Work items carry money and percent,
   * not quantity — the total lives on the scheduled activity.
   */
  const contractQuantityFor = (item: Row): number | null => {
    const activity = workspace?.schedule.activities.find(
      (row) => entityString(row, "workItemId") === entityString(item, "workItemId"),
    );
    return activity === undefined ? null : entityNumber(activity, "quantity");
  };

  if (query.isPending) return <LoadingState />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (workspace === undefined) return <LoadingState />;

  const selected =
    items.find((item) => entityString(item, "id") === selectedId) ?? items[0] ?? null;
  const blockedCount = items.filter((item) => stateFor(item) === "BLOCKED").length;

  return (
    <>
      <JobHeadline
        question="Өнөөдөр юу хийх вэ?"
        count={items.length}
        unit={items.length === 1 ? "ажил төлөвлөгдсөн" : "ажил төлөвлөгдсөн"}
        detail={
          plan === null
            ? "Өдрийн даалгавар хараахан үүсээгүй байна."
            : `${formatDate(entityString(plan, "planDate"))} · ${blockedCount > 0 ? `${blockedCount} ажил саадтай` : "саадгүй"}`
        }
        tone={blockedCount > 0 ? "attention" : "neutral"}
      />

      {items.length === 0 ? (
        <EmptyState
          title="Өнөөдөр даалгавар алга"
          description="Энэ төсөлд өдрийн даалгавар үүсээгүй байна. Төслийн менежерээс өдрийн төлөвлөгөө үүсгэхийг хүснэ үү."
        />
      ) : (
        <div className="field-layout">
          <Card className="field-queue">
            <ul className="field-list">
              {items.map((item) => {
                const workItem = workItemFor(item);
                const state = stateFor(item);
                const active =
                  selected !== null && entityString(selected, "id") === entityString(item, "id");
                return (
                  <li key={entityString(item, "id")}>
                    <button
                      type="button"
                      className={`field-row ${active ? "is-active" : ""}`}
                      onClick={() => setSelectedId(entityString(item, "id"))}
                    >
                      <div className="field-row-main">
                        <strong>
                          {workItem === undefined
                            ? entityString(item, "workItemId")
                            : entityString(workItem, "name")}
                        </strong>
                        <small>
                          {entityString(item, "locationCode")} ·{" "}
                          {workItem === undefined ? "" : entityString(workItem, "code")}
                        </small>
                      </div>
                      <span className="field-row-qty">
                        {formatNumber(entityNumber(item, "plannedQuantity"), 1)}{" "}
                        {entityString(item, "unit")}
                      </span>
                      <Badge
                        tone={
                          state === "BLOCKED"
                            ? "danger"
                            : state === "STARTED"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {STATE_LABEL[state]}
                      </Badge>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {selected !== null ? (
            <Card className="field-detail">
              {(() => {
                const workItem = workItemFor(selected);
                const state = stateFor(selected);
                const preconditions = (selected.preconditions as Row[] | undefined) ?? [];
                const materials = (selected.materials as Row[] | undefined) ?? [];
                const unmet = preconditions.filter((row) => row.satisfied !== true);
                const cumulative = cumulativeFor(selected);
                const target = contractQuantityFor(selected);
                return (
                  <>
                    <h2>
                      {workItem === undefined
                        ? entityString(selected, "workItemId")
                        : entityString(workItem, "name")}
                    </h2>
                    <p className="page-description">
                      {workItem === undefined ? "" : entityString(workItem, "code")} ·{" "}
                      {entityString(selected, "locationCode")}
                    </p>

                    <dl className="detail-list">
                      <div>
                        <dt>Өнөөдрийн зорилт</dt>
                        <dd>
                          {formatNumber(entityNumber(selected, "plannedQuantity"), 2)}{" "}
                          {entityString(selected, "unit")}
                        </dd>
                      </div>
                      <div>
                        <dt>Хуримтлагдсан</dt>
                        <dd>
                          {target === null
                            ? `${formatNumber(cumulative, 1)} ${entityString(selected, "unit")}`
                            : `${formatNumber(cumulative, 1)} / ${formatNumber(target, 0)} ${entityString(selected, "unit")}`}
                        </dd>
                      </div>
                      {materials.map((material) => (
                        <div key={entityString(material, "id")}>
                          <dt>Материал</dt>
                          <dd>
                            {materialCode(entityString(material, "materialItemId"))} ·{" "}
                            {(entityNumber(material, "shortageQuantity") ?? 0) > 0
                              ? `${formatNumber(entityNumber(material, "shortageQuantity"), 1)} ${entityString(material, "unit")} дутуу`
                              : "хүрэлцээтэй"}
                          </dd>
                        </div>
                      ))}
                    </dl>

                    <div className={`notice-card ${state === "BLOCKED" ? "is-warning" : "is-ok"}`}>
                      <strong>
                        {state === "BLOCKED" ? (
                          <>
                            <AlertTriangle /> Эхлэх нөхцөл бүрдээгүй
                          </>
                        ) : (
                          <>
                            <CheckCircle2 /> Эхлэх нөхцөл бүрдсэн
                          </>
                        )}
                      </strong>
                      <ul className="precondition-list">
                        {preconditions.map((precondition) => (
                          <li
                            key={entityString(precondition, "id")}
                            className={precondition.satisfied === true ? "is-ok" : "is-unmet"}
                          >
                            {precondition.satisfied === true ? <CheckCircle2 /> : <Clock />}
                            <span>{entityString(precondition, "description")}</span>
                          </li>
                        ))}
                      </ul>
                      {unmet.length > 0 ? (
                        <p className="muted-note">
                          {unmet.length} нөхцөл биелээгүй байхад ажил эхлүүлэхгүй байхыг зөвлөж
                          байна.
                        </p>
                      ) : null}
                    </div>

                    <Button
                      className="field-cta"
                      onClick={() =>
                        navigate(`/projects/${projectId}/field/${entityString(selected, "id")}`)
                      }
                    >
                      Оройн тайлан бөглөх
                    </Button>
                  </>
                );
              })()}
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
