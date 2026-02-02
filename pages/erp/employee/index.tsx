import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { fetchEmployeeSession, type EmployeeSessionContext } from "../../../lib/erp/employeeSession";

const cardStyle = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  background: "#fff",
  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
};

export default function EmployeeHomePage() {
  const router = useRouter();
  const [session, setSession] = useState<EmployeeSessionContext | null>(null);
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
      setSession(current);
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
        <Link href="/erp/employee/profile" style={{ ...cardStyle, textDecoration: "none", color: "#111827" }}>
          <div style={{ fontWeight: 700 }}>My Profile</div>
          <p style={{ marginTop: 8, color: "#6b7280" }}>
            View your personal and job details.
          </p>
        </Link>
        <Link href="/erp/employee/leaves" style={{ ...cardStyle, textDecoration: "none", color: "#111827" }}>
          <div style={{ fontWeight: 700 }}>Leave Requests</div>
          <p style={{ marginTop: 8, color: "#6b7280" }}>
            Submit and track leave applications.
          </p>
        </Link>
        <Link href="/erp/employee/attendance" style={{ ...cardStyle, textDecoration: "none", color: "#111827" }}>
          <div style={{ fontWeight: 700 }}>Attendance</div>
          <p style={{ marginTop: 8, color: "#6b7280" }}>
            Review your attendance history.
          </p>
        </Link>
        <Link href="/erp/employee/exit" style={{ ...cardStyle, textDecoration: "none", color: "#111827" }}>
          <div style={{ fontWeight: 700 }}>Exit / Resignation</div>
          <p style={{ marginTop: 8, color: "#6b7280" }}>
            Submit an exit request for HR approval.
          </p>
        </Link>
      </div>
    </div>
  );
}
