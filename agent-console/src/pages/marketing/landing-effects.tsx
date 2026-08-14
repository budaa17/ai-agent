import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";

interface RevealProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly delay?: number;
  readonly y?: number;
  readonly as?: "div" | "span";
}

type EffectStyle = CSSProperties & Record<`--${string}`, string | number>;

/** Reveals once, and stays visible when IntersectionObserver is unavailable. */
export function Reveal({ children, className = "", delay = 0, y = 24, as = "div" }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === "undefined");
  const Component = as;

  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting === true) {
          setVisible(true);
          observer.unobserve(node);
        }
      },
      { threshold: 0.12 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const style: EffectStyle = {
    "--bw-reveal-delay": `${delay}ms`,
    "--bw-reveal-y": `${y}px`,
  };

  return (
    <Component
      ref={ref as never}
      className={`bw-reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
      style={style}
    >
      {children}
    </Component>
  );
}

interface SpotlightCardProps {
  readonly children: ReactNode;
  readonly className?: string;
  readonly as?: "article" | "div" | "li";
}

export function SpotlightCard({ children, className = "", as = "article" }: SpotlightCardProps) {
  const ref = useRef<HTMLElement>(null);
  const Component = as;

  function handleMove(event: MouseEvent<HTMLElement>) {
    const node = ref.current;
    if (node === null) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty("--bw-spot-x", `${event.clientX - rect.left}px`);
    node.style.setProperty("--bw-spot-y", `${event.clientY - rect.top}px`);
  }

  return (
    <Component
      ref={ref as never}
      onMouseMove={handleMove}
      className={`bw-spotlight ${className}`.trim()}
    >
      {children}
    </Component>
  );
}

export function BorderBeam() {
  return <span aria-hidden="true" className="bw-border-beam" />;
}

interface ActionLinkProps {
  readonly children: ReactNode;
  readonly to: string;
  readonly variant?: "solid" | "ghost";
  readonly className?: string;
}

export function MagneticLink({ children, to, variant = "solid", className = "" }: ActionLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);

  function handleMove(event: MouseEvent<HTMLAnchorElement>) {
    const node = ref.current;
    if (node === null || window.matchMedia?.("(pointer: coarse)").matches === true) return;
    const rect = node.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    node.style.transform = `translate(${x * 0.1}px, ${y * 0.14}px)`;
  }

  function reset() {
    ref.current?.style.removeProperty("transform");
  }

  return (
    <Link
      ref={ref}
      to={to}
      onMouseMove={handleMove}
      onMouseLeave={reset}
      className={`bw-magnetic-link ${variant === "ghost" ? "is-ghost" : ""} ${className}`.trim()}
    >
      <span>{children}</span>
      <span aria-hidden="true">↗</span>
    </Link>
  );
}

export function CursorGlow() {
  useEffect(() => {
    if (
      window.matchMedia?.("(pointer: coarse)").matches === true ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    ) {
      return;
    }
    const root = document.documentElement;
    let frame = 0;

    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        root.style.setProperty("--bw-cursor-x", `${event.clientX}px`);
        root.style.setProperty("--bw-cursor-y", `${event.clientY}px`);
      });
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      root.style.removeProperty("--bw-cursor-x");
      root.style.removeProperty("--bw-cursor-y");
    };
  }, []);

  return <div aria-hidden="true" className="bw-cursor-glow" />;
}

const TOWERS = [
  { x: 48, y: 78, w: 72, h: 130, d: 24, delay: 0.1 },
  { x: 132, y: 44, w: 88, h: 182, d: 30, delay: 0.35 },
  { x: 232, y: 92, w: 62, h: 116, d: 22, delay: 0.5 },
  { x: 306, y: 56, w: 92, h: 172, d: 31, delay: 0.2 },
  { x: 410, y: 96, w: 64, h: 104, d: 20, delay: 0.7 },
] as const;

/** Decorative, explicitly illustrative model: it contains no live/customer metrics. */
export function ConstructionScene() {
  const gradientPrefix = useId().replaceAll(":", "");
  const frontId = `${gradientPrefix}-front`;
  const sideId = `${gradientPrefix}-side`;
  const hotId = `${gradientPrefix}-hot`;
  const glowId = `${gradientPrefix}-glow`;

  return (
    <figure className="bw-construction-scene">
      <figcaption className="sr-only">
        Зураг төслөөс инженерийн баталгаатай baseline бэлтгэх урсгалын жишээ дүрслэл
      </figcaption>
      <div aria-hidden="true" className="bw-scene-orbit orbit-one" />
      <div aria-hidden="true" className="bw-scene-orbit orbit-two" />
      <div aria-hidden="true" className="bw-scene-grid-floor" />
      <div aria-hidden="true" className="bw-scan-plane" />

      <svg className="bw-building-svg" viewBox="0 0 540 330" aria-hidden="true">
        <defs>
          <linearGradient id={frontId} x1="0" x2="1">
            <stop offset="0" stopColor="#555550" />
            <stop offset="1" stopColor="#2c2c2a" />
          </linearGradient>
          <linearGradient id={sideId} x1="0" x2="1">
            <stop offset="0" stopColor="#242421" />
            <stop offset="1" stopColor="#3c3b37" />
          </linearGradient>
          <linearGradient id={hotId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#d7983b" />
            <stop offset="1" stopColor="#ba7517" />
          </linearGradient>
          <filter id={glowId}>
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g transform="translate(0, 22)">
          {TOWERS.map((tower) => {
            const bottomY = tower.y + tower.h;
            const x2 = tower.x + tower.w;
            const dy = -tower.d * 0.46;
            const style: CSSProperties = { animationDelay: `${tower.delay}s` };
            return (
              <g key={`${tower.x}-${tower.y}`} className="bw-tower" style={style}>
                <polygon
                  points={`${tower.x},${tower.y} ${x2},${tower.y} ${x2 + tower.d},${tower.y + dy} ${tower.x + tower.d},${tower.y + dy}`}
                  fill="#7b776d"
                  stroke="#a9a59a"
                  strokeWidth="0.8"
                />
                <rect
                  x={tower.x}
                  y={tower.y}
                  width={tower.w}
                  height={tower.h}
                  fill={`url(#${frontId})`}
                  stroke="#817d73"
                  strokeWidth="0.8"
                />
                <polygon
                  points={`${x2},${tower.y} ${x2 + tower.d},${tower.y + dy} ${x2 + tower.d},${bottomY + dy} ${x2},${bottomY}`}
                  fill={`url(#${sideId})`}
                  stroke="#6e6a62"
                  strokeWidth="0.8"
                />
                {Array.from({ length: Math.max(3, Math.floor(tower.h / 26)) }, (_, floor) => {
                  const y = tower.y + 19 + floor * 25;
                  return (
                    <line
                      key={`floor-${floor}`}
                      x1={tower.x + 7}
                      y1={y}
                      x2={x2 - 7}
                      y2={y}
                      stroke="#8f8a80"
                      strokeWidth="0.8"
                    />
                  );
                })}
                {Array.from({ length: Math.max(2, Math.floor(tower.w / 24)) }, (_, column) => {
                  const x = tower.x + 14 + column * 23;
                  return (
                    <line
                      key={`column-${column}`}
                      x1={x}
                      y1={tower.y + 8}
                      x2={x}
                      y2={bottomY - 8}
                      stroke="#77736b"
                      strokeWidth="0.7"
                    />
                  );
                })}
              </g>
            );
          })}

          <g filter={`url(#${glowId})`}>
            <polygon points="222,224 316,224 338,214 244,214" fill={`url(#${hotId})`} />
            <text
              x="278"
              y="221"
              textAnchor="middle"
              fill="#17140e"
              fontSize="9"
              fontFamily="Arial, sans-serif"
              letterSpacing="2"
            >
              AI DRAFT
            </text>
          </g>
          <path
            d="M38 265 H490"
            stroke="#8e8a80"
            strokeWidth="1"
            strokeDasharray="3 8"
            opacity="0.7"
          />
          <path
            d="M80 286 H450"
            stroke="#b8b4a9"
            strokeWidth="1"
            strokeDasharray="2 7"
            opacity="0.6"
          />
          <circle cx="270" cy="250" r="3.5" fill="#ba7517" filter={`url(#${glowId})`} />
          <circle cx="270" cy="250" r="22" fill="none" stroke="#ba7517" strokeOpacity="0.35" />
          <circle cx="270" cy="250" r="43" fill="none" stroke="#0f6e56" strokeOpacity="0.18" />
        </g>
      </svg>

      <div className="bw-scene-label label-a">
        <span>ЭХ СУРВАЛЖ</span>
        <b>PDF · XLSX · SOURCE FILE</b>
      </div>
      <div className="bw-scene-label label-b">
        <span>AI ГАРАЛТ</span>
        <b>DRAFT</b>
      </div>
      <div className="bw-scene-label label-c">
        <span>БАТАЛГАА</span>
        <b>ENGINEER REVIEW</b>
      </div>
    </figure>
  );
}

