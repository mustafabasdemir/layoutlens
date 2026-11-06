import { isSiteScanEnvelope } from "../data/load-report";
import { useReports } from "../data/report-store";
import { HistoryPage } from "../features/history/HistoryPage";
import { OverviewPage } from "../features/overview/OverviewPage";
import { ReportPicker } from "../features/reports/ReportPicker";
import { ReportsPage } from "../features/reports/ReportsPage";
import { NewScanPage } from "../features/scan/NewScanPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { VisualRegressionPage } from "../features/visual/VisualRegressionPage";
import { displayUrl } from "../lib/format";
import { AppShell, type Crumb } from "../shell/AppShell";
import { hrefFor, ROUTE_TITLES, useRoute, type RouteId } from "./router";

function Page({ route }: { route: RouteId }) {
  switch (route) {
    case "overview":
      return <OverviewPage />;
    case "scan":
      return <NewScanPage />;
    case "history":
      return <HistoryPage />;
    case "reports":
      return <ReportsPage />;
    case "visual":
      return <VisualRegressionPage />;
    case "settings":
      return <SettingsPage />;
  }
}

export function App() {
  const route = useRoute();
  const { active } = useReports();
  const crumbs: Crumb[] = [{ label: "Studio", href: hrefFor("overview") }];
  if (route !== "overview") crumbs.push({ label: ROUTE_TITLES[route], href: hrefFor(route) });
  if ((route === "reports" || route === "visual") && active) {
    const url = isSiteScanEnvelope(active.report) ? active.report.rootUrl : active.report.url;
    const { host } = displayUrl(url);
    crumbs.push({ label: host });
  }
  const actions = route === "reports" || route === "visual" ? <ReportPicker compact goToReports={false} /> : null;

  return (
    <AppShell route={route} crumbs={crumbs} actions={route === "reports" ? null : actions}>
      <Page route={route} />
    </AppShell>
  );
}
