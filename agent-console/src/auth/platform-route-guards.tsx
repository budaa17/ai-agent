import { Navigate, Outlet, useLocation } from "react-router-dom";
import type { PlatformPermission } from "../api/platform-schemas";
import { EmptyState, LoadingState } from "../components/ui";
import { usePlatformAuth } from "./platform-auth-provider";

export function RequirePlatformAuth() {
  const auth = usePlatformAuth();
  const location = useLocation();
  if (auth.loading) {
    return (
      <main className="center-screen">
        <LoadingState label="Platform session шалгаж байна…" />
      </main>
    );
  }
  if (auth.tokens === null || auth.session === null) {
    return (
      <Navigate
        to="/platform/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    );
  }
  return <Outlet />;
}

export function RequirePlatformPermission({ permission }: { permission: PlatformPermission }) {
  const auth = usePlatformAuth();
  if (auth.hasPlatformPermission(permission)) return <Outlet />;
  return (
    <EmptyState
      title="Энэ хэсгийг харах эрх алга"
      description="Таны platform role-д шаардлагатай permission оноогоогүй байна. Platform administrator-т хандана уу."
    />
  );
}