const WORKFLOW_STEPS = [
  ["01", "ЗУРАГ", "PDF · XLSX · source"],
  ["02", "ТОО ХЭМЖЭЭ", "Draft extraction"],
  ["03", "НОРМ", "Material mapping"],
  ["04", "ТӨСӨВ", "Deterministic cost"],
  ["05", "ХУВААРЬ", "CPM · forecast"],
  ["06", "REVIEW", "Engineer approval"],
] as const;

export function WorkflowBeam() {
  return (
    <div className="bw-workflow-shell">
      <div aria-hidden="true" className="bw-workflow-line">
        <span />
      </div>
      <ol className="bw-workflow-grid">
        {WORKFLOW_STEPS.map(([number, title, detail]) => (
          <li className="bw-workflow-step" key={number}>
            <div className="bw-workflow-node">{number}</div>
            <div>
              <b>{title}</b>
              <small>{detail}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const PREVIEW_TABS = [
  { id: "evidence", label: "01 НОТОЛГОО" },
  { id: "control", label: "02 ХЯНАЛТ" },
  { id: "agents", label: "03 АГЕНТУУД" },
] as const;

type PreviewTab = (typeof PREVIEW_TABS)[number]["id"];

export function ProductConsole() {
  const [active, setActive] = useState<PreviewTab>("evidence");

  function handleKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!(["ArrowLeft", "ArrowRight", "Home", "End"] as string[]).includes(event.key)) return;
    event.preventDefault();
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? PREVIEW_TABS.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + PREVIEW_TABS.length) %
            PREVIEW_TABS.length;
    const next = PREVIEW_TABS[nextIndex];
    if (next === undefined) return;
    setActive(next.id);
    document.getElementById(`bw-preview-tab-${next.id}`)?.focus();
  }

  return (
    <div className="bw-console-wrap">
      <div className="bw-console-tabs" role="tablist" aria-label="BuildWatch системийн жишээ">
        {PREVIEW_TABS.map((tab, index) => (
          <button
            id={`bw-preview-tab-${tab.id}`}
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`bw-preview-panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            className={active === tab.id ? "active" : ""}
            onClick={() => setActive(tab.id)}
            onKeyDown={(event) => handleKeys(event, index)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bw-console-window">
        <div className="bw-console-topbar">
          <span>BUILDWATCH / PRODUCT FLOW</span>
          <span className="bw-demo-badge">ЖИШЭЭ ДҮРСЛЭЛ</span>
        </div>

        {active === "evidence" && (
          <div
            id="bw-preview-panel-evidence"
            role="tabpanel"
            aria-labelledby="bw-preview-tab-evidence"
            className="bw-console-panel bw-evidence-panel"
          >
            <p className="bw-panel-kicker">SOURCE → DRAFT → REVIEW</p>
            <div className="bw-evidence-flow">
              {[
                ["01", "Эх сурвалж", "Зураг, revision, тайлан"],
                ["02", "AI draft", "Таамаг биш, шалгах ноорог"],
                ["03", "Инженер", "Засах · буцаах · батлах"],
                ["04", "Audit", "Хэн, хэзээ, яагаад"],
              ].map(([number, title, detail]) => (
                <div key={number}>
                  <span>{number}</span>
                  <b>{title}</b>
                  <small>{detail}</small>
                </div>
              ))}
            </div>
            <div className="bw-ai-insight">
              <i aria-hidden="true" />
              <p>
                <b>Хяналтын зарчим</b>
                Өндөр нөлөөтэй AI гаралт инженерийн review хүртэл draft төлөвт үлдэнэ.
              </p>
            </div>
          </div>
        )}

        {active === "control" && (
          <div
            id="bw-preview-panel-control"
            role="tabpanel"
            aria-labelledby="bw-preview-tab-control"
            className="bw-console-panel bw-control-panel"
          >
            <div>
              <span>ТӨЛӨВЛӨГӨӨ</span>
              <b>Baseline</b>
              <small>Тоо хэмжээ · төсөв · CPM</small>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>ТАЛБАЙ</span>
              <b>Бодит нотолгоо</b>
              <small>Тайлан · зураг · материал</small>
            </div>
            <i aria-hidden="true">→</i>
            <div>
              <span>ШИЙДВЭР</span>
              <b>Эрсдэл ба санал</b>
              <small>Хүн баталгаажуулна</small>
            </div>
          </div>
        )}

        {active === "agents" && (
          <div
            id="bw-preview-panel-agents"
            role="tabpanel"
            aria-labelledby="bw-preview-tab-agents"
            className="bw-console-panel bw-agents-panel"
          >
            {[
              ["A0", "Зураг төсөл", "Quantity · WBS draft"],
              ["A1", "Өдрийн бүртгэл", "Field intake"],
              ["A2", "Баталгаажуулалт", "Evidence check"],
              ["A3–A5", "Тайлан · лавлагаа · урсгал", "Human-controlled"],
            ].map(([code, title, detail]) => (
              <div className="bw-agent-row" key={code}>
                <span>{code}</span>
                <div>
                  <b>{title}</b>
                  <small>{detail}</small>
                </div>
                <em>DRAFT FIRST</em>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
