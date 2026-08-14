import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { buildWatchApi } from "../api/client";
import { entityNumber, entityString, formatDate, formatNumber } from "../lib/format";
import { Badge, Card, DataTable, ErrorState, Input, LoadingState } from "./ui";

type Row = Record<string, unknown>;

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  ON_TRACK: "success",
  AT_RISK: "warning",
  LIKELY_LATE: "danger",
  CRITICAL_LATE: "danger",
  INSUFFICIENT_DATA: "neutral",
};

/**
 * Point-in-time forecast lookup. The workspace only ships the newest snapshots,
 * so "what did we think a fortnight ago, before the concrete slipped" can only
 * be answered by asking the API with an `asOf` date.
 */
export function ForecastAsOf({ projectId }: { projectId: string }) {
  const [asOf, setAsOf] = useState("");

  const forecast = useQuery({
    queryKey: ["forecast-as-of", projectId, asOf],
    queryFn: () => buildWatchApi.latestForecast(projectId, asOf === "" ? undefined : asOf),
    staleTime: 60_000,
  });

  const snapshot = forecast.data ?? null;
  const drivers = ((snapshot?.drivers as Row[] | undefined) ?? []).slice(0, 6);

  return (
    <Card>
      <div className="card-heading">
        <div>
          <p className="eyebrow">POINT IN TIME</p>
          <h2>Тухайн өдрийн прогноз</h2>
        </div>
        {snapshot === null ? null : (
          <Badge tone={STATUS_TONE[entityString(snapshot, "status")] ?? "neutral"}>
            {entityString(snapshot, "status")}
          </Badge>
        )}
      </div>

      <div className="asof-controls">
        <CalendarClock />
        <Input
          type="date"
          aria-label="Прогнозын огноо"
          value={asOf}
          onChange={(event) => setAsOf(event.target.value)}
        />
        {asOf === "" ? (
          <span className="muted-note">Хамгийн сүүлийн прогноз харагдаж байна</span>
        ) : (
          <button type="button" className="link-button" onClick={() => setAsOf("")}>
            Сүүлийн рүү буцах
          </button>
        )}
      </div>

      {forecast.isPending ? (
        <LoadingState label="Прогноз ачаалж байна…" />
      ) : forecast.isError ? (
        <ErrorState error={forecast.error} retry={() => void forecast.refetch()} />
      ) : snapshot === null ? (
        <p className="muted-note">Энэ огноонд тооцоологдсон прогноз алга.</p>
      ) : (
        <>
          <dl className="detail-list">
            <div>
              <dt>Тооцоолсон огноо</dt>
              <dd>{formatDate(entityString(snapshot, "asOf"))}</dd>
            </div>
            <div>
              <dt>Дуусах төлөв</dt>
              <dd>{formatDate(entityString(snapshot, "projectedFinish"))}</dd>
            </div>
            <div>
              <dt>Хоцрогдол</dt>
              <dd>{formatNumber(entityNumber(snapshot, "delayDays"), 1)} хоног</dd>
            </div>
            <div>
              <dt>Итгэл</dt>
              <dd>{formatNumber((entityNumber(snapshot, "confidence") ?? 0) * 100, 0)}%</dd>
            </div>
          </dl>
          {drivers.length > 0 ? (
            <DataTable
              headers={["Шалтгаан", "Хувь нэмэр", "Тайлбар"]}
              rows={drivers.map((driver) => [
                entityString(driver, "driverCode"),
                `${formatNumber(entityNumber(driver, "contribution"), 2)} хоног`,
                entityString(driver, "description"),
              ])}
            />
          ) : null}
        </>
      )}
    </Card>
  );
}
