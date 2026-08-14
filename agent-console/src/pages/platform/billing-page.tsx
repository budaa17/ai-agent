import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { platformFetch } from "../../api/platform-client";
import { Button, Card, ErrorState, LoadingState, PageHeading } from "../../components/ui";

/**
 * Platform billing control (landing-page-roadmap.md §22, Phase 8).
 *
 * Two things automation cannot decide live here: whether a bank transfer
 * actually arrived, and whether a tenant deserves a time-boxed exception. Both
 * demand a written reason and are recorded in the platform audit log.
 *
 * No revenue figure is shown. Publishing an MRR before invoice reconciliation is
 * trustworthy would put a number on a dashboard that nobody can defend.
 */

const overviewSchema = z.object({
  active: z.number(),
  activeTenants: z.number(),
  activeSubscriptions: z.number(),
  activeWithoutSubscription: z.number(),
  pendingPayment: z.number(),
  inGrace: z.number(),
  suspended: z.number(),
  graceEndingWithin7Days: z.number(),
  failedWebhooks: z.number(),
  unpaidInvoices: z.number(),
});

const subscriptionsSchema = z.object({
  subscriptions: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      provider: z.string(),
      currentPeriodEnd: z.string().nullable(),
      graceEndsAt: z.string().nullable(),
      cancelAtPeriodEnd: z.boolean(),
      providerSubscriptionId: z.string().nullable(),
      tenant: z.object({
        id: z.string(),
        slug: z.string(),
        name: z.string(),
        lifecycleStatus: z.string(),
      }),
      planCode: z.string(),
      interval: z.string(),
      currency: z.string(),
      unitAmountMinor: z.string().nullable(),
    }),
  ),
});

const webhooksSchema = z.object({
  events: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      providerEventId: z.string(),
      eventType: z.string(),
      status: z.string(),
      attemptCount: z.number(),
      lastErrorCode: z.string().nullable(),
      receivedAt: z.string(),
    }),
  ),
});

function formatMinor(minor: string | null, currency: string): string {
  if (minor === null) return "Гэрээт";
  const major = BigInt(minor) / 100n;
  const formatted = new Intl.NumberFormat("mn-MN").format(major);
  return currency === "MNT" ? `${formatted}₮` : `${formatted} ${currency}`;
}

function formatDate(value: string | null): string {
  return value === null ? "—" : new Date(value).toLocaleDateString("mn-MN");
}

const LIFECYCLE_TONE: Record<string, string> = {
  ACTIVE: "text-emerald-400",
  PAYMENT_GRACE: "text-amber-400",
  SUSPENDED: "text-rose-400",
  PENDING_PAYMENT: "text-rose-400",
  ARCHIVED: "text-slate-500",
};

