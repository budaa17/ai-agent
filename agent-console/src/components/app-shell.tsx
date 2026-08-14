import { useQuery } from "@tanstack/react-query";
import { CreditCard, FolderKanban, GitBranch, LogOut, Menu, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useMatch, useNavigate } from "react-router-dom";
import { buildWatchApi } from "../api/client";
import { useAuth } from "../auth/auth-provider";
import { useWorkspace } from "../hooks/use-workspace";
import { entityString } from "../lib/format";
import { navigationForRole, roleTitle, syncEntry } from "../lib/roles";
import { listOutboxEntries } from "../offline/database";
import { subscribeOutbox, syncOutbox } from "../offline/outbox";
import { useConnectivityState } from "../offline/use-connectivity";
import { Button, ConnectivityPill, LoadingState } from "./ui";

export function AppShell() {
  const projectId = useMatch("/projects/:projectId/*")?.params.projectId;
  const auth = useAuth();
  const navigate = useNavigate();
  const connectivity = useConnectivityState();
  const online = connectivity === "ONLINE";
  const [menuOpen, setMenuOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => buildWatchApi.projects(100),
    staleTime: 30_000,
  });
  const workspace = useWorkspace(projectId);
  const role = auth.session?.user.tenantRole;

  useEffect(() => {
    const refresh = () => {
      void listOutboxEntries().then((entries) => {
        setPendingCount(entries.filter((entry) => entry.status !== "SENT").length);
      });
    };
    refresh();
    return subscribeOutbox(refresh);
  }, []);

  const navigation = useMemo(() => {
    if (projectId === undefined) return [];
    const has = (permission: string) => auth.hasProjectPermission(projectId, permission);
    const entries = [...navigationForRole(role, has)];
    // The offline queue is noise on a good day and the first thing you need on
    // a bad one, so it appears only while something is actually waiting.
    const sync = pendingCount > 0 ? syncEntry(has) : null;
    if (sync !== null) entries.splice(1, 0, sync);
    return entries;
  }, [auth, projectId, role, pendingCount]);

  /** Reviews this user is actually allowed to decide, badged on the inbox. */
  const inboxCount = useMemo(() => {
    const membership = auth.session?.projectMemberships.find(
      (entry) => entry.projectId === projectId,
    );
    const effectiveRole = auth.hasTenantPermission("TENANT_ADMIN")
      ? role
      : (membership?.role ?? role);
    return (workspace.data?.workspace.reviews ?? []).filter(
      (task) =>
        entityString(task, "status") === "REVIEW_REQUIRED" &&
        entityString(task, "assignedRole") === effectiveRole,
    ).length;
  }, [auth, projectId, role, workspace.data]);

  const listedProject = projects.data?.data.find((project) => project.id === projectId);
  /**
   * The switcher only pages in the first hundred projects. A deep link to one
   * outside that page would otherwise show "BUILDWATCH" in the header, so fall
   * back to fetching that project on its own.
   */
  const fallbackProject = useQuery({
    queryKey: ["project", projectId],
    enabled: projectId !== undefined && !projects.isPending && listedProject === undefined,
    queryFn: () => buildWatchApi.project(projectId ?? ""),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const selectedProject = listedProject ?? fallbackProject.data;

  const logout = async () => {
    await auth.logout();
    navigate("/login", { replace: true });
  };

  const badgeFor = (path: string): number => {
    if (path === "inbox") return inboxCount;
    if (path === "sync") return pendingCount;
    return 0;
  };

  // SUPER_ADMIN was the pre-Control-Tower tenant role. Never render it as a
  // Company Admin workspace: require a separate platform sign-in instead.
  if (role === "SUPER_ADMIN") {
    return (
      <Navigate
        to="/platform/login"
        replace
        state={{ from: "/platform", email: auth.session?.user.email }}
      />
    );
  }

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`} aria-label="Үндсэн цэс">
        <div className="brand">
          <div className="brand-mark">BW</div>
          <div>
            <strong>BuildWatch</strong>
            <span>{roleTitle(role)}</span>
          </div>
          <button
            className="sidebar-close"
            type="button"
            aria-label="Цэс хаах"
            onClick={() => setMenuOpen(false)}
          >
            <X />
          </button>
        </div>
        <nav>
          <NavLink
            to="/projects"
            className={({ isActive }) =>
              `nav-item ${isActive && projectId === undefined ? "active" : ""}`
            }
          >
            <FolderKanban />
            <span>Төслүүд</span>
          </NavLink>
          {navigation.map((item) => {
            const Icon = item.icon;
            const destination = `/projects/${projectId}${item.path === "" ? "" : `/${item.path}`}`;
            const badge = badgeFor(item.path);
            return (
              <NavLink
                key={item.path}
                end={item.path === ""}
                to={destination}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
              >
                <Icon />
                <span>{item.label}</span>
                {badge > 0 ? <em className="nav-badge">{badge}</em> : null}
              </NavLink>
            );
          })}
          {auth.hasTenantPermission("TENANT_ADMIN") ? (
            <NavLink
              to="/admin"
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <Settings />
              <span>Удирдлага</span>
            </NavLink>
          ) : null}
          {auth.hasTenantPermission("TENANT_BILLING_READ") ? (
            <NavLink
              to="/admin/billing"
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <CreditCard />
              <span>Төлбөр</span>
            </NavLink>
          ) : null}
          {auth.hasTenantPermission("RULES_MANAGE") ? (
            <NavLink
              to="/admin/rules"
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <GitBranch />
              <span>Дүрэм</span>
            </NavLink>
          ) : null}
        </nav>
        <button className="sidebar-logout" type="button" onClick={() => void logout()}>
          <LogOut /> Гарах
        </button>
      </aside>
      {menuOpen ? (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="Цэс хаах"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <div className="main-column">
        <header className="topbar">
          <button
            className="menu-button"
            type="button"
            aria-label="Цэс нээх"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </button>
          <div className="project-context">
            <span>{selectedProject?.code ?? "BUILDWATCH"}</span>
            <strong>{selectedProject?.name ?? "Төслийн удирдлага"}</strong>
          </div>
          <div className="topbar-actions">
            <ConnectivityPill state={connectivity} />
            {pendingCount > 0 ? (
              <Button variant="secondary" onClick={() => void syncOutbox()} disabled={!online}>
                Sync {pendingCount}
              </Button>
            ) : null}
            {projects.isPending ? (
              <LoadingState label="" />
            ) : (
              <select
                className="project-switcher"
                aria-label="Идэвхтэй төсөл"
                value={projectId ?? ""}
                onChange={(event) =>
                  navigate(
                    event.target.value === "" ? "/projects" : `/projects/${event.target.value}`,
                  )
                }
              >
                <option value="">Төсөл сонгох</option>
                {projects.data?.data.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.code} · {project.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </header>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
