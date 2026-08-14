import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type {
  PlatformCause,
  PlatformFreshness,
  PlatformMetricWindow,
  PlatformSectionContext,
} from "../../api/platform-schemas";
import { Badge, Button, Card } from "../ui";

/**
 * Formatting, tone and section-state primitives shared by the Control Tower
 * and every Phase 5 drill-down page, so a state such as STALE or INSUFFICIENT
 * never renders differently depending on which page the operator is on.
 */

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "purple";

/** Any envelope problem: the overview and drill-down contracts share the shape. */
export interface PlatformProblem {
  section: string;
  code: string;
  message: string;
  retryable: boolean;
}

const numberFormatter = new Intl.NumberFormat("mn-MN");
const percentFormatter = new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 1 });
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const dateTimeFormatter = new Intl.DateTimeFormat("mn-MN", {
  timeZone: "Asia/Ulaanbaatar",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatPlatformDateTime(value: string | null): string {
  return value === null ? "—" : dateTimeFormatter.format(new Date(value));
}

export function formatCount(value: number | null): string {
  return value === null ? "—" : numberFormatter.format(value);
}

export function formatPercent(value: number | null): string {
  return value === null ? "—" : `${percentFormatter.format(value)}%`;
}

export function formatMicroUsd(value: number | null): string {
  return value === null ? "—" : usdFormatter.format(value / 1_000_000);
}

export function formatBytes(value: number | null): string {
  if (value === null) return "—";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 1 }).format(
    value / 1024 ** index,
  )} ${units[index]}`;
}

export function formatLatency(value: number | null): string {
  if (value === null) return "—";
  return value >= 1_000 ? `${percentFormatter.format(value / 1_000)} сек` : `${value} мс`;
}

export function formatAge(seconds: number | null): string {
  if (seconds === null) return "нас тодорхойгүй";
  if (seconds < 60) return `${seconds} сек`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)} мин`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)} цаг`;
  return `${Math.floor(seconds / 86_400)} өдөр`;
}

export function stateTone(state: string): BadgeTone {
  if (
    state === "HEALTHY" ||
    state === "ACTIVE" ||
    state === "FRESH" ||
    state === "SUCCESS" ||
    state === "PASSED" ||
    state === "ON_TRACK"
  ) {
    return "success";
  }
  if (
    state === "WARNING" ||
    state === "DEGRADED" ||
    state === "STALE" ||
    state === "HIGH" ||
    state === "DUE_SOON"
  ) {
    return "warning";
  }
  if (
    state === "CRITICAL" ||
    state === "DOWN" ||
    state === "FAILED" ||
    state === "DENIED" ||
    state === "BREACHED" ||
    state === "REJECTED"
  ) {
    return "danger";
  }
  if (state === "MEDIUM" || state === "RUNNING" || state === "COMPLETED") return "info";
  return "neutral";
}

export function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    HEALTHY: "Хэвийн",
    ACTIVE: "Идэвхтэй",
    FRESH: "Шинэ",
    WARNING: "Анхаарах",
    DEGRADED: "Доголдолтой",
    STALE: "Хоцорсон",
    CRITICAL: "Ноцтой",
    DOWN: "Ажиллахгүй",
    UNKNOWN: "Тодорхойгүй",
    INACTIVE: "Идэвхгүй",
    SUCCESS: "Амжилттай",
    DENIED: "Татгалзсан",
    FAILED: "Амжилтгүй",
    HIGH: "Өндөр",
    MEDIUM: "Дунд",
    LOW: "Бага",
    OPEN: "Нээлттэй",
    ACKNOWLEDGED: "Хүлээн авсан",
    REOPENED: "Дахин нээгдсэн",
    RUNNING: "Ажиллаж байна",
    COMPLETED: "Дууссан",
    REJECTED: "Татгалзсан",
    PASSED: "Тэнцсэн",
    BREACHED: "Хугацаа хэтэрсэн",
    DUE_SOON: "Удахгүй дуусах",
    ON_TRACK: "Хэвийн",
    NO_DUE_DATE: "Хугацаагүй",
    ACTUAL: "Бодит",
    ESTIMATED: "Тооцоолсон",
  };
  return labels[state] ?? state;
}

export function formatMetricWindow(window: PlatformMetricWindow): string {
  const kindLabels: Record<PlatformMetricWindow["kind"], string> = {
    SELECTED_RANGE: "Сонгосон хугацаа",
    PREVIOUS_RANGE: "Өмнөх ижил хугацаа",
    SNAPSHOT: "Одоогийн snapshot",
    MONTH_TO_DATE: "Энэ сарын эхнээс",
    PREVIOUS_MONTH_COMPARABLE: "Өмнөх сарын ижил үе",
    FIXED_ROLLING: "Тогтмол rolling хугацаа",
  };
  if (window.from === null || window.to === null) return kindLabels[window.kind];
  return `${kindLabels[window.kind]} · ${formatPlatformDateTime(window.from)} – ${formatPlatformDateTime(window.to)}`;
}

export function FreshnessBadge({ freshness }: { freshness: PlatformFreshness }) {
  return (
    <Badge tone={stateTone(freshness.state)}>
      {stateLabel(freshness.state)} · {formatAge(freshness.ageSeconds)}
    </Badge>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  context,
  meta,
  actions,
}: {
  eyebrow: string;
  title: string;
  context: PlatformSectionContext;
  meta?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="platform-section-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        {meta !== undefined ? <p>{meta}</p> : null}
      </div>
      <div className="platform-section-state">
        {actions}
        {context.state !== "AVAILABLE" ? (
          <Badge tone={context.state === "PARTIAL" ? "warning" : "neutral"}>
            {context.state === "PARTIAL" ? "Хэсэгчлэн" : "Тодорхойгүй"}
          </Badge>
        ) : null}
        <FreshnessBadge freshness={context.freshness} />
      </div>
    </div>
  );
}

export function UnavailableSection({ context }: { context: PlatformSectionContext }) {
  if (context.state !== "UNKNOWN") return null;
  return (
    <div className="platform-inline-state">
      <AlertTriangle />
      <div>
        <strong>Энэ хэсгийн эх үүсвэр боломжгүй</strong>
        <p>{context.freshness.reason ?? "Шалтгаан тодорхойгүй байна."}</p>
      </div>
    </div>
  );
}

export function EnvelopeProblems({
  problems,
  retry,
}: {
  problems: readonly PlatformProblem[];
  retry: () => void;
}) {
  if (problems.length === 0) return null;
  return (
    <div className="platform-problem-banner" role="status">
      <AlertTriangle />
      <div>
        <strong>Зарим эх үүсвэр бүрэн шинэчлэгдсэнгүй</strong>
        <ul>
          {problems.map((problem, index) => (
            <li key={`${problem.section}-${problem.code}-${index}`}>
              {problem.section}: {problem.message}
            </li>
          ))}
        </ul>
      </div>
      {problems.some((problem) => problem.retryable) ? (
        <Button variant="secondary" onClick={retry}>
          Дахин оролдох
        </Button>
      ) : null}
    </div>
  );
}

export function SectionProblems({
  problems,
  retry,
  compact = false,
}: {
  problems: readonly PlatformProblem[];
  retry?: (() => void) | undefined;
  compact?: boolean;
}) {
  if (problems.length === 0) return null;
  return (
    <div className={`platform-section-problems ${compact ? "is-compact" : ""}`} role="status">
      <AlertTriangle />
      <div>
        {problems.map((problem, index) => (
          <p key={`${problem.section}-${problem.code}-${index}`}>{problem.message}</p>
        ))}
      </div>
      {retry !== undefined && problems.some((problem) => problem.retryable) ? (
        <Button variant="ghost" onClick={retry}>
          Дахин оролдох
        </Button>
      ) : null}
    </div>
  );
}

export function CauseList({ causes }: { causes: readonly PlatformCause[] }) {
  if (causes.length === 0) return null;
  return (
    <ul className="platform-cause-list">
      {causes.map((cause) => (
        <li key={cause.causeId}>
          <Badge tone={stateTone(cause.severity)}>{stateLabel(cause.severity)}</Badge>
          <Link to={cause.diagnosticsHref}>{cause.title}</Link>
        </li>
      ))}
    </ul>
  );
}

/** Compact figure used across drill-down summaries where a KPI card is too heavy. */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card className="platform-stat-tile">
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
      {hint === undefined ? null : <span className="muted">{hint}</span>}
    </Card>
  );
}
