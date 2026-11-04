import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  FileText,
  History,
  Layers,
  LayoutDashboard,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  Settings,
  Sun,
  X,
} from "lucide-react";
import { hrefFor, ROUTE_TITLES, type RouteId } from "../app/router";
import { useTheme } from "../app/theme";
import { useMediaQuery } from "../ui/hooks";
import { IconButton } from "../ui/primitives";

const NAV: { id: RouteId; icon: typeof LayoutDashboard }[] = [
  { id: "overview", icon: LayoutDashboard },
  { id: "scan", icon: ScanLine },
  { id: "history", icon: History },
  { id: "reports", icon: FileText },
  { id: "visual", icon: Layers },
  { id: "settings", icon: Settings },
];

export const SIDEBAR_COLLAPSED_KEY = "layoutlens.studio.sidebarCollapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

export interface Crumb {
  label: string;
  href?: string;
}

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <a className="brand" href={hrefFor("overview")} aria-label="LayoutLens Studio home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <path d="M3 9h18M9 9v12" />
        </svg>
      </span>
      {!collapsed ? (
        <span className="brand-text">
          LayoutLens <span className="brand-sub">Studio</span>
        </span>
      ) : null}
    </a>
  );
}

function NavList({
  route,
  collapsed,
  onNavigate,
}: {
  route: RouteId;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary">
      <ul className="nav-list">
        {NAV.map(({ id, icon: Icon }) => (
          <li key={id}>
            <a
              href={hrefFor(id)}
              className="nav-item"
              data-nav={id}
              aria-current={route === id ? "page" : undefined}
              title={collapsed ? ROUTE_TITLES[id] : undefined}
              aria-label={collapsed ? ROUTE_TITLES[id] : undefined}
              onClick={onNavigate}
            >
              <Icon size={17} aria-hidden="true" className="nav-icon" />
              {!collapsed ? <span className="nav-label">{ROUTE_TITLES[id]}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AppShell({
  route,
  crumbs,
  actions,
  children,
}: {
  route: RouteId;
  crumbs: Crumb[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { theme, toggleTheme } = useTheme();
  const isMobile = useMediaQuery("(max-width: 899px)");
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [route]);

  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    drawer?.querySelector<HTMLElement>(".nav-item")?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        menuButtonRef.current?.focus();
      }
      if (e.key === "Tab" && drawer) {
        const focusables = [...drawer.querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last?.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first?.focus();
          e.preventDefault();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const sidebarCollapsed = !isMobile && collapsed;

  return (
    <div className={`app${sidebarCollapsed ? " is-collapsed" : ""}`}>
      <a className="skip-link" href="#main">Skip to content</a>

      {!isMobile ? (
        <aside className="sidebar" aria-label="Sidebar">
          <div className="sidebar-top">
            <Brand collapsed={sidebarCollapsed} />
          </div>
          <NavList route={route} collapsed={sidebarCollapsed} />
          <div className="sidebar-bottom">
            {!sidebarCollapsed ? (
              <p className="sidebar-note">Local-first · no telemetry</p>
            ) : null}
            <IconButton
              label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => setCollapsed((c) => !c)}
              className="collapse-btn"
            >
              {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </IconButton>
          </div>
        </aside>
      ) : null}

      {isMobile && drawerOpen ? (
        <div className="drawer-layer">
          <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div
            ref={drawerRef}
            className="drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="sidebar-top">
              <Brand collapsed={false} />
              <IconButton
                label="Close navigation"
                onClick={() => {
                  setDrawerOpen(false);
                  menuButtonRef.current?.focus();
                }}
              >
                <X size={16} />
              </IconButton>
            </div>
            <NavList route={route} collapsed={false} onNavigate={() => setDrawerOpen(false)} />
            <p className="sidebar-note drawer-note">Local-first · no telemetry</p>
          </div>
        </div>
      ) : null}

      <div className="main-col">
        <header className="topbar">
          <div className="topbar-left">
            {isMobile ? (
              <IconButton
                ref={menuButtonRef}
                label="Open navigation"
                aria-expanded={drawerOpen}
                onClick={() => setDrawerOpen(true)}
              >
                <Menu size={17} />
              </IconButton>
            ) : null}
            <div className="topbar-titles">
              {crumbs.length > 1 ? (
                <nav aria-label="Breadcrumb" className="crumbs">
                  <ol>
                    {crumbs.map((c, i) => (
                      <li key={`${c.label}-${i}`}>
                        {c.href && i < crumbs.length - 1 ? <a href={c.href}>{c.label}</a> : <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>}
                      </li>
                    ))}
                  </ol>
                </nav>
              ) : null}
              <h1 className="page-title">{ROUTE_TITLES[route]}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            {actions}
            <IconButton
              label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggleTheme}
              data-testid="theme-toggle"
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </IconButton>
          </div>
        </header>
        <main id="main" ref={mainRef} tabIndex={-1} className="main">
          {children}
        </main>
      </div>
    </div>
  );
}
