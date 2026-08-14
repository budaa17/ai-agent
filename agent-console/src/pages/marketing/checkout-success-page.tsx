import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchSignupStatus, type SignupStatus } from "../../api/public-billing";
import { useDocumentMeta } from "./use-document-meta";

/**
 * Checkout return page (landing-page-roadmap.md §20.5).
 *
 * Landing here proves nothing. The provider redirects a browser, and a browser
 * redirect is not a payment. The page therefore announces nothing until the
 * backend — which only trusts a signed webhook — reports the workspace active.
 *
 * Polling backs off and is bounded, so a stalled provider does not leave a tab
 * hammering the API forever.
 */

const POLL_START_MS = 1_500;
const POLL_MAX_MS = 15_000;
const POLL_DEADLINE_MS = 5 * 60 * 1_000;

export function CheckoutSuccessPage() {
  useDocumentMeta({
    title: "BuildWatch — Төлбөр баталгаажуулж байна",
    description: "Төлбөрийн баталгаажуулалтыг хүлээж байна.",
  });

  const [params] = useSearchParams();
  const signupIntentId = params.get("signup") ?? params.get("checkout");
  const [status, setStatus] = useState<SignupStatus["status"] | "UNKNOWN">("CONFIRMING");
  const [timedOut, setTimedOut] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (signupIntentId === null) {
      setStatus("UNKNOWN");
      return;
    }
    let cancelled = false;
    const startedAt = Date.now();
    let delay = POLL_START_MS;

    const poll = async () => {
      try {
        const result = await fetchSignupStatus(signupIntentId);
        if (cancelled) return;
        setStatus(result.status);
        if (
          result.status === "ACTIVE" ||
          result.status === "FAILED" ||
          result.status === "EXPIRED"
        ) {
          return;
        }
      } catch {
        // A transient read failure is not a payment failure; keep waiting.
      }
      if (cancelled) return;
      if (Date.now() - startedAt > POLL_DEADLINE_MS) {
        setTimedOut(true);
        return;
      }
      delay = Math.min(delay * 1.6, POLL_MAX_MS);
      timer.current = window.setTimeout(() => void poll(), delay);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [signupIntentId]);

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      {status === "ACTIVE" ? (
        <>
          <h1 className="text-3xl font-semibold">Ажлын талбар бэлэн боллоо</h1>
          <p className="mt-4 text-slate-300">
            Администраторын имэйл рүү нууц үг тохируулах нэг удаагийн холбоос илгээгдэнэ. Түүнийг
            ашиглаж эхний нэвтрэлтээ хийнэ үү.
          </p>
          <Link
            to="/login"
            className="mt-8 inline-block rounded bg-sky-500 px-6 py-3 font-medium text-slate-950 hover:bg-sky-400"
          >
            Нэвтрэх хуудас руу
          </Link>
        </>
      ) : status === "FAILED" || status === "EXPIRED" ? (
        <>
          <h1 className="text-3xl font-semibold">Төлбөр баталгаажсангүй</h1>
          <p className="mt-4 text-slate-300">
            Төлбөр бүртгэгдээгүй эсвэл хүсэлтийн хугацаа дууссан байна. Дахин оролдоно уу.
          </p>
          <Link
            to="/pricing"
            className="mt-8 inline-block rounded border border-slate-600 px-6 py-3 font-medium hover:border-slate-400"
          >
            Багц руу буцах
          </Link>
        </>
      ) : status === "UNKNOWN" ? (
        <>
          <h1 className="text-3xl font-semibold">Хүсэлт олдсонгүй</h1>
          <p className="mt-4 text-slate-300">Холбоос дутуу байна.</p>
        </>
      ) : (
        <>
          <h1 className="text-3xl font-semibold">Төлбөрийг баталгаажуулж байна…</h1>
          <p className="mt-4 text-slate-300">
            Энэ хуудсыг хааж болно. Баталгаажмагц администраторын имэйл рүү мэдэгдэнэ.
          </p>
          {timedOut && (
            <p className="mt-6 rounded border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
              Баталгаажуулалт удаж байна. Төлбөр таны данснаас гарсан бол дэмжлэгт хандана уу —
              төлбөр бүртгэгдсэн бол ажлын талбар автоматаар нээгдэнэ.
            </p>
          )}
        </>
      )}
    </div>
  );
}
