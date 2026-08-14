import { Navigate, useLocation } from "react-router-dom";

function safeDestination(candidate: unknown): string {
  return typeof candidate === "string" &&
    candidate.startsWith("/platform") &&
    !candidate.startsWith("/platform/login")
    ? candidate
    : "/platform";
}

export function PlatformLoginPage() {
  const location = useLocation();
  const handoff = location.state as { from?: unknown; email?: unknown } | null;
  return (
    <Navigate
      to="/login"
      replace
      state={{
        audience: "PLATFORM",
        from: safeDestination(handoff?.from),
        ...(typeof handoff?.email === "string" ? { email: handoff.email } : {}),
      }}
    />
  );
}
