import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Minus } from "lucide-react";
import {
  annualSaving,
  describeLimit,
  entitlement,
  formatMinorAmount,
  priceFor,
} from "../../api/public-billing";
import { useDocumentMeta } from "./use-document-meta";
import { usePublicPlans } from "./use-public-plans";
import "./pricing-page.css";

/**
 * Pricing page (landing-page-roadmap.md §13).
 *
 * Every number on this page comes from `/public/v1/plans`. Nothing is retyped
 * from the roadmap into JSX, so a plan change cannot leave the page promising a
 * limit the backend will refuse to honour.
 *
 * The interval defaults to yearly because that is the plan BuildWatch would
 * rather sell, and the monthly equivalent stays visible so the choice is honest.
 */

const COMPARISON_ROWS: ReadonlyArray<{
  featureKey: string;
  label: string;
  kind: "limit" | "flag";
}> = [
  { featureKey: "PROJECT_ACTIVE_MAX", label: "Идэвхтэй төсөл", kind: "limit" },
  { featureKey: "USER_ACTIVE_MAX", label: "Хэрэглэгч", kind: "limit" },
  { featureKey: "STORAGE_BYTES_MAX", label: "Файл хадгалалт", kind: "limit" },
  { featureKey: "AI_MONTHLY_RUNS_INCLUDED", label: "Сарын AI ажиллагаа", kind: "limit" },
  { featureKey: "AUDIT_RETENTION_DAYS", label: "Audit хадгалах хоног", kind: "limit" },
  { featureKey: "AGENT_DAILY_REPORT", label: "Өдрийн тайлангийн агент", kind: "flag" },
  { featureKey: "AGENT_PROGRESS_VERIFICATION", label: "Гүйцэтгэл баталгаажуулалт", kind: "flag" },
  { featureKey: "AGENT_BOQ_ANALYSIS", label: "Тоо хэмжээний шинжилгээ", kind: "flag" },
  { featureKey: "ADVANCED_REPORTS", label: "Дэлгэрэнгүй тайлан ба экспорт", kind: "flag" },
  { featureKey: "API_ACCESS", label: "API хандалт", kind: "flag" },
  { featureKey: "AI_OVERAGE_ALLOWED", label: "AI хязгаар давахыг зөвшөөрөх", kind: "flag" },
  { featureKey: "PRIORITY_SUPPORT", label: "Тэргүүн ээлжийн дэмжлэг", kind: "flag" },
];

function FlagCell({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <>
      <Check aria-hidden className="inline h-4 w-4 text-emerald-400" />
      <span className="sr-only">Багтсан</span>
    </>
  ) : (
    <>
      <Minus aria-hidden className="inline h-4 w-4 text-slate-500" />
      <span className="sr-only">Багтаагүй</span>
    </>
  );
}

