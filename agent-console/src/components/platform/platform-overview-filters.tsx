import { RefreshCw, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import {
  platformOverviewQuerySchema,
  type PlatformOverviewQuery,
} from "../../api/platform-schemas";
import { Button, Field, Input, Select } from "../ui";

type PresetWindow = "24h" | "7d" | "30d";
type RangeMode = PresetWindow | "custom";

const ULAANBAATAR_OFFSET_MS = 8 * 60 * 60 * 1_000;

function optionalFilter(value: string | null, maxLength: number): string | undefined {
  const normalized = value?.trim();
  return normalized !== undefined && normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : undefined;
}

export function overviewQueryFromSearchParams(search: URLSearchParams): PlatformOverviewQuery {
  const windowValue = search.get("window");
  const from = search.get("from");
  const to = search.get("to");
  const candidate: Record<string, string> = {};
  if (from !== null && to !== null) {
    candidate.from = from;
    candidate.to = to;
  } else {
    candidate.window =
      windowValue === "7d" || windowValue === "30d" || windowValue === "24h" ? windowValue : "24h";
  }
  const tenantId = optionalFilter(search.get("tenantId"), 200);
  const agentType = optionalFilter(search.get("agentType"), 100);
  if (tenantId !== undefined) candidate.tenantId = tenantId;
  if (agentType !== undefined) candidate.agentType = agentType;
  const parsed = platformOverviewQuerySchema.safeParse(candidate);
  return parsed.success ? parsed.data : { window: "24h" };
}

export function overviewQueryToSearchParams(query: PlatformOverviewQuery): URLSearchParams {
  const parsed = platformOverviewQuerySchema.parse(query);
  const search = new URLSearchParams();
  if (parsed.window !== undefined) search.set("window", parsed.window);
  if (parsed.from !== undefined) search.set("from", parsed.from);
  if (parsed.to !== undefined) search.set("to", parsed.to);
  if (parsed.tenantId !== undefined) search.set("tenantId", parsed.tenantId);
  if (parsed.agentType !== undefined) search.set("agentType", parsed.agentType);
  return search;
}

function isoToUlaanbaatarInput(value: string | undefined): string {
  if (value === undefined) return "";
  return new Date(Date.parse(value) + ULAANBAATAR_OFFSET_MS).toISOString().slice(0, 16);
}

function ulaanbaatarInputToIso(value: string): string {
  return new Date(`${value}:00+08:00`).toISOString();
}

export function PlatformOverviewFilters({
  query,
  tenantOptions,
  agentOptions,
  fetching,
  onApply,
  onRefresh,
}: {
  query: PlatformOverviewQuery;
  tenantOptions: readonly { id: string; name: string }[];
  agentOptions: readonly string[];
  fetching: boolean;
  onApply: (query: PlatformOverviewQuery) => void;
  onRefresh: () => void;
}) {
  const initialRange: RangeMode = query.window ?? "custom";
  const [range, setRange] = useState<RangeMode>(initialRange);
  const [from, setFrom] = useState(isoToUlaanbaatarInput(query.from));
  const [to, setTo] = useState(isoToUlaanbaatarInput(query.to));
  const [tenantId, setTenantId] = useState(query.tenantId ?? "");
  const [agentType, setAgentType] = useState(query.agentType ?? "");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const candidate: Record<string, string> = {};
    if (range === "custom") {
      if (from.length === 0 || to.length === 0) {
        setError("Custom хугацаанд эхлэх, дуусах огноо хоёул шаардлагатай");
        return;
      }
      candidate.from = ulaanbaatarInputToIso(from);
      candidate.to = ulaanbaatarInputToIso(to);
    } else {
      candidate.window = range;
    }
    const normalizedTenantId = optionalFilter(tenantId, 200);
    const normalizedAgentType = optionalFilter(agentType, 100);
    if (normalizedTenantId !== undefined) candidate.tenantId = normalizedTenantId;
    if (normalizedAgentType !== undefined) candidate.agentType = normalizedAgentType;
    const parsed = platformOverviewQuerySchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Filter утгаа шалгана уу");
      return;
    }
    setError(null);
    onApply(parsed.data);
  };

  const reset = () => {
    setRange("24h");
    setFrom("");
    setTo("");
    setTenantId("");
    setAgentType("");
    setError(null);
    onApply({ window: "24h" });
  };

  return (
    <form className="platform-filter-bar" aria-label="Control Tower filter" onSubmit={submit}>
      <div className="platform-filter-fields">
        <Field label="Хугацаа">
          <Select value={range} onChange={(event) => setRange(event.target.value as RangeMode)}>
            <option value="24h">Сүүлийн 24 цаг</option>
            <option value="7d">Сүүлийн 7 хоног</option>
            <option value="30d">Сүүлийн 30 хоног</option>
            <option value="custom">Custom хугацаа</option>
          </Select>
        </Field>
        {range === "custom" ? (
          <>
            <Field label="Эхлэх · Улаанбаатар">
              <Input
                type="datetime-local"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field label="Дуусах · Улаанбаатар">
              <Input
                type="datetime-local"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
          </>
        ) : null}
        <Field label="Tenant ID">
          <Input
            list="platform-tenant-options"
            value={tenantId}
            placeholder="Бүх компани"
            onChange={(event) => setTenantId(event.target.value)}
          />
          <datalist id="platform-tenant-options">
            {tenantOptions.map((tenant) => (
              <option key={tenant.id} value={tenant.id}>
                {tenant.name}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label="Agent type">
          <Input
            list="platform-agent-options"
            value={agentType}
            placeholder="Бүх агент"
            onChange={(event) => setAgentType(event.target.value)}
          />
          <datalist id="platform-agent-options">
            {agentOptions.map((agent) => (
              <option key={agent} value={agent} />
            ))}
          </datalist>
        </Field>
      </div>
      {error !== null ? (
        <p className="platform-filter-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="platform-filter-actions">
        <Button type="submit">Filter хэрэглэх</Button>
        <Button type="button" variant="secondary" onClick={reset}>
          <RotateCcw /> Цэвэрлэх
        </Button>
        <Button type="button" variant="ghost" disabled={fetching} onClick={onRefresh}>
          <RefreshCw className={fetching ? "animate-spin" : ""} />
          {fetching ? "Шинэчилж байна…" : "Шинэчлэх"}
        </Button>
      </div>
    </form>
  );
}
