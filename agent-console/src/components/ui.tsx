import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, WifiOff } from "lucide-react";
import { friendlyError } from "../lib/api-error";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
}) {
  return (
    <button className={`button button-${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = "",
  as = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
}) {
  const Component = as;
  return <Component className={`card ${className}`}>{children}</Component>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error !== undefined ? <span className="field-error">{error}</span> : null}
      {hint !== undefined && error === undefined ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${props.className ?? ""}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input ${props.className ?? ""}`} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input min-h-28 resize-y ${props.className ?? ""}`} {...props} />;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "purple";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description !== undefined ? <p className="page-description">{description}</p> : null}
      </div>
      {actions !== undefined ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function LoadingState({ label = "Өгөгдөл ачаалж байна…" }: { label?: string }) {
  return (
    <div className="state-panel" role="status">
      <LoaderCircle className="animate-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon" aria-hidden="true">
        BW
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  retry,
}: {
  title?: string;
  error: unknown;
  retry?: () => void;
}) {
  // Backend codes are translated into something the reader can act on; an
  // explicit title still wins so callers can stay specific where it matters.
  const friendly = friendlyError(error);
  const message = friendly.message;
  return (
    <div className="state-panel state-error" role="alert">
      <AlertCircle aria-hidden="true" />
      <div>
        <strong>{title ?? friendly.title}</strong>
        <p>{message}</p>
      </div>
      {retry !== undefined ? (
        <Button variant="secondary" onClick={retry}>
          {friendly.reloadable ? "Шинэчлэх" : "Дахин оролдох"}
        </Button>
      ) : null}
    </div>
  );
}

export function ConnectivityPill({ state }: { state: "ONLINE" | "OFFLINE" | "API_UNREACHABLE" }) {
  if (state === "ONLINE") {
    return (
      <span className="connectivity is-online">
        <CheckCircle2 aria-hidden="true" /> Online
      </span>
    );
  }
  // Distinguished on purpose: "no signal" and "signal but BuildWatch is down"
  // need different reactions from whoever is holding the phone.
  if (state === "API_UNREACHABLE") {
    return (
      <span className="connectivity is-degraded">
        <AlertCircle aria-hidden="true" /> Сервер хариу өгөхгүй — өгөгдөл хадгалагдана
      </span>
    );
  }
  return (
    <span className="connectivity is-offline">
      <WifiOff aria-hidden="true" /> Offline — өгөгдөл төхөөрөмжид хадгалагдана
    </span>
  );
}

export function DataTable({
  headers,
  rows,
  empty = "Мэдээлэл алга",
}: {
  headers: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={headers.length} className="table-empty">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{cell}</td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
