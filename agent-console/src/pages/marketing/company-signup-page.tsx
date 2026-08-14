import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  createCompanySignup,
  resendCompanySignupCode,
  startCompanyCheckout,
  verifyCompanySignup,
} from "../../api/public-billing";
import { useDocumentMeta } from "./use-document-meta";

/**
 * Public company signup (landing-page-roadmap.md §20.1, §20.2).
 *
 * Three deliberate absences: no password field, no amount and no provider price.
 * The password is set only after payment through a one-time link, and what is
 * charged is resolved on the server from the plan code alone.
 */

type Step = "DETAILS" | "VERIFY" | "CHECKOUT" | "REDIRECTING";

const MONGOLIAN_SLUG_CHARACTERS: Readonly<Record<string, string>> = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ё: "yo",
  ж: "j",
  з: "z",
  и: "i",
  й: "i",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  ө: "u",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ү: "u",
  ф: "f",
  х: "kh",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "shch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function normalizeSlugInput(value: string): string {
  if (value.trim() === "") return "";
  const transliterated = Array.from(value.toLowerCase(), (character) => {
    return MONGOLIAN_SLUG_CHARACTERS[character] ?? character;
  }).join("");
  return transliterated
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/g, "")
    .slice(0, 60);
}

/** Generates the complete ASCII workspace key required by the public signup contract. */
export function slugifyCompanyName(value: string): string {
  return normalizeSlugInput(value).replace(/-+$/g, "");
}

