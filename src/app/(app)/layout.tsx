"use client";

import Link from "next/link";
import { useProfile } from "@/lib/useProfile";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { loading, profile, userId } = useProfile();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !userId) {
      router.replace("/login?next=" + encodeURIComponent(pathname));
    }
  }, [loading, userId, router, pathname]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="container topbar">
          <strong className="brand">Reportz</strong>

          <nav className="nav-links">
            <Link className="nav-link" href="/reports">
              Reports
            </Link>
            <Link className="nav-link" href="/reports/new">
              New
            </Link>
          </nav>

          <div className="user-chip">
            {loading ? (
              "Loading..."
            ) : profile ? (
              <>
                {profile.full_name || "User"} | {profile.role} | tenant: {profile.tenant_id ? "set" : "NOT SET"}
              </>
            ) : (
              "Not signed in"
            )}
          </div>
        </div>
      </header>

      <main className="container page">{children}</main>
    </div>
  );
}
