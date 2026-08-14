import { useEffect, useState } from "react";
import { NavLink, Outlet, Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { getTokens } from "../auth/token-store";

/**
 * Public shell for the marketing routes (landing-page-roadmap.md §11.2).
 *
 * It deliberately shares nothing with `AppShell`: no token refresh, no protected
 * prefetching, no workspace navigation. A visitor who has never signed in should
 * download the marketing page and nothing else.
 *
 * The palette is the console's own, so moving from the landing page into the
 * product does not feel like changing product (§15.1).
 */

const NAV = [
  { to: "/", label: "Нүүр", end: true },
  { to: "/features", label: "Боломжууд", end: false },
  { to: "/security", label: "Аюулгүй байдал", end: false },
  { to: "/contact", label: "Холбоо барих", end: false },
];

const NAV_LINK =
  "px-3 py-2 text-[0.7rem] font-semibold uppercase tracking-[0.12em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#BA7517]";

export function MarketingShell() {
  // Read once on render: this is a CTA hint, never an authorization decision.
  const signedIn = getTokens() !== null;
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  // Navigating with the menu open would otherwise leave it covering the page
  // the visitor just asked for.
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="marketing-frame flex min-h-screen flex-col bg-[#F1EFE8] text-[#2C2C2A]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-[#BA7517] focus:px-4 focus:py-2 focus:text-[#17140E]"
      >
        Үндсэн хэсэг рүү шилжих
      </a>
      <header className="sticky top-0 z-50 border-b border-white/10 bg-[#2C2C2A]/95 text-[#F1EFE8] backdrop-blur-xl">
        <div className="mx-auto flex min-h-[4.5rem] max-w-[1440px] items-center gap-4 px-5 sm:px-[clamp(1.25rem,5vw,4.875rem)]">
          <Link
            to="/"
            className="flex items-center gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#BA7517]"
            aria-label="BuildWatch нүүр хуудас"
          >
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center border border-[#BA7517] bg-[#BA7517] text-xs font-black text-[#17140E]"
            >
              BW
            </span>
            <span className="grid gap-0.5">
              <strong className="text-xs tracking-[0.16em] text-[#F1EFE8]">BUILDWATCH</strong>
              <small className="text-[0.5rem] font-semibold tracking-[0.18em] text-[#B9B6AD]">
                CONSTRUCTION AI
              </small>
            </span>
          </Link>

          <nav aria-label="Үндсэн цэс" className="ml-auto hidden gap-1 text-sm md:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `${NAV_LINK} ${isActive ? "text-[#E1A34A]" : "text-[#C8C4BA] hover:text-[#F1EFE8]"}`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-2 md:ml-0 md:flex">
            <Link
              to={signedIn ? "/projects" : "/login"}
              className={`${NAV_LINK} text-[#C8C4BA] hover:text-[#F1EFE8]`}
            >
              {signedIn ? "Ажлын талбар" : "Нэвтрэх"}
            </Link>
            <Link
              to="/pricing"
              className="border border-[#BA7517] bg-[#BA7517] px-4 py-2 text-[0.7rem] font-bold uppercase tracking-[0.1em] text-[#17140E] transition-colors hover:bg-[#CF8A28] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#E1A34A]"
            >
              Багц сонгох
            </Link>
          </div>

          <button
            type="button"
            aria-expanded={menuOpen}
            aria-controls="marketing-menu"
            aria-label={menuOpen ? "Цэс хаах" : "Цэс нээх"}
            onClick={() => setMenuOpen((open) => !open)}
            className="ml-auto min-h-11 min-w-11 p-2 text-[#D3D1C7] hover:text-[#F1EFE8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#BA7517] md:hidden"
          >
            {menuOpen ? (
              <X aria-hidden className="h-6 w-6" />
            ) : (
              <Menu aria-hidden className="h-6 w-6" />
            )}
          </button>
        </div>

        {menuOpen && (
          <nav
            id="marketing-menu"
            aria-label="Гар утасны цэс"
            className="border-t border-white/10 bg-[#2C2C2A] px-5 pb-5 md:hidden"
          >
            <ul className="flex flex-col gap-1 pt-2 text-sm">
              {NAV.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `block ${NAV_LINK} ${isActive ? "text-[#E1A34A]" : "text-[#D3D1C7]"}`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
              <li>
                <Link
                  to={signedIn ? "/projects" : "/login"}
                  className={`block ${NAV_LINK} text-[#D3D1C7]`}
                >
                  {signedIn ? "Ажлын талбар" : "Нэвтрэх"}
                </Link>
              </li>
              <li className="pt-2">
                <Link
                  to="/pricing"
                  className="block border border-[#BA7517] bg-[#BA7517] px-4 py-3 text-center text-xs font-bold uppercase tracking-[0.1em] text-[#17140E]"
                >
                  Багц сонгох
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-white/10 bg-[#2C2C2A] text-[#F1EFE8]">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-5 px-5 py-9 text-xs text-[#AAA69D] sm:flex-row sm:items-center sm:justify-between sm:px-[clamp(1.25rem,5vw,4.875rem)]">
          <p className="uppercase tracking-[0.1em]">
            © {new Date().getFullYear()} BuildWatch · AI ноорог бэлдэнэ, инженер батална
          </p>
          <nav aria-label="Хууль эрх зүй" className="flex flex-wrap gap-4">
            <Link to="/terms" className="hover:text-[#E1A34A]">
              Үйлчилгээний нөхцөл
            </Link>
            <Link to="/privacy" className="hover:text-[#E1A34A]">
              Нууцлалын бодлого
            </Link>
            <Link to="/security" className="hover:text-[#E1A34A]">
              Аюулгүй байдал
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
