import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { fetchEmployeeModules, type EmployeeModule } from "../../../lib/erp/employeeAccess";
import { fetchEmployeeSession, type EmployeeSessionContext } from "../../../lib/erp/employeeSession";

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

type EmployeeNavItem = {
  id: string;
  label: string;
  href: string;
  description: string;
  moduleTitle: string;
};

export default function EmployeeHomePage() {
  const router = useRouter();
  const [session, setSession] = useState<EmployeeSessionContext | null>(null);
  const [modules, setModules] = useState<EmployeeModule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const current = await fetchEmployeeSession();
      if (!active) return;
      if (!current) {
        router.replace("/erp/employee/login");
        return;
      }
      if (current.mustResetPassword) {
        router.replace("/erp/employee/change-password");
        return;
      }
      setSession(current);
      const access = await fetchEmployeeModules();
      if (active) {
        setModules(access?.modules ?? []);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function handleLogout() {
    await fetch("/api/erp/employee/auth/logout", { method: "POST" });
    router.replace("/erp/employee/login");
  }

  const navItems = useMemo<EmployeeNavItem[]>(() => {
    return modules.flatMap((moduleItem) =>
      moduleItem.links.map((link) => ({
        id: link.id,
        label: link.title,
        href: link.href,
        description: link.description,
        moduleTitle: moduleItem.title,
      }))
    );
  }, [modules]);

  if (loading) {
    return <div style={{ padding: 24 }}>Loading employee portal…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, color: "#6b7280" }}>Employee Portal</div>
          <h1 style={{ margin: "6px 0", fontSize: 28 }}>Welcome back</h1>
          <div style={{ color: "#4b5563" }}>
            {session?.displayName} · {session?.employeeCode}
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          style={{
            border: "1px solid #d1d5db",
            background: "#fff",
            borderRadius: 10,
            padding: "10px 14px",
            fontWeight: 600,
            cursor: "pointer",
            height: 44,
          }}
        >
          Sign Out
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {navItems.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            style={{ ...cardStyle, textDecoration: "none", color: "#111827" }}
          >
            <div style={{ fontWeight: 700 }}>{item.label}</div>
            <p style={{ marginTop: 8, color: "#6b7280" }}>{item.description}</p>
            <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>{item.moduleTitle}</div>
          </Link>
        ))}
        {navItems.length === 0 ? (
          <div style={{ ...cardStyle, color: "#6b7280" }}>
            No self-service modules are available for your role yet.
          </div>
        ) : null}
      </div>
    </div>
  );
}
