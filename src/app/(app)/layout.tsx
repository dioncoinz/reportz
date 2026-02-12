"use client";

import Link from "next/link";
import { useProfile } from "@/lib/useProfile";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { loading, profile, userId } = useProfile();
  const router = useRouter();
  const pathname = usePathname();

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !userId) {
      router.replace("/login?next=" + encodeURIComponent(pathname));
    }
  }, [loading, userId, router, pathname]);

  return (
    <div style={{ minHeight: "100vh" }}>
      <header style={{ padding: 16, borderBottom: "1px solid #222" }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <strong>Reportz</strong>
          <nav style={{ display: "flex", gap: 12 }}>
            <Link href="/reports">Reports</Link>
            <Link href="/reports/new">New</Link>
          </nav>

          <div style={{ marginLeft: "auto", opacity: 0.8, fontSize: 12 }}>
            {loading ? (
              "Loading..."
            ) : profile ? (
              <>
                {profile.full_name || "User"} • {profile.role} •{" "}
                tenant: {profile.tenant_id ? "set" : "NOT SET"}
              </>
            ) : (
              "Not signed in"
            )}
          </div>
        </div>
      </header>

      <main style={{ padding: 16 }}>{children}</main>
    </div>
  );
}
