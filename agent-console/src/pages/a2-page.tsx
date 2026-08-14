import {
  AlertTriangle,
  BrainCircuit,
  GitPullRequestArrow,
  Lightbulb,
  TrendingDown,
} from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { ForecastAsOf } from "../components/forecast-asof";
import { DecisionPointer } from "../components/decision-pointer";
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeading,
} from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import { entityNumber, entityString, formatDate, formatMoney, formatNumber } from "../lib/format";

export function A2Page() {
  const { projectId } = useParams();
  const query = useWorkspace(projectId);
  const [selectedAlert, setSelectedAlert] = useState<Record<string, unknown> | null>(null);
  if (projectId === undefined) return null;
  if (query.isPending) return <LoadingState label="A2 ажиглалт ачаалж байна…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const workspace = query.data.workspace;
  return (
    <>
      <PageHeading
        eyebrow="ЭРСДЭЛ БА ПРОГНОЗ"
        title="Эрсдэлийн ажиглалт ба зөвлөмж"
        description="Шөнийн/event analysis-аас pattern, root cause, deterministic impact болон батлуулах recommendation харуулна."
        actions={<Badge tone="warning">{workspace.alerts.length} signal</Badge>}
      />
      <div className="metric-grid compact">
        <Card className="metric-card">
          <span>Нээлттэй signal</span>
          <strong>{workspace.alerts.length}</strong>
          <small>Rule + verification</small>
        </Card>
        <Card className="metric-card">
          <span>Delay driver</span>
          <strong>{workspace.forecast.drivers.length}</strong>
          <small>Source contribution</small>
        </Card>
        <Card className="metric-card">
          <span>Recommendation</span>
          <strong>{workspace.forecast.recoveryScenarios.length}</strong>
          <small>Human approval required</small>
        </Card>
      </div>
      <DecisionPointer
        projectId={projectId}
        reviews={workspace.reviews}
        targetTypes={["RECOVERY_SCENARIO", "PROGRESS_VERIFICATION"]}
        label="эрсдэлийн шийдвэр хүлээгдэж байна"
      />
      <ForecastAsOf projectId={projectId} />
      <div className="split-grid">
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">RISK SIGNALS</p>
              <h2>Ажиглалтын inbox</h2>
            </div>
            <BrainCircuit />
          </div>
          <div className="risk-list">
            {workspace.alerts.map((alert) => (
              <button
                key={entityString(alert, "id")}
                type="button"
                onClick={() => setSelectedAlert(alert)}
                className={selectedAlert === alert ? "active" : ""}
              >
                <AlertTriangle />
                <div>
                  <strong>{entityString(alert, "title", "type")}</strong>
                  <span>{entityString(alert, "description")}</span>
                </div>
                <Badge tone={entityString(alert, "severity") === "CRITICAL" ? "danger" : "warning"}>
                  {entityString(alert, "severity")}
                </Badge>
              </button>
            ))}
            {workspace.alerts.length === 0 ? (
              <EmptyState
                title="Эрсдэлийн signal алга"
                description="Analysis одоогоор нээлттэй зөрчил илрүүлээгүй."
              />
            ) : null}
          </div>
        </Card>
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">EVIDENCE DRAWER</p>
              <h2>Root cause ба эх сурвалж</h2>
            </div>
            <GitPullRequestArrow />
          </div>
          {selectedAlert === null ? (
            <EmptyState
              title="Signal сонгоно уу"
              description="Зүүн жагсаалтаас эрсдэл сонгож evidence-г шалгана."
            />
          ) : (
            <div className="evidence-detail">
              <Badge tone="danger">{entityString(selectedAlert, "type")}</Badge>
              <h3>{entityString(selectedAlert, "title")}</h3>
              <p>{entityString(selectedAlert, "description")}</p>
              <dl>
                <div>
                  <dt>Source entity</dt>
                  <dd>{entityString(selectedAlert, "sourceId")}</dd>
                </div>
                <div>
                  <dt>Approval block</dt>
                  <dd>{String(selectedAlert.blocksApproval === true)}</dd>
                </div>
                <div>
                  <dt>Generated</dt>
                  <dd>{formatDate(query.data.workspace.generatedAt)}</dd>
                </div>
              </dl>
            </div>
          )}
        </Card>
      </div>
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">DETERMINISTIC DRIVERS</p>
            <h2>Хоцролтын үндсэн шалтгаан</h2>
          </div>
          <TrendingDown />
        </div>
        <DataTable
          headers={["Driver", "Contribution", "Work item", "Evidence"]}
          rows={workspace.forecast.drivers.map((driver) => [
            entityString(driver, "driverType", "name"),
            `${formatNumber(entityNumber(driver, "contribution", "contributionDays"))} өдөр`,
            entityString(driver, "workItemId"),
            entityString(driver, "sourceId", "evidence"),
          ])}
          empty="Forecast driver үүсээгүй"
        />
      </Card>
      <div className="recommendation-grid">
        {workspace.forecast.recoveryScenarios.map((scenario) => (
          <Card key={entityString(scenario, "id")}>
            <div className="card-heading">
              <div>
                <p className="eyebrow">RECOMMENDATION</p>
                <h2>{entityString(scenario, "name", "scenarioCode")}</h2>
              </div>
              <Lightbulb />
            </div>
            <p>{entityString(scenario, "description", "rationale")}</p>
            <div className="impact-row">
              <span>
                <strong>
                  {formatNumber(entityNumber(scenario, "delayReductionDays", "impactDays"))}
                </strong>{" "}
                өдөр
              </span>
              <span>
                <strong>
                  {formatMoney(entityNumber(scenario, "additionalCost", "costImpactMnt"))}
                </strong>{" "}
                зардал
              </span>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
