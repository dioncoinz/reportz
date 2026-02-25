import { getClientConfig } from "@/clients";
import type { RouteOverrideKey } from "@/clients/types";
import DefaultDashboardPage from "@/features/dashboard/DashboardPage";
import ExampleClientDashboardPage from "@/clients/example-client/overrides/dashboard/DashboardPage";

type DashboardComponent = () => Promise<React.JSX.Element> | React.JSX.Element;

const dashboardOverrideRegistry: Record<string, DashboardComponent> = {
  "example-client": ExampleClientDashboardPage,
};

export function resolveDashboardPage() {
  const config = getClientConfig();
  const key: RouteOverrideKey = "dashboard";

  if (config.routeOverrides?.[key]) {
    return dashboardOverrideRegistry[config.slug] ?? DefaultDashboardPage;
  }

  return DefaultDashboardPage;
}

