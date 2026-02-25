import Link from "next/link";
import { getClientConfig } from "@/clients";
import { getClientSettings, mergeTerminology, t } from "@/lib/client-settings";

export default async function DashboardPage() {
  const config = getClientConfig();
  const settings = await getClientSettings();
  const terms = mergeTerminology(config.terminology, settings?.terminology);
  const clientName = settings?.client_name ?? config.name;

  return (
    <div className="grid" style={{ maxWidth: 960 }}>
      <div className="section-card">
        <h1>{t(terms, "dashboard", "Dashboard")}</h1>
        <p className="muted">
          {clientName} {t(terms, "shutdown", "Shutdown")} reporting portal.
        </p>
      </div>

      <div className="section-card">
        <h3>Quick Links</h3>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/reports">
            {t(terms, "reports", "Reports")}
          </Link>
          <Link className="btn btn-soft" href="/reports/new">
            New {t(terms, "report", "Report")}
          </Link>
        </div>
      </div>
    </div>
  );
}