export function PricingPage() {
  useDocumentMeta({
    title: "BuildWatch — Үнэ",
    description:
      "Хэрэглэгчээр биш, төслөөр. Starter болон Business багц, сар эсвэл жилээр. Жилээр авбал 2 сар үнэгүй.",
  });

  const [interval, setInterval] = useState<"MONTH" | "YEAR">("YEAR");
  const { catalog, error, loading, slow, retry } = usePublicPlans();

  const plans = useMemo(
    () =>
      [...(catalog?.plans ?? [])].sort((left, right) => {
        const leftPrice = priceFor(left, "MONTH");
        const rightPrice = priceFor(right, "MONTH");
        if (leftPrice === null) return rightPrice === null ? 0 : 1;
        if (rightPrice === null) return -1;
        const leftAmount = BigInt(leftPrice);
        const rightAmount = BigInt(rightPrice);
        return leftAmount < rightAmount ? -1 : leftAmount > rightAmount ? 1 : 0;
      }),
    [catalog],
  );
  const vatPercent = ((catalog?.vatRateBasisPoints ?? 1_000) / 100).toFixed(0);

  return (
    <div className="bw-pricing-page mx-auto max-w-6xl px-4 py-16">
      <header className="bw-pricing-header text-center">
        <h1 className="text-3xl font-semibold sm:text-4xl">Ил тод үнэ</h1>
        <p className="mt-3 text-slate-300">Нуугдмал төлбөргүй. Хэрэглэгчээр биш, төслөөр.</p>
      </header>

      <div
        role="group"
        aria-label="Төлбөрийн давтамж"
        className="bw-billing-switch mx-auto mt-8 flex w-fit rounded-lg border p-1"
      >
        {(
          [
            ["MONTH", "Сараар"],
            ["YEAR", "Жилээр — 2 сар үнэгүй"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={interval === value}
            onClick={() => setInterval(value)}
            className={interval === value ? "is-active" : ""}
          >
            {label}
          </button>
        ))}
      </div>

      {error !== null && (
        <div
          role="alert"
          className="mx-auto mt-8 flex max-w-2xl flex-col items-center gap-3 rounded border border-rose-500/40 bg-rose-500/10 p-4 text-center text-rose-200"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-rose-300/50 px-4 py-2 font-medium hover:bg-rose-100/10"
          >
            Дахин оролдох
          </button>
        </div>
      )}
      {loading && (
        <div className="mt-8 text-center text-slate-400" role="status" aria-live="polite">
          <p>Багцын мэдээлэл ачаалж байна…</p>
          {slow && (
            <p className="mt-2 text-sm">
              Сервер идэвхжиж байна. Анхны ачаалалт нэг минут орчим үргэлжилж болно.
            </p>
          )}
        </div>
      )}

      <div className="bw-pricing-card-grid mt-10">
        {plans.map((plan) => {
          const amount = priceFor(plan, interval);
          const monthly = priceFor(plan, "MONTH");
          const yearly = priceFor(plan, "YEAR");
          const saving = annualSaving(plan);
          const recommended = plan.code === "business";
          return (
            <article
              key={plan.code}
              className={`bw-pricing-card ${recommended ? "is-recommended" : ""}`}
            >
              <div className="bw-pricing-card-heading">
                <h2 className="text-xl font-semibold">{plan.name}</h2>
                {/* Not "most popular": no usage statistics exist yet, and an
                    invented one would be exactly the fake social proof §14 bans. */}
                {recommended && <span className="bw-recommended-badge">Санал болгож буй</span>}
              </div>
              <p className="bw-pricing-description">{plan.description}</p>

              <div className="bw-price-block">
                <p className="bw-price-value">
                  {amount === null ? "—" : formatMinorAmount(amount, plan.currency)}
                  <span>/{interval === "MONTH" ? "сар" : "жил"}</span>
                </p>
                <p className="bw-vat-note">НӨАТ ороогүй ({vatPercent}% нэмэгдэнэ)</p>
                {interval === "YEAR" && saving !== null && (
                  <p className="bw-saving-note">
                    Жилд {formatMinorAmount(saving, plan.currency)} хэмнэнэ
                    {monthly !== null && (
                      <span> (сараар {formatMinorAmount(monthly, plan.currency)})</span>
                    )}
                  </p>
                )}
                {interval === "MONTH" && yearly !== null && (
                  <p className="bw-price-alternative">
                    Жилээр {formatMinorAmount(yearly, plan.currency)}
                  </p>
                )}
              </div>

              <ul className="bw-plan-benefits">
                <li>{describeLimit(plan, "PROJECT_ACTIVE_MAX")} идэвхтэй төсөл</li>
                <li>{describeLimit(plan, "USER_ACTIVE_MAX")} хэрэглэгч</li>
                <li>{describeLimit(plan, "STORAGE_BYTES_MAX")} хадгалалт</li>
                <li>Сард {describeLimit(plan, "AI_MONTHLY_RUNS_INCLUDED")} AI ажиллагаа</li>
                <li>{describeLimit(plan, "AUDIT_RETENTION_DAYS")} хоног audit</li>
                {entitlement(plan, "API_ACCESS")?.enabled === true && <li>API хандалт</li>}
                {entitlement(plan, "PRIORITY_SUPPORT")?.enabled === true && (
                  <li>Тэргүүн ээлжийн дэмжлэг</li>
                )}
              </ul>

              <Link
                to={`/company-signup?plan=${encodeURIComponent(plan.code)}&interval=${interval}`}
                className={`bw-price-cta ${recommended ? "is-primary" : ""}`}
              >
                {plan.name} сонгох
              </Link>
            </article>
          );
        })}
      </div>

      <section className="bw-enterprise-pricing mt-8">
        <h2 className="text-lg font-semibold">Enterprise</h2>
        <p className="mt-2 text-sm text-slate-300">
          Групп компани, SSO, SLA, гэрээт нэхэмжлэх. Хэрэгцээнд тохирсон хязгаар.
        </p>
        <Link
          to="/contact"
          className="mt-4 inline-block rounded border border-slate-600 px-5 py-2.5 text-sm font-medium hover:border-slate-400"
        >
          Холбоо барих
        </Link>
      </section>

      {plans.length > 0 && (
        <section className="mt-12" aria-labelledby="comparison">
          <h2 id="comparison" className="text-xl font-semibold">
            Багцын харьцуулалт
          </h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <caption className="sr-only">Багц бүрийн хязгаар ба боломжийн харьцуулалт</caption>
              <thead>
                <tr className="border-b border-slate-800 text-left">
                  <th scope="col" className="py-3 pr-4 font-medium text-slate-300">
                    Боломж
                  </th>
                  {plans.map((plan) => (
                    <th key={plan.code} scope="col" className="py-3 pr-4 font-medium">
                      {plan.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.featureKey} className="border-b border-slate-800/60">
                    <th scope="row" className="py-3 pr-4 text-left font-normal text-slate-300">
                      {row.label}
                    </th>
                    {plans.map((plan) => (
                      <td key={plan.code} className="py-3 pr-4">
                        {row.kind === "limit" ? (
                          describeLimit(plan, row.featureKey)
                        ) : (
                          <FlagCell enabled={entitlement(plan, row.featureKey)?.enabled === true} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="mt-10 text-center text-sm text-slate-400">
        Бүх багцад: монгол хэл, офлайн талбайн горим, audit trail, өгөгдлийн экспорт, дотоодын
        нэхэмжлэх ба НӨАТ-ын падаан.
      </p>
    </div>
  );
}
