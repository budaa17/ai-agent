import { LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { usePlatformAuth } from "../auth/platform-auth-provider";
import { Badge } from "../components/ui";
import { platformNavigation, platformRoleLabel } from "./platform-navigation";

export function PlatformShell() {
  const auth = usePlatformAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const principal = auth.session?.principal;

  const logout = async () => {
    await auth.logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="app-frame platform-frame">
      <aside
        className={`sidebar platform-sidebar ${menuOpen ? "is-open" : ""}`}
        aria-label="Platform үндсэн цэс"
      >
        <div className="brand">
          <div className="brand-mark">BW</div>
          <div>
            <strong>BuildWatch</strong>
            <span>Platform operations</span>
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

        <nav aria-label="Platform navigation">
          {platformNavigation.map((section) => {
            const visibleItems = section.items.filter((item) =>
              auth.hasPlatformPermission(item.permission),
            );
            if (visibleItems.length === 0) return null;
            return (
              <section className="platform-nav-section" key={section.label}>
                <h2>{section.label}</h2>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.end}
                      onClick={() => setMenuOpen(false)}
                      className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                    >
                      <Icon />
                      <span>{item.label}</span>
                    </NavLink>
                  );
                })}
              </section>
            );
          })}
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
        <header className="topbar platform-topbar">
          <button
            className="menu-button"
            type="button"
            aria-label="Цэс нээх"
            onClick={() => setMenuOpen(true)}
          >
            <Menu />
          </button>
          <div className="platform-context">
            <span>PLATFORM</span>
            <strong>AI Operations Control Tower</strong>
          </div>
          <div className="topbar-actions">
            <Badge tone="purple">
              <ShieldCheck /> {platformRoleLabel(principal?.role)}
            </Badge>
          </div>
        </header>
        <main className="page platform-page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
