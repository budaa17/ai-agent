import { z } from "zod";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, KeyRound, ShieldCheck } from "lucide-react";
import { useAuth } from "../auth/auth-provider";
import { usePlatformAuth } from "../auth/platform-auth-provider";
import { buildWatchApi } from "../api/client";
import type { TenantChoice } from "../api/schemas";
import { Button, Field, Input } from "../components/ui";

const loginFormSchema = z.object({
  email: z.string().trim().email("Имэйл буруу байна"),
  password: z.string().min(12, "Нууц үг 12-оос доошгүй тэмдэгт байна"),
});

const LAST_ORGANIZATION_KEY = "buildwatch.lastOrganization.v1";

function readLastOrganization(): string | null {
  try {
    return window.localStorage.getItem(LAST_ORGANIZATION_KEY);
  } catch {
    return null;
  }
}

function rememberOrganization(tenantSlug: string): void {
  try {
    window.localStorage.setItem(LAST_ORGANIZATION_KEY, tenantSlug);
  } catch {
    // A blocked storage quota must never stop somebody signing in.
  }
}

export function LoginPage() {
  const auth = useAuth();
  const platformAuth = usePlatformAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const handoff = location.state as {
    registered?: boolean;
    displayName?: string;
    email?: string;
    from?: string;
    audience?: "PLATFORM";
  } | null;
  const platformHandoff = handoff?.audience === "PLATFORM";
  const [email, setEmail] = useState(handoff?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set only after the password already matched in more than one organization.
  const [choice, setChoice] = useState<{ selectionToken: string; tenants: TenantChoice[] } | null>(
    null,
  );
  if (platformAuth.tokens !== null && platformAuth.session !== null) {
    return <Navigate to="/platform" replace />;
  }
  if (!platformHandoff && auth.tokens !== null && auth.session !== null) {
    return <Navigate to="/projects" replace />;
  }

  const destination = handoff?.from ?? "/projects";
  const platformDestination =
    destination.startsWith("/platform") && !destination.startsWith("/platform/login")
      ? destination
      : "/platform";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const parsed = loginFormSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Мэдээллээ шалгана уу");
      return;
    }
    setSubmitting(true);
    try {
      if (platformHandoff) {
        if (auth.tokens !== null) await auth.logout();
        await platformAuth.login(parsed.data);
        navigate(platformDestination, { replace: true });
        return;
      }

      let result: Awaited<ReturnType<typeof auth.login>>;
      try {
        result = await auth.login({ ...parsed.data, deviceName: "BuildWatch Web PWA" });
      } catch (tenantError) {
        // One public sign-in surface, two isolated identity realms. A platform-
        // only principal reaches this fallback only after tenant auth rejected
        // the same credentials; successful platform auth still issues only a
        // platform-audience token.
        try {
          await platformAuth.login(parsed.data);
          navigate("/platform", { replace: true });
          return;
        } catch {
          throw tenantError;
        }
      }
      if (result.status === "AUTHENTICATED") {
        const tenantSession = await buildWatchApi.session();
        if (tenantSession.user.tenantRole === "SUPER_ADMIN") {
          try {
            // A tenant SUPER_ADMIN token is never promoted. The same credentials
            // must independently authenticate against the platform realm before
            // the user reaches Control Tower.
            await auth.logout();
            await platformAuth.login(parsed.data);
            navigate(platformDestination, { replace: true });
          } catch {
            setError(
              "Platform Super Admin бүртгэл тохируулагдаагүй байна. Platform эрхээ шалгуулна уу.",
            );
          }
          return;
        }
        navigate(destination, { replace: true });
        return;
      }
      // Same person, several organizations. If they picked one before and it is
      // still among the ones this password unlocked, go straight there.
      const remembered = readLastOrganization();
      const match = result.tenants.find((tenant) => tenant.tenantSlug === remembered);
      if (match !== undefined) {
        await auth.completeTenantSelection({
          selectionToken: result.selectionToken,
          tenantSlug: match.tenantSlug,
          deviceName: "BuildWatch Web PWA",
        });
        navigate(destination, { replace: true });
        return;
      }
      setChoice({ selectionToken: result.selectionToken, tenants: result.tenants });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const chooseOrganization = async (tenantSlug: string) => {
    if (choice === null) return;
    setError(null);
    setSubmitting(true);
    try {
      await auth.completeTenantSelection({
        selectionToken: choice.selectionToken,
        tenantSlug,
        deviceName: "BuildWatch Web PWA",
      });
      rememberOrganization(tenantSlug);
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
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
        <h1>Төлөвлөгөө, талбай, нотолгоог нэг үнэн дээр.</h1>
        <p>
          A0–A5 агент, хүнээр батлуулах урсгал, offline өдрийн тайлан болон байгууллага бүрийн
          тусгаарлалттай production workspace.
        </p>
        <ul>
          <li>
            <Building2 /> Суурь тооцоо ба барилгын явц
          </li>
          <li>
            <ShieldCheck /> RBAC, audit, human approval
          </li>
          <li>
            <KeyRound /> JWT access + refresh rotation
          </li>
        </ul>
      </section>
      <section className="login-panel">
        <Link className="login-home-link" to="/">
          <ArrowLeft aria-hidden="true" />
          Нүүр хуудас руу буцах
        </Link>
        {choice === null ? (
          <>
            <div>
              <p className="eyebrow">SECURE ACCESS</p>
              <h2>Нэвтрэх</h2>
              <p>
                Имэйл, нууц үгээрээ нэвтэрнэ үү. Таны эрхээс хамаарч зөв ажлын талбар автоматаар
                нээгдэнэ.
              </p>
            </div>
            <form onSubmit={(event) => void submit(event)}>
              <Field label="Имэйл">
                <Input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="username"
                />
              </Field>
              <Field label="Нууц үг" hint="Доод тал нь 12 тэмдэгт">
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </Field>
              {handoff?.registered === true ? (
                <div className="form-success" role="status">
                  {handoff.displayName !== undefined && handoff.displayName.length > 0
                    ? `${handoff.displayName}, бүртгэл амжилттай. Одоо нэвтэрнэ үү.`
                    : "Бүртгэл амжилттай. Одоо нэвтэрнэ үү."}
                </div>
              ) : null}
              {error !== null ? (
                <div className="form-error" role="alert">
                  {error}
                </div>
              ) : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Шалгаж байна…" : "BuildWatch-д нэвтрэх"}
              </Button>
            </form>
            <p className="login-help">
              Урилга авсан уу? <Link to="/register">Бүртгүүлэх</Link>
            </p>
          </>
        ) : (
          <>
            <div>
              <p className="eyebrow">ORGANIZATION</p>
              <h2>Та аль байгууллагаар нэвтрэх вэ?</h2>
              <p>Таны бүртгэл дараах байгууллагуудад байна.</p>
            </div>
            <div className="stack" role="group" aria-label="Байгууллага сонгох">
              {choice.tenants.map((tenant) => (
                <Button
                  key={tenant.tenantSlug}
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => void chooseOrganization(tenant.tenantSlug)}
                >
                  <Building2 /> {tenant.tenantName}
                </Button>
              ))}
            </div>
            {error !== null ? (
              <div className="form-error" role="alert">
                {error}
              </div>
            ) : null}
            <p className="login-help">
              <Button
                variant="ghost"
                onClick={() => {
                  setChoice(null);
                  setPassword("");
                  setError(null);
                }}
              >
                <ArrowLeft /> Буцах
              </Button>
            </p>
          </>
        )}
      </section>
    </main>
  );
}
