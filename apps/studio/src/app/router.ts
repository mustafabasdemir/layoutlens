import { useEffect, useState } from "react";

export const ROUTES = ["overview", "scan", "history", "reports", "visual", "settings"] as const;
export type RouteId = (typeof ROUTES)[number];

export const ROUTE_TITLES: Record<RouteId, string> = {
  overview: "Overview",
  scan: "New Scan",
  history: "Scan History",
  reports: "Reports",
  visual: "Visual Regression",
  settings: "Settings",
};

export function parseRoute(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, "").split(/[/?]/)[0] ?? "";
  return (ROUTES as readonly string[]).includes(id) ? (id as RouteId) : "overview";
}

export function hrefFor(route: RouteId): string {
  return `#/${route}`;
}

export function navigate(route: RouteId): void {
  window.location.hash = `/${route}`;
}

export function useRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}
