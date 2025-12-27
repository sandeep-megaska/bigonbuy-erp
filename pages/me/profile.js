import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabaseClient";
import { requireAuthRedirectHome } from "../../lib/erpContext";

export default function EmployeeProfilePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      await loadEmployeeContext(session, active);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadEmployee(companyId, employeeId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, employee_no, full_name, work_email, phone, joining_date, status, department, designation")
      .eq("company_id", companyId)
      .eq("id", employeeId)
      .maybeSingle();
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (!data && isActive) {
      setErr("Employee record not found.");
      return;
    }
    if (isActive) setEmployee(data);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  async function loadEmployeeContext(session, isActive = true) {
    setErr("");
    const { data: mapping, error: mapErr } = await supabase
      .from("erp_employee_users")
      .select("company_id, employee_id, is_active")
      .eq("user_id", session.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (mapErr) {
      if (isActive) {
        setErr(mapErr.message);
        setLoading(false);
      }
      return;
    }

    if (!mapping?.employee_id || !mapping?.company_id) {
      if (isActive) {
        setErr("Your account is not linked to an employee record. Contact HR.");
        setLoading(false);
      }
      return;
    }

    const context = {
      session,
      email: session.user.email ?? "",
      userId: session.user.id,
      companyId: mapping.company_id,
      employeeId: mapping.employee_id,
    };

    if (isActive) setCtx(context);
    await loadEmployee(context.companyId, context.employeeId, isActive);
    if (isActive) setLoading(false);
  }

  if (loading) {
    return <div style={containerStyle}>Loading profile…</div>;
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Profile</h1>
        <p style={{ color: "#b91c1c" }}>{err || "Unable to load employee context."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Employee</p>
          <h1 style={titleStyle}>Your Profile</h1>
          <p style={subtitleStyle}>View your employee details.</p>
          <p style={{ margin: "6px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx.email}</strong>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/me" style={{ color: "#2563eb", textDecoration: "none" }}>
            ← ESS Home
          </Link>
          <button onClick={handleSignOut} style={buttonStyle}>
            Sign Out
          </button>
        </div>
      </header>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <InfoCard label="Employee Name" value={employee?.full_name || "—"} />
        <InfoCard label="Employee Number" value={employee?.employee_no || "—"} />
        <InfoCard label="Work Email" value={employee?.work_email || "—"} />
        <InfoCard label="Phone" value={employee?.phone || "—"} />
        <InfoCard label="Status" value={employee?.status || "—"} />
        <InfoCard label="Department" value={employee?.department || "—"} />
        <InfoCard label="Designation" value={employee?.designation || "—"} />
        <InfoCard label="Joining Date" value={employee?.joining_date ? employee.joining_date.split("T")[0] : "—"} />
      </div>

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ margin: "0 0 8px" }}>Additional Details</h3>
        <p style={{ margin: "4px 0", color: "#6b7280", fontSize: 12 }}>Employee ID: {employee?.id}</p>
      </div>
    </div>
  );
}

function InfoCard({ label, value }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: 14, backgroundColor: "#f9fafb" }}>
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#6b7280" }}>{label}</div>
      <div style={{ marginTop: 6, fontWeight: 600, color: "#111827" }}>{value}</div>
    </div>
  );
}

const containerStyle = {
  maxWidth: 960,
  margin: "80px auto",
  padding: "48px 56px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
  backgroundColor: "#fff",
};

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  flexWrap: "wrap",
};

const buttonStyle = {
  padding: "12px 16px",
  backgroundColor: "#111827",
  border: "none",
  color: "#fff",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 15,
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = {
  margin: "6px 0 8px",
  fontSize: 30,
  color: "#111827",
};

const subtitleStyle = {
  margin: 0,
  color: "#4b5563",
  fontSize: 15,
};
