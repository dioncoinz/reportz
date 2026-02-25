import Link from "next/link";
import { getClientConfig } from "@/clients";
import { getClientSettings, mergeTerminology, t } from "@/lib/client-settings";

export default async function ExampleClientDashboardPage() {
  const config = getClientConfig();
  const settings = await getClientSettings();
  const terms = mergeTerminology(config.terminology, settings?.terminology);
  const clientName = settings?.client_name ?? config.name;

  return (
    <div className="grid" style={{ maxWidth: 960 }}>
      <div className="section-card" style={{ borderLeft: `6px solid ${config.primaryColor}` }}>
        <h1>{t(terms, "dashboard", "Dashboard")}</h1>
        <p className="muted">Welcome to the {clientName} custom home screen.</p>
      </div>

      <div className="section-card">
        <h3>{t(terms, "reports", "Reports")} Workflow</h3>
        <p className="muted">This block only renders for the example client override.</p>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <Link className="btn btn-primary" href="/reports/new">
            Start New {t(terms, "report", "Report")}
          </Link>
          <Link className="btn btn-soft" href="/reports">
            View All {t(terms, "reports", "Reports")}
          </Link>
        </div>
      </div>
    </div>
  );
}

