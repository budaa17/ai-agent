import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { tenantBillingApi } from "../api/tenant-billing";
import { Button, Card, ErrorState, LoadingState, PageHeading } from "../components/ui";
import { friendlyError } from "../lib/api-error";

/**
 * Company Admin billing page (landing-page-roadmap.md §21).
 *
 * This is the screen a company uses to get *out* of a payment problem, so it has
 * to render while the rest of the workspace is gated. It shows what was bought,
 * what is being used against it, and the invoices — and it never touches a card
 * number: payment methods are changed in the provider's own portal.
 */

function formatMinor(minor: string, currency: string): string {
  const major = BigInt(minor) / 100n;
  const formatted = new Intl.NumberFormat("mn-MN").format(major);
  return currency === "MNT" ? `${formatted}₮` : `${formatted} ${currency}`;
}

function formatDate(value: string | null): string {
  return value === null ? "—" : new Date(value).toLocaleDateString("mn-MN");
}

function formatBytes(value: string): string {
  const bytes = BigInt(value);
  const gib = Number(bytes) / 1_073_741_824;
  return `${gib.toFixed(gib < 10 ? 2 : 0)} GB`;
}

const LIFECYCLE_LABEL: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Идэвхтэй", tone: "text-emerald-400" },
  PAYMENT_GRACE: { label: "Төлбөр хүлээгдэж байна", tone: "text-amber-400" },
  SUSPENDED: { label: "Түр хаагдсан", tone: "text-rose-400" },
  PENDING_PAYMENT: { label: "Төлбөр хийгдээгүй", tone: "text-rose-400" },
  ARCHIVED: { label: "Архивлагдсан", tone: "text-slate-400" },
};