export function CompanySignupPage() {
  useDocumentMeta({
    title: "BuildWatch — Компани бүртгүүлэх",
    description: "Багцаа сонгоод компанийхаа ажлын талбарыг үүсгэнэ үү.",
  });

  const [params] = useSearchParams();
  const planCode = params.get("plan") ?? "starter";
  const interval = params.get("interval") === "MONTH" ? "MONTH" : "YEAR";

  const [step, setStep] = useState<Step>("DETAILS");
  const [companyName, setCompanyName] = useState("");
  const [desiredSlug, setDesiredSlug] = useState("");
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [signupIntentId, setSignupIntentId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [developmentVerificationCode, setDevelopmentVerificationCode] = useState<string | null>(
    null,
  );
  const [resendSeconds, setResendSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submitDetails(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createCompanySignup({
        companyName: companyName.trim(),
        desiredSlug: desiredSlug.trim() || slugifyCompanyName(companyName) || "workspace",
        adminEmail: adminEmail.trim(),
        adminDisplayName: adminDisplayName.trim(),
        planCode,
        interval,
      });
      setSignupIntentId(result.signupIntentId);
      setDevelopmentVerificationCode(result.verificationCode ?? null);
      if (result.verificationCode !== undefined) setCode(result.verificationCode);
      setResendSeconds(60);
      // A previous request may already have verified this idempotent signup.
      // Never trap that buyer on a code screen whose one-time code was consumed.
      setStep(result.status === "CONFIRMING" ? "CHECKOUT" : "VERIFY");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Бүртгэл үүсгэж чадсангүй");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitVerification(event: FormEvent) {
    event.preventDefault();
    if (submitting || signupIntentId === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await verifyCompanySignup(signupIntentId, code.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Баталгаажуулалт амжилтгүй боллоо");
      setSubmitting(false);
      return;
    }
    setStep("CHECKOUT");
    try {
      await redirectToCheckout(signupIntentId);
    } catch (cause) {
      setStep("CHECKOUT");
      setError(
        cause instanceof Error
          ? cause.message
          : "Төлбөрийн хуудсыг нээж чадсангүй. Дахин оролдоно уу.",
      );
      setSubmitting(false);
    }
  }

  async function redirectToCheckout(intentId: string) {
    const checkout = await startCompanyCheckout(intentId);
    setStep("REDIRECTING");
    window.location.assign(checkout.url);
  }

  async function openCheckout(intentId = signupIntentId) {
    if (submitting || intentId === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await redirectToCheckout(intentId);
    } catch (cause) {
      setStep("CHECKOUT");
      setError(
        cause instanceof Error
          ? cause.message
          : "Төлбөрийн хуудсыг нээж чадсангүй. Дахин оролдоно уу.",
      );
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (step !== "VERIFY" || resendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setResendSeconds((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds, step]);

  async function resendCode() {
    if (submitting || signupIntentId === null || resendSeconds > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await resendCompanySignupCode(signupIntentId);
      setDevelopmentVerificationCode(result.verificationCode ?? null);
      setCode(result.verificationCode ?? "");
      setResendSeconds(result.retryAfterSeconds);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Код дахин илгээж чадсангүй");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-3xl font-semibold">Компани бүртгүүлэх</h1>
      <p className="mt-2 text-slate-300">
        Сонгосон багц: <strong className="text-[#2C2C2A]">{planCode}</strong> ·{" "}
        {interval === "MONTH" ? "сараар" : "жилээр"}{" "}
        <Link to="/pricing" className="text-sky-400 underline">
          өөрчлөх
        </Link>
      </p>

      {error !== null && (
        <p
          role="alert"
          className="mt-6 rounded border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200"
        >
          {error}
        </p>
      )}

      {step === "DETAILS" && (
        <form onSubmit={submitDetails} className="mt-8 space-y-4">
          <label className="block">
            <span className="text-sm text-slate-300">Компанийн нэр</span>
            <input
              required
              minLength={2}
              value={companyName}
              onChange={(event) => {
                setCompanyName(event.target.value);
                if (!slugManuallyEdited) setDesiredSlug(slugifyCompanyName(event.target.value));
              }}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <div>
            <label htmlFor="company-workspace-slug" className="block">
              <span className="text-sm text-slate-300">Ажлын талбарын хаяг</span>
            </label>
            <input
              id="company-workspace-slug"
              aria-describedby="company-workspace-slug-help"
              required
              pattern="[a-z0-9][a-z0-9\-]*[a-z0-9]"
              value={desiredSlug}
              onChange={(event) => {
                setSlugManuallyEdited(true);
                setDesiredSlug(normalizeSlugInput(event.target.value));
              }}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            />
            <span id="company-workspace-slug-help" className="mt-1 block text-xs text-slate-400">
              Зөвхөн жижиг үсэг, тоо, зураас. Аль хэдийн эзэмшигдсэн бол ойролцоо хаяг олгоно.
            </span>
          </div>
          <label className="block">
            <span className="text-sm text-slate-300">Администраторын нэр</span>
            <input
              required
              minLength={2}
              value={adminDisplayName}
              onChange={(event) => setAdminDisplayName(event.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-300">Администраторын имэйл</span>
            <input
              required
              type="email"
              value={adminEmail}
              onChange={(event) => setAdminEmail(event.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <p className="text-xs text-slate-400">
            Нууц үг одоо асуухгүй. Төлбөр баталгаажсаны дараа нэг удаагийн холбоосоор тохируулна.
          </p>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-sky-500 px-4 py-3 font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60"
          >
            {submitting ? "Илгээж байна…" : "Үргэлжлүүлэх"}
          </button>
        </form>
      )}

      {step === "VERIFY" && (
        <form onSubmit={submitVerification} className="mt-8 space-y-4">
          {developmentVerificationCode === null ? (
            <p className="text-slate-300">
              <strong>{adminEmail}</strong> хаяг руу илгээсэн 6 оронтой кодыг оруулна уу. Код 10
              минут хүчинтэй бөгөөд баталгаажуулсны дараа төлбөрийн хуудас руу шилжинэ.
            </p>
          ) : (
            <div
              role="status"
              className="rounded border border-amber-500/40 bg-amber-500/10 p-4 text-slate-700"
            >
              <p className="font-semibold text-amber-800">Demo орчин — SMTP тохируулаагүй</p>
              <p className="mt-1 text-sm">
                Email бодитоор илгээгдээгүй. Backend-ийн development fallback кодыг автоматаар
                орууллаа:
              </p>
              <p className="mt-3 font-mono text-2xl font-semibold tracking-[0.3em] text-slate-950">
                {developmentVerificationCode}
              </p>
            </div>
          )}
          <label className="block">
            <span className="text-sm text-slate-300">Баталгаажуулах код</span>
            <input
              required
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-center text-2xl tracking-[0.35em]"
            />
          </label>
          <button
            type="button"
            disabled={submitting || resendSeconds > 0}
            onClick={() => void resendCode()}
            className="w-full rounded border border-slate-600 px-4 py-2 text-sm disabled:opacity-60"
          >
            {resendSeconds > 0 ? `Дахин илгээх (${resendSeconds} сек)` : "Код дахин илгээх"}
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-sky-500 px-4 py-3 font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60"
          >
            {submitting ? "Шалгаж байна…" : "Баталгаажуулж, төлбөр рүү шилжих"}
          </button>
        </form>
      )}

      {step === "CHECKOUT" && (
        <section className="mt-8 space-y-4" aria-labelledby="checkout-ready-title">
          <div className="rounded border border-emerald-600/30 bg-emerald-600/10 p-4">
            <h2 id="checkout-ready-title" className="font-semibold text-emerald-900">
              Имэйл амжилттай баталгаажлаа
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Код дахин оруулах шаардлагагүй. Stripe төлбөрийн хуудсыг нээж үргэлжлүүлнэ үү.
            </p>
          </div>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void openCheckout()}
            className="w-full rounded bg-sky-500 px-4 py-3 font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-60"
          >
            {submitting ? "Төлбөрийн хуудас нээж байна…" : "Төлбөр рүү дахин оролдох"}
          </button>
        </section>
      )}

      {step === "REDIRECTING" && (
        <p className="mt-8 text-slate-300">Төлбөрийн хуудас руу шилжиж байна…</p>
      )}
    </div>
  );
}
