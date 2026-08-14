import { z } from "zod";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Building2, KeyRound, ShieldCheck, UserPlus } from "lucide-react";
import { useAuth } from "../auth/auth-provider";
import { buildWatchApi } from "../api/client";
import { completeCompanyAccountSetup } from "../api/public-billing";
import { friendlyError } from "../lib/api-error";
import { Button, Field, Input } from "../components/ui";

/**
 * The admin screen offers two copy buttons — the bare token and a full
 * `/register?token=…` link — so pasting the link into the token box is the
 * obvious mistake. Rather than reject it, pull the token back out.
 *
 * Tokens are base64url (letters, digits, `-`, `_`); a URL always carries `:`
 * or `/`, so the two can never be confused.
 */
function normaliseInvitationToken(input: string): string {
  const value = input.trim();
  if (!value.includes("/") && !value.includes(":")) return value;
  try {
    const fromQuery = new URL(value).searchParams.get("token");
    if (fromQuery !== null && fromQuery.trim() !== "") return fromQuery.trim();
  } catch {
    // Not a URL after all; fall through and let validation report it.
  }
  const tail = value.split("token=").pop();
  return tail === undefined ? value : decodeURIComponent(tail.split("&")[0] ?? "").trim();
}

const registerFormSchema = z
  .object({
    invitationToken: z
      .string()
      .transform(normaliseInvitationToken)
      .pipe(
        z
          .string()
          .min(32, "Invitation token дутуу байна — админаас ирсэн бүтэн токеныг буулгана уу"),
      ),
    displayName: z.string().trim().min(2, "Нэр 2-оос доошгүй тэмдэгт байна"),
    password: z.string().min(12, "Нууц үг 12-оос доошгүй тэмдэгт байна"),
    confirmPassword: z.string().min(12),
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Нууц үг таарахгүй байна",
    path: ["confirmPassword"],
  });

export function RegisterPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const setupToken = searchParams.get("setup");
  const setupTenantId = searchParams.get("tenant");
  const setupMode = setupToken !== null || setupTenantId !== null;
  const [invitationToken, setInvitationToken] = useState(searchParams.get("token") ?? "");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (auth.tokens !== null && auth.session !== null) return <Navigate to="/projects" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = registerFormSchema.safeParse({
      invitationToken,
      displayName,
      password,
      confirmPassword,
    });
    if (!setupMode && !parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Мэдээллээ шалгана уу");
      return;
    }
    if (password.length < 12 || password !== confirmPassword) {
      setError(
        password.length < 12 ? "Нууц үг 12-оос доошгүй тэмдэгт байна" : "Нууц үг таарахгүй байна",
      );
      return;
    }
    if (setupMode && (setupToken === null || setupTenantId === null)) {
      setError("Бүртгэл идэвхжүүлэх линк дутуу байна");
      return;
    }
    setSubmitting(true);
    try {
      if (setupMode && setupToken !== null && setupTenantId !== null) {
        const accepted = await completeCompanyAccountSetup({
          setupToken,
          tenantId: setupTenantId,
          password,
        });
        navigate("/login", {
          replace: true,
          state: {
            registered: true,
            tenantSlug: accepted.tenantSlug,
            email: accepted.email,
          },
        });
        return;
      }
      if (!parsed.success) return;
      const accepted = await buildWatchApi.acceptInvitation({
        invitationToken: parsed.data.invitationToken,
        displayName: parsed.data.displayName,
        password: parsed.data.password,
      });
      // The invitation token never revealed which tenant it belonged to, so
      // hand the slug and email to the login form rather than making the new
      // user find them out of band.
      navigate("/login", {
        replace: true,
        state: {
          registered: true,
          displayName: parsed.data.displayName,
          tenantSlug: accepted.tenantSlug,
          email: accepted.email,
        },
      });
    } catch (caught) {
      const friendly = friendlyError(caught);
      setError(`${friendly.title}. ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="brand brand-large">
          <div className="brand-mark">BW</div>
          <div>
            <strong>BuildWatch</strong>
            <span>Барилгын AI-agent SaaS</span>
          </div>
        </div>
        <h1>{setupMode ? "Компанийн бүртгэлээ идэвхжүүлэх." : "Урилгаар бүртгүүлэх."}</h1>
        <p>
          {setupMode
            ? "Төлбөр баталгаажсан. Нууц үгээ үүсгээд Company Admin эрхээр workspace-дээ нэвтэрнэ."
            : "Tenant админ таны имэйлээр урилга илгээсэн байх ёстой. Урилгын token, нэр, нууц үгээ оруулж бүртгэлээ идэвхжүүлнэ."}
        </p>
        <ul>
          <li>
            <Building2 /> Компанийн tenant-д нэгдэнэ
          </li>
          <li>
            <ShieldCheck /> RBAC эрх админаас оноогдсон
          </li>
          <li>
            <KeyRound /> Нууц үг доод тал нь 12 тэмдэгт
          </li>
        </ul>
      </section>
      <section className="login-panel">
        <div>
          <p className="eyebrow">{setupMode ? "PAID ACCOUNT SETUP" : "INVITATION REGISTER"}</p>
          <h2>{setupMode ? "Нууц үгээ үүсгэх" : "Бүртгүүлэх"}</h2>
          <p>
            {setupMode
              ? "Энэ нэг удаагийн холбоос 72 цаг хүчинтэй."
              : "Админаас ирсэн урилгын токен эсвэл бүтэн линкээ буулгана уу."}
          </p>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          {!setupMode ? (
            <>
              <Field
                label="Урилгын токен"
                hint="Токен эсвэл /register?token=… линк — аль нь ч болно"
              >
                <Input
                  value={invitationToken}
                  onChange={(event) => setInvitationToken(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              <Field label="Нэр">
                <Input
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  autoComplete="name"
                />
              </Field>
            </>
          ) : null}
          <Field label="Нууц үг" hint="Доод тал нь 12 тэмдэгт">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Нууц үг давтах">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
            />
          </Field>
          {error !== null ? (
            <div className="form-error" role="alert">
              {error}
            </div>
          ) : null}
          <Button type="submit" disabled={submitting}>
            <UserPlus />{" "}
            {submitting
              ? "Идэвхжүүлж байна…"
              : setupMode
                ? "Бүртгэл идэвхжүүлэх"
                : "Бүртгэл үүсгэх"}
          </Button>
        </form>
        <p className="login-help">
          Аль хэдийн бүртгэлтэй юу? <Link to="/login">Нэвтрэх</Link>
        </p>
      </section>
    </main>
  );
}
