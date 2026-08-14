import { Navigate, Outlet, useLocation, useMatch } from "react-router-dom";
import { LoadingState } from "../components/ui";
import { useAuth } from "./auth-provider";

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  if (auth.loading)
    return (
      <main className="center-screen">
        <LoadingState label="Session шалгаж байна…" />
      </main>
    );
  if (auth.tokens === null || auth.session === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

export function RequirePermission({ permission }: { permission: string }) {
  const projectId = useMatch("/projects/:projectId/*")?.params.projectId;
  const auth = useAuth();
  const allowed =
    projectId === undefined
      ? auth.hasTenantPermission(permission)
      : auth.hasProjectPermission(projectId, permission);
  return allowed ? (
    <Outlet />
  ) : (
    <Navigate to={projectId === undefined ? "/projects" : `/projects/${projectId}`} replace />
  );
}