function Stat({ label, value, tone }: { label: string; value: number; tone?: string | undefined }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900/60 p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

export function PlatformBillingPage() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const overview = useQuery({
    queryKey: ["platform", "billing", "overview"],
    queryFn: () => platformFetch("/billing/overview", overviewSchema),
  });
  const subscriptions = useQuery({
    queryKey: ["platform", "billing", "subscriptions"],
    queryFn: () => platformFetch("/billing/subscriptions", subscriptionsSchema),
  });
  const webhooks = useQuery({
    queryKey: ["platform", "billing", "webhooks"],
    queryFn: () => platformFetch("/billing/webhooks", webhooksSchema),
  });

  const confirmPayment = useMutation({
    mutationFn: (input: {
      subscriptionId: string;
      paymentReference: string;
      periodEnd: string;
      amountMinor: string;
      taxMinor: string;
      currency: string;
      reason: string;
    }) =>
      platformFetch(
        `/billing/manual-invoices/${encodeURIComponent(input.subscriptionId)}/confirm`,
        z.object({ tenantId: z.string(), invoiceId: z.string() }),
        { method: "POST", body: input },
      ),
    onSuccess: () => {
      setConfirming(null);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: ["platform", "billing"] });
    },
    onError: (error: unknown) =>
      setActionError(error instanceof Error ? error.message : "Баталгаажуулж чадсангүй"),
  });

  if (overview.isLoading) return <LoadingState label="Билл мэдээлэл ачаалж байна…" />;
  if (overview.isError) {
    return <ErrorState error={overview.error} retry={() => void overview.refetch()} />;
  }

  const stats = overview.data!;
  const rows = subscriptions.data?.subscriptions ?? [];
  const events = webhooks.data?.events ?? [];

  function submitConfirmation(event: FormEvent<HTMLFormElement>, subscriptionId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    confirmPayment.mutate({
      subscriptionId,
      paymentReference: String(form.get("paymentReference") ?? ""),
      // The operator enters whole tögrög; the API works in minor units.
      amountMinor: `${String(form.get("amount") ?? "0")}00`,
      taxMinor: `${String(form.get("tax") ?? "0")}00`,
      currency: "MNT",
      periodEnd: new Date(String(form.get("periodEnd"))).toISOString(),
      reason: String(form.get("reason") ?? ""),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Платформ"
        title="Төлбөрийн хяналт"
        description="Захиалгын эрүүл мэнд, дансаар төлөлт баталгаажуулалт, webhook-ийн төлөв."
      />

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Stat label="Идэвхтэй workspace" value={stats.activeTenants} tone="text-emerald-400" />
        <Stat
          label="Идэвхтэй subscription"
          value={stats.activeSubscriptions}
          tone="text-emerald-400"
        />
        <Stat
          label="Subscription нотолгоогүй"
          value={stats.activeWithoutSubscription}
          tone={stats.activeWithoutSubscription > 0 ? "text-rose-400" : undefined}
        />
        <Stat label="Grace" value={stats.inGrace} tone="text-amber-400" />
        <Stat label="Хаагдсан" value={stats.suspended} tone="text-rose-400" />
        <Stat label="Төлбөр хүлээж буй" value={stats.pendingPayment} />
        <Stat label="7 хоногт grace дуусах" value={stats.graceEndingWithin7Days} />
        <Stat
          label="Алдаатай webhook"
          value={stats.failedWebhooks}
          tone={stats.failedWebhooks > 0 ? "text-rose-400" : undefined}
        />
        <Stat label="Төлөгдөөгүй нэхэмжлэх" value={stats.unpaidInvoices} />
      </div>

      {stats.activeWithoutSubscription > 0 ? (
        <div
          role="status"
          className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100"
        >
          <strong>{stats.activeWithoutSubscription} workspace</strong> ACTIVE төлөвтэй боловч ACTIVE
          эсвэл TRIALING subscription нотолгоогүй байна. Эдгээр нь demo, migration-аас өвлөгдсөн
          эсвэл хугацаатай operator override байж болно — төлбөр төлсөн компани гэж тооцохгүй.
        </div>
      ) : null}

      {actionError !== null && (
        <p
          role="alert"
          className="rounded border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200"
        >
          {actionError}
        </p>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Захиалгууд</h2>
        {subscriptions.isLoading && <p className="mt-3 text-sm text-slate-400">Ачаалж байна…</p>}
        {rows.length === 0 && !subscriptions.isLoading && (
          <p className="mt-3 text-sm text-slate-400">Захиалга алга.</p>
        )}
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded border border-slate-800 bg-slate-900/40 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="font-medium">{row.tenant.name}</p>
                  <p className="text-xs text-slate-400">
                    {row.tenant.slug} · {row.planCode}/{row.interval} ·{" "}
                    {formatMinor(row.unitAmountMinor, row.currency)}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className={LIFECYCLE_TONE[row.tenant.lifecycleStatus] ?? "text-slate-300"}>
                    {row.tenant.lifecycleStatus}
                  </p>
                  <p className="text-xs text-slate-400">
                    {row.status} · {row.provider === "MANUAL_INVOICE" ? "дансаар" : "карт"} · дуусах{" "}
                    {formatDate(row.currentPeriodEnd)}
                  </p>
                </div>
              </div>

              {row.provider === "MANUAL_INVOICE" && row.status !== "ACTIVE" && (
                <div className="mt-3">
                  {confirming === row.id ? (
                    <form
                      onSubmit={(event) => submitConfirmation(event, row.id)}
                      className="grid gap-3 rounded border border-slate-700 bg-slate-950/60 p-4 sm:grid-cols-2"
                    >
                      <label className="text-sm">
                        <span className="text-slate-400">Гүйлгээний дугаар</span>
                        <input
                          name="paymentReference"
                          required
                          minLength={3}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-slate-400">Дүн (₮, НӨАТ-гүй)</span>
                        <input
                          name="amount"
                          type="number"
                          min={0}
                          required
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-slate-400">НӨАТ (₮)</span>
                        <input
                          name="tax"
                          type="number"
                          min={0}
                          defaultValue={0}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
                        />
                      </label>
                      <label className="text-sm">
                        <span className="text-slate-400">Хугацаа дуусах</span>
                        <input
                          name="periodEnd"
                          type="date"
                          required
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
                        />
                      </label>
                      <label className="text-sm sm:col-span-2">
                        <span className="text-slate-400">Шалтгаан (audit-д үлдэнэ)</span>
                        <input
                          name="reason"
                          required
                          minLength={3}
                          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
                        />
                      </label>
                      <div className="flex gap-2 sm:col-span-2">
                        <Button type="submit" disabled={confirmPayment.isPending}>
                          Төлбөр баталгаажуулах
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setConfirming(null)}>
                          Болих
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <Button variant="secondary" onClick={() => setConfirming(row.id)}>
                      Дансаар төлөлт баталгаажуулах
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Webhook-ийн төлөв</h2>
        <p className="mt-1 text-sm text-slate-400">
          Алдаатай эсвэл боловсруулагдаж буй event. Амжилттай нь энд харагдахгүй.
        </p>
        {events.length === 0 ? (
          <p className="mt-4 text-sm text-emerald-400">Хүлээгдэж буй асуудал алга.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-left text-slate-400">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Хүлээн авсан
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Event
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Төлөв
                  </th>
                  <th scope="col" className="py-2 pr-4 font-medium">
                    Оролдлого
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Алдаа
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id} className="border-b border-slate-800/60">
                    <td className="py-2 pr-4">
                      {new Date(event.receivedAt).toLocaleString("mn-MN")}
                    </td>
                    <td className="py-2 pr-4">{event.eventType}</td>
                    <td
                      className={`py-2 pr-4 ${event.status === "FAILED" ? "text-rose-400" : "text-amber-400"}`}
                    >
                      {event.status}
                    </td>
                    <td className="py-2 pr-4">{event.attemptCount}</td>
                    <td className="py-2 text-slate-400">{event.lastErrorCode ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