function UsageBar({
  label,
  used,
  limit,
  render,
}: {
  label: string;
  used: number;
  limit: number | null;
  render: (value: number) => string;
}) {
  const percent = limit === null || limit === 0 ? 0 : Math.min(100, (used / limit) * 100);
  const critical = percent >= 100;
  const warning = percent >= 80 && !critical;
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-300">{label}</span>
        <span
          className={critical ? "text-rose-400" : warning ? "text-amber-400" : "text-slate-200"}
        >
          {render(used)} / {limit === null ? "Гэрээгээр" : render(limit)}
        </span>
      </div>
      <div
        className="mt-1 h-2 overflow-hidden rounded bg-slate-800"
        role="progressbar"
        aria-label={label}
        aria-valuenow={Math.round(percent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full ${critical ? "bg-rose-500" : warning ? "bg-amber-500" : "bg-sky-500"}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function BillingPage() {
  const queryClient = useQueryClient();
  const [cancelError, setCancelError] = useState<string | null>(null);

  const subscription = useQuery({
    queryKey: ["billing", "subscription"],
    queryFn: tenantBillingApi.subscription,
  });
  const usage = useQuery({ queryKey: ["billing", "usage"], queryFn: tenantBillingApi.usage });
  const entitlements = useQuery({
    queryKey: ["billing", "entitlements"],
    queryFn: tenantBillingApi.entitlements,
  });
  const invoices = useQuery({
    queryKey: ["billing", "invoices"],
    queryFn: tenantBillingApi.invoices,
  });

  const portal = useMutation({
    mutationFn: tenantBillingApi.portal,
    onSuccess: (result) => window.open(result.url, "_blank", "noopener,noreferrer"),
    onError: (error: unknown) => setCancelError(friendlyError(error).message),
  });
  const cancel = useMutation({
    mutationFn: () => tenantBillingApi.cancel(null),
    onSuccess: () => {
      setCancelError(null);
      void queryClient.invalidateQueries({ queryKey: ["billing"] });
    },
    onError: (error: unknown) => setCancelError(friendlyError(error).message),
  });

  if (subscription.isLoading) return <LoadingState label="Захиалгын мэдээлэл ачаалж байна…" />;
  if (subscription.isError) {
    return <ErrorState error={subscription.error} retry={() => void subscription.refetch()} />;
  }

  const data = subscription.data!;
  const lifecycle = LIFECYCLE_LABEL[data.lifecycleStatus] ?? {
    label: data.lifecycleStatus,
    tone: "text-slate-300",
  };
  const limits = entitlements.data?.values ?? null;
  const numericLimit = (key: string): number | null => {
    const value = limits?.[key];
    if (value === undefined || !value.enabled || value.limitValue === null) return null;
    return Number(value.limitValue);
  };

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Байгууллага"
        title="Төлбөр ба захиалга"
        description="Багц, хэрэглээ, нэхэмжлэхийн түүх."
      />

      {(data.lifecycleStatus === "PAYMENT_GRACE" || data.lifecycleStatus === "SUSPENDED") && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded border border-amber-500/40 bg-amber-500/10 p-4"
        >
          <AlertTriangle aria-hidden className="mt-0.5 h-5 w-5 text-amber-400" />
          <div className="text-sm">
            <p className="font-medium text-amber-100">
              {data.lifecycleStatus === "PAYMENT_GRACE"
                ? "Төлбөр хийгдээгүй байна"
                : "Захиалга түр хаагдсан"}
            </p>
            <p className="mt-1 text-amber-100/80">
              {data.lifecycleStatus === "PAYMENT_GRACE"
                ? `Ажлын талбар ${formatDate(data.subscription?.graceEndsAt ?? null)} хүртэл бүрэн ажиллана. Түүнээс хойш шинэ өөрчлөлт болон AI ажиллагаа зогсоно.`
                : "Шинэ өөрчлөлт болон AI ажиллагаа зогссон. Өгөгдөл хэвээр байгаа — төлбөрөө сэргээснээр үргэлжилнэ."}
            </p>
          </div>
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-400">Одоогийн багц</p>
            <p className="mt-1 text-2xl font-semibold">
              {data.subscription?.planName ?? "Багц холбогдоогүй"}
            </p>
            <p className={`mt-1 text-sm ${lifecycle.tone}`}>{lifecycle.label}</p>
          </div>
          {data.subscription !== null && (
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-slate-400">Үнэ</dt>
                <dd>
                  {data.subscription.unitAmountMinor === null
                    ? "Гэрээгээр"
                    : `${formatMinor(data.subscription.unitAmountMinor, data.subscription.currency)} / ${
                        data.subscription.interval === "MONTH" ? "сар" : "жил"
                      }`}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Дараагийн сунгалт</dt>
                <dd>{formatDate(data.subscription.currentPeriodEnd)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Төлбөрийн суваг</dt>
                <dd>
                  {data.subscription.provider === "MANUAL_INVOICE" ? "Дансаар (гэрээт)" : "Карт"}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Билл имэйл</dt>
                <dd>{data.billingEmail ?? "—"}</dd>
              </div>
            </dl>
          )}
        </div>

        {data.subscription?.cancelAtPeriodEnd === true && (
          <p className="mt-4 rounded border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
            Захиалга {formatDate(data.subscription.currentPeriodEnd)}-нд дуусахаар товлогдсон. Тэр
            өдөр хүртэл бүх боломж хэвээр ажиллана.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          {data.subscription === null ? (
            <Link
              to="/pricing"
              className="inline-flex items-center rounded bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
            >
              Багц сонгох
            </Link>
          ) : data.subscription.provider === "MANUAL_INVOICE" ? (
            <a
              href="#billing-invoices"
              className="inline-flex items-center rounded bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-sky-400"
            >
              Нэхэмжлэхүүдийг харах
            </a>
          ) : (
            <Button onClick={() => portal.mutate()} disabled={portal.isPending}>
              Төлбөрийн тохиргоо
              <ExternalLink aria-hidden className="ml-2 inline h-4 w-4" />
            </Button>
          )}
          {data.subscription !== null && data.subscription.cancelAtPeriodEnd === false && (
            <Button variant="secondary" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Хугацааны эцэст цуцлах
            </Button>
          )}
        </div>
        {cancelError !== null && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {cancelError}
          </p>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Энэ сарын хэрэглээ</h2>
        {usage.isLoading && <p className="mt-3 text-sm text-slate-400">Ачаалж байна…</p>}
        {usage.data !== undefined && (
          <div className="mt-4 space-y-4">
            <UsageBar
              label="Идэвхтэй төсөл"
              used={usage.data.activeProjects}
              limit={numericLimit("PROJECT_ACTIVE_MAX")}
              render={(value) => String(value)}
            />
            <UsageBar
              label="Хэрэглэгч"
              used={usage.data.activeUsers}
              limit={numericLimit("USER_ACTIVE_MAX")}
              render={(value) => String(value)}
            />
            <UsageBar
              label="AI ажиллагаа"
              used={usage.data.aiRunsThisMonth}
              limit={numericLimit("AI_MONTHLY_RUNS_INCLUDED")}
              render={(value) => String(value)}
            />
            <UsageBar
              label="Файл хадгалалт"
              used={Number(BigInt(usage.data.storageBytes) / 1_073_741_824n)}
              limit={
                numericLimit("STORAGE_BYTES_MAX") === null
                  ? null
                  : numericLimit("STORAGE_BYTES_MAX")! / 1_073_741_824
              }
              render={(value) => `${value} GB`}
            />
            <p className="text-xs text-slate-500">
              Хэрэглээ {formatDate(usage.data.periodStart)}-наас хойш. Хадгалалт{" "}
              {formatBytes(usage.data.storageBytes)}.
            </p>
          </div>
        )}
        {entitlements.data?.values === null && (
          <p className="mt-4 rounded border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-400">
            Энэ ажлын талбар багцын хязгаартай холбогдоогүй байна ({entitlements.data.source}).
          </p>
        )}
      </Card>

      <div id="billing-invoices">
        <Card>
          <h2 className="text-lg font-semibold">Нэхэмжлэх</h2>
          {invoices.isLoading && <p className="mt-3 text-sm text-slate-400">Ачаалж байна…</p>}
          {invoices.data !== undefined && invoices.data.invoices.length === 0 && (
            <p className="mt-3 text-sm text-slate-400">Одоогоор нэхэмжлэх алга.</p>
          )}
          {invoices.data !== undefined && invoices.data.invoices.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-slate-400">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Огноо
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Дугаар
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Дүн (НӨАТ-тай)
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      Төлөв
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      Баримт
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.data.invoices.map((invoice) => (
                    <tr key={invoice.id} className="border-b border-slate-800/60">
                      <td className="py-2 pr-4">{formatDate(invoice.createdAt)}</td>
                      <td className="py-2 pr-4">{invoice.invoiceNumber ?? "—"}</td>
                      <td className="py-2 pr-4">
                        {formatMinor(invoice.totalMinor, invoice.currency)}
                      </td>
                      <td className="py-2 pr-4">{invoice.status}</td>
                      <td className="py-2">
                        {invoice.hostedInvoiceUrl === null ? (
                          "—"
                        ) : (
                          <a
                            href={invoice.hostedInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-400 underline"
                          >
                            Харах
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
