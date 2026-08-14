import {
  AlertTriangle,
  CalendarClock,
  CircleDollarSign,
  Milestone,
  TrendingUp,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge, Card, DataTable, ErrorState, LoadingState, PageHeading } from "../components/ui";
import { useWorkspace } from "../hooks/use-workspace";
import {
  entityBoolean,
  entityNumber,
  entityString,
  formatDate,
  formatMoney,
  formatNumber,
} from "../lib/format";

export function DashboardPage() {
  const { projectId } = useParams();
  const query = useWorkspace(projectId);
  if (query.isPending) return <LoadingState label="Төслийн dashboard тооцооллыг ачаалж байна…" />;
  if (query.isError) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const { workspace, offline, cachedAt } = query.data;
  const dashboard = workspace.dashboard;
  const criticalItems = workspace.workItems
    .filter((item) => entityBoolean(item, "isCritical"))
    .slice(0, 8);
  return (
    <>
      <PageHeading
        eyebrow={`${workspace.project.code} · ${workspace.role}`}
        title={workspace.project.name}
        description={
          offline
            ? `Offline cache · ${formatDate(cachedAt)}`
            : `Backend тооцоолол · ${formatDate(workspace.generatedAt)}`
        }
        actions={
          <Badge tone={offline ? "warning" : "success"}>{offline ? "CACHED" : "LIVE DATA"}</Badge>
        }
      />
      <div className="metric-grid">
        <MetricCard
          icon={TrendingUp}
          label="Бодит гүйцэтгэл"
          value={`${formatNumber(dashboard.actualProgressPercent)}%`}
          detail={`Төлөвлөгөө ${formatNumber(dashboard.plannedProgressPercent)}%`}
          tone="mint"
        />
        <MetricCard
          icon={CalendarClock}
          label="Projected finish"
          value={formatDate(dashboard.projectedFinish)}
          detail={
            dashboard.projectedDelayDays === null
              ? "Forecast хараахан үүсээгүй"
              : `${dashboard.projectedDelayDays} хоногийн зөрүү`
          }
          tone="blue"
        />
        {/*
          A null budget is the API saying this role has no ESTIMATE_READ, not
          that the number is missing. Rendering an empty card would read as
          broken data, so the tile is left out entirely.
        */}
        {workspace.project.budgetMnt === null ? null : (
          <MetricCard
            icon={CircleDollarSign}
            label="Төсөв / бодит"
            value={formatMoney(workspace.project.budgetMnt)}
            detail={`Бодит ${formatMoney(workspace.project.actualCostMnt)}`}
            tone="orange"
          />
        )}
        <MetricCard
          icon={AlertTriangle}
          label="Нээлттэй эрсдэл"
          value={String(dashboard.openAlertCount)}
          detail={`${dashboard.criticalActivityCount} critical activity`}
          tone="purple"
        />
      </div>
      <div className="dashboard-grid">
        <Card className="span-2">
          <div className="card-heading">
            <div>
              <p className="eyebrow">S-CURVE</p>
              <h2>Төлөвлөгөө ба бодит явц</h2>
            </div>
            <Badge
              tone={
                dashboard.actualProgressPercent >= dashboard.plannedProgressPercent
                  ? "success"
                  : "warning"
              }
            >
              {formatNumber(dashboard.actualProgressPercent - dashboard.plannedProgressPercent)} pt
            </Badge>
          </div>
          <ProgressChart
            planned={dashboard.plannedProgressPercent}
            actual={dashboard.actualProgressPercent}
          />
        </Card>
        <Card>
          <div className="card-heading">
            <div>
              <p className="eyebrow">ALERTS</p>
              <h2>Анхаарах зүйлс</h2>
            </div>
            <span>{workspace.alerts.length}</span>
          </div>
          <div className="alert-stack">
            {workspace.alerts.slice(0, 5).map((alert) => (
              <div className="alert-row" key={entityString(alert, "id")}>
                <AlertTriangle />
                <div>
                  <strong>{entityString(alert, "title", "type")}</strong>
                  <span>{entityString(alert, "description", "severity")}</span>
                </div>
              </div>
            ))}
            {workspace.alerts.length === 0 ? <p className="muted">Нээлттэй alert алга.</p> : null}
          </div>
          {workspace.alerts.length > 5 ? (
            <Link className="link-button" to={`/projects/${projectId}/alerts`}>
              Бүх {workspace.alerts.length} анхааруулгыг харах
            </Link>
          ) : null}
        </Card>
      </div>
      <Card>
        <div className="card-heading">
          <div>
            <p className="eyebrow">CRITICAL PATH</p>
            <h2>Critical ажлууд</h2>
          </div>
          <Milestone />
        </div>
        <DataTable
          headers={["Код", "Ажил", "Төлөв", "Явц", "Дуусах"]}
          rows={criticalItems.map((item) => [
            entityString(item, "code"),
            entityString(item, "name"),
            <Badge key="status" tone="warning">
              {entityString(item, "status")}
            </Badge>,
            `${formatNumber(entityNumber(item, "progressPercent"))}%`,
            formatDate(entityString(item, "plannedEnd")),
          ])}
          empty="Critical ажил тэмдэглэгдээгүй"
        />
      </Card>
    </>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <Card className={`metric-card metric-${tone}`}>
      <div className="metric-icon">
        <Icon />
      </div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </Card>
  );
}

function ProgressChart({ planned, actual }: { planned: number; actual: number }) {
  const plannedWidth = Math.max(2, planned);
  const actualWidth = Math.max(2, actual);
  return (
    <div
      className="progress-chart"
      role="img"
      aria-label={`Төлөвлөгөө ${planned} хувь, бодит ${actual} хувь`}
    >
      <div className="chart-grid-lines">
        <i />
        <i />
        <i />
        <i />
      </div>
      <svg viewBox="0 0 100 45" preserveAspectRatio="none" aria-hidden="true">
        <path
          d={`M0 43 C 18 42, 28 30, 42 27 S 72 9, ${plannedWidth} ${45 - planned * 0.42}`}
          className="planned-line"
        />
        <path
          d={`M0 43 C 18 42, 30 34, 45 31 S 72 18, ${actualWidth} ${45 - actual * 0.42}`}
          className="actual-line"
        />
      </svg>
      <div className="chart-legend">
        <span>
          <i className="planned-dot" /> Төлөвлөгөө {formatNumber(planned)}%
        </span>
        <span>
          <i className="actual-dot" /> Бодит {formatNumber(actual)}%
        </span>
      </div>
    </div>
  );
}
