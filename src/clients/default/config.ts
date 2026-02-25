import type { ClientConfig } from "@/clients/types";

export const defaultClientConfig: ClientConfig = {
  slug: "default",
  name: "Reportz",
  logo: "/logo.svg",
  primaryColor: "#C7662D",
  terminology: {
    report: "Report",
    reports: "Reports",
    workOrder: "Work Order",
    workOrders: "Work Orders",
    dashboard: "Dashboard",
    shutdown: "Shutdown",
  },
  routeOverrides: {
    dashboard: false,
  },
};

