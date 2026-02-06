import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { fetchEmployeeSession, type EmployeeSessionContext } from "../../../lib/erp/employeeSession";

type EmployeeProfile = {
  id: string;
  employee_code: string;
  full_name: string | null;
  department: string | null;
  designation: string | null;
  joining_date: string | null;
  employment_status: string | null;
  phone: string | null;
  email: string | null;
};

export default function EmployeeProfilePage() {
  const router = useRouter();
  const [session, setSession] = useState<EmployeeSessionContext | null>(null);
  const [profile, setProfile] = useState<EmployeeProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

      const res = await fetch("/api/hr/employee/profile");
      if (!res.ok) {
        setError("Unable to load profile.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setProfile(data.profile);
      } else {
        setError(data.error || "Unable to load profile.");
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function handleLogout() {
    await fetch("/api/hr/employee/auth/logout", { method: "POST" });
    router.replace("/erp/employee/login");
  }

  if (loading) {
    return <div style={{ padding: 24 }}>Loading profile…</div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, letterSpacing: 1, color: "#6b7280" }}>Employee Portal</div>
          <h1 style={{ margin: "6px 0", fontSize: 28 }}>My Profile</h1>
          <div style={{ color: "#4b5563" }}>
            {session?.displayName} · {session?.employeeCode}
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Link href="/erp/employee" style={{ alignSelf: "center" }}>
            ← Back
          </Link>
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
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {error ? (
        <div style={{ color: "#b91c1c", marginBottom: 16 }}>{error}</div>
      ) : null}

      {profile ? (
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Profile Details</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <strong>Full name:</strong> {profile.full_name || "—"}
            </div>
            <div>
              <strong>Employee code:</strong> {profile.employee_code}
            </div>
            <div>
              <strong>Department:</strong> {profile.department || "—"}
            </div>
            <div>
              <strong>Designation:</strong> {profile.designation || "—"}
            </div>
            <div>
              <strong>Joining date:</strong> {profile.joining_date || "—"}
            </div>
            <div>
              <strong>Status:</strong> {profile.employment_status || "—"}
            </div>
            <div>
              <strong>Phone:</strong> {profile.phone || "—"}
            </div>
            <div>
              <strong>Email:</strong> {profile.email || "—"}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
