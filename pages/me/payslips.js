import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabaseClient";
import { getEmployeeContext, requireAuthRedirectHome } from "../../lib/erpContext";

export default function EmployeePayslipsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const context = await getEmployeeContext(session);
      if (!active) return;
      setCtx(context);
      if (!context.companyId || !context.employeeId) {
        setErr("Your account is not linked to an employee record. Contact HR.");
        setLoading(false);
        return;
      }
      await loadPayslips(context.companyId, context.employeeId, active);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadPayslips(companyId, employeeId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_payroll_items")
      .select(
        "id, payroll_run_id, employee_id, gross, deductions, net_pay, notes, payroll_run:erp_payroll_runs(id, year, month, status, processed_at)"
      )
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) setItems(data || []);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const formattedItems = useMemo(
    () =>
      items.map((it) => {
        const run = it.payroll_run || {};
        const net = it.net_pay ?? (it.gross ?? 0) - (it.deductions ?? 0);
        const period = run.year ? `${run.year}-${String(run.month || 0).toString().padStart(2, "0")}` : "—";
        return { ...it, run, net, period };
      }),
    [items]
  );

  if (loading) {
    return <div style={containerStyle}>Loading payslips…</div>;
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Payslips</h1>
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
          <h1 style={titleStyle}>Payslips</h1>
          <p style={subtitleStyle}>View payroll items issued to you.</p>
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

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Payroll Items ({formattedItems.length})
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Amounts</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {formattedItems.map((it) => (
                <tr key={it.id}>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{it.period}</div>
                    <div style={{ fontSize: 12, color: "#777" }}>Run ID: {it.payroll_run_id}</div>
                    <div style={{ fontSize: 12, color: "#777" }}>
                      Run Status: {it.run?.status || "—"}
                    </div>
                  </td>
                  <td style={tdStyle}>
                    <div>Gross: {it.gross ?? "—"}</div>
                    <div>Deductions: {it.deductions ?? "—"}</div>
                    <div style={{ fontWeight: 600, marginTop: 6 }}>Net: {it.net}</div>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{it.run?.status || "—"}</div>
                    <div style={{ fontSize: 12, color: "#777" }}>
                      Processed: {it.run?.processed_at ? new Date(it.run.processed_at).toLocaleDateString() : "—"}
                    </div>
                    <div style={{ fontSize: 12, color: "#777" }}>Item ID: {it.id}</div>
                  </td>
                  <td style={tdStyle}>{it.notes || "—"}</td>
                </tr>
              ))}
              {!formattedItems.length ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>
                    No payslips yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const containerStyle = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "32px 40px",
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

const thStyle = { padding: 12, borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
