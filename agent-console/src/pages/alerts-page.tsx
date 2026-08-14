import { AlertOctagon, CheckCircle2, CircleDotDashed, Search, ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeading,
  Select,
} from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import { entityString } from "../lib/format";

export function AlertsPage() {
  const { projectId } = useParams();
  const query = useWorkspace(projectId);
  const [severity, setSeverity] = useState("ALL");
  const [search, setSearch] = useState("");
  const alerts = query.data?.workspace.alerts ?? [];
  const filtered = useMemo(
    () =>
      alerts.filter((alert) => {
        const matchesSeverity = severity === "ALL" || entityString(alert, "severity") === severity;
        const haystack =
          `${entityString(alert, "title", "type")} ${entityString(alert, "description")}`.toLocaleLowerCase(
            "mn",
          );
        return matchesSeverity && haystack.includes(search.toLocaleLowerCase("mn"));
      }),
    [alerts, search, severity],
  );
  if (query.isPending) return <LoadingState label="Alert-ууд ачаалж байна…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return (
    <>
      <PageHeading
        eyebrow="ALERT CONTROL"
        title="Анхааруулга ба шалтгаан"
        description="Rule/verification signal, severity, approval block болон source entity-г нэг дор шалгана."
        actions={<Badge tone="danger">{alerts.length} OPEN</Badge>}
      />
      <Card>
        <div className="filter-bar">
          <label>
            <Search />
            <Input
              aria-label="Alert хайх"
              placeholder="Alert хайх"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <Select
            aria-label="Severity filter"
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
          >
            <option value="ALL">Бүх severity</option>
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </Select>
        </div>
      </Card>
      {filtered.length === 0 ? (
        <EmptyState
          title="Alert олдсонгүй"
          description="Сонгосон filter-д тохирох alert байхгүй."
        />
      ) : (
        <div className="alert-grid">
          {filtered.map((alert) => {
            const blocked = alert.blocksApproval === true;
            return (
              <Card
                key={entityString(alert, "id")}
                className={blocked ? "alert-card blocking" : "alert-card"}
              >
                <div className="alert-card-icon">
                  {blocked ? <AlertOctagon /> : <ShieldAlert />}
                </div>
                <div>
                  <div className="card-heading">
                    <div>
                      <p className="eyebrow">{entityString(alert, "type")}</p>
                      <h2>{entityString(alert, "title")}</h2>
                    </div>
                    <Badge
                      tone={entityString(alert, "severity") === "CRITICAL" ? "danger" : "warning"}
                    >
                      {entityString(alert, "severity")}
                    </Badge>
                  </div>
                  <p>{entityString(alert, "description")}</p>
                  <div className="alert-source">
                    <span>
                      <CircleDotDashed /> Source: {entityString(alert, "sourceId")}
                    </span>
                    <span>
                      {blocked ? (
                        <>
                          <AlertOctagon /> Approval blocked
                        </>
                      ) : (
                        <>
                          <CheckCircle2 /> Review required
                        </>
                      )}
                    </span>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
