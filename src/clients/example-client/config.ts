import type { ClientConfig } from "@/clients/types";

export const exampleClientConfig: ClientConfig = {
  slug: "example-client",
  name: "Example Client",
  logo: "/clients/example-client/logo.svg",
  primaryColor: "#1E5A96",
  terminology: {
    report: "Completion Report",
    reports: "Completion Reports",
    workOrder: "Task",
    workOrders: "Tasks",
    dashboard: "Operations Dashboard",
    shutdown: "Outage",
  },
  routeOverrides: {
    dashboard: true,
  },
};

