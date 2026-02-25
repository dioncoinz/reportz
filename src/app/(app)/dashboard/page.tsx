import { resolveDashboardPage } from "@/features/dashboard/registry";

export default async function DashboardRoutePage() {
  const DashboardPage = resolveDashboardPage();
  return await DashboardPage();
}
