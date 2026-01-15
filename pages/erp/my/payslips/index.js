import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getEmployeeContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

export default function MyPayslipsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [access, setAccess] = useState({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [payslips, setPayslips] = useState([]);
  const [err, setErr] = useState("");

  const periodLabel = useMemo(() => {
    if (!payslips?.length) return "";
    const latest = payslips[0];
    return latest ? `${latest.period_year}-${String(latest.period_month).padStart(2, "0")}` : "";
  }, [payslips]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getEmployeeContext(session),
      ]);
      if (!active) return;
      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? undefined,
      });
      setCtx(context);
      if (!context.companyId || !context.employeeId) {
        setLoading(false);
        return;
      }
      await loadPayslips();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadPayslips() {
    setErr("");
    const { data, error } = await supabase.rpc("erp_my_payslips");
    if (error) {
      setErr(error.message || "Failed to load payslips.");
      return;
    }
    setPayslips(data || []);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading payslips…</div>;
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>My Payslips</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No employee profile is linked to this account."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Employee · Payslips</p>
          <h1 style={titleStyle}>My Payslips</h1>
          <p style={subtitleStyle}>Review finalized payslips and download PDFs.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp" style={linkStyle}>← Back to ERP Home</a>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </header>

      {err ? (
        <div style={errorBoxStyle}>{err}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <h3 style={{ margin: 0 }}>Payslip History</h3>
            {periodLabel ? (
              <p style={{ margin: "6px 0 0", color: "#6b7280" }}>Latest: {periodLabel}</p>
            ) : null}
          </div>
        </div>

        <div style={{ marginTop: 12, border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Payslip #</th>
                <th style={thStyle}>Net Pay</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Action</th>
              </tr>
            </thead>
            <tbody>
              {payslips.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: 16, color: "#6b7280" }}>
                    No payslips available yet.
                  </td>
                </tr>
              ) : (
                payslips.map((row) => (
                  <tr key={row.payslip_id}>
                    <td style={tdStyle}>
                      {row.period_year}-{String(row.period_month).padStart(2, "0")}
                    </td>
                    <td style={tdStyle}>{row.payslip_no}</td>
                    <td style={tdStyle}>{formatAmount(row.net_pay)}</td>
                    <td style={tdStyle}>
                      <span style={statusPillStyle}>{row.status}</span>
                    </td>
                    <td style={tdStyle}>
                      <a href={`/erp/my/payslips/${row.payslip_id}`} style={linkButtonStyle}>
                        View Payslip
                      </a>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatAmount(value) {
  if (value === null || value === undefined) return "—";
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(num);
}

const containerStyle = {
  maxWidth: 960,
  margin: "0 auto",
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
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "1px solid #f1f3f5",
  paddingBottom: 24,
  marginBottom: 32,
};

const eyebrowStyle = {
  textTransform: "uppercase",
  letterSpacing: "0.12em",
  fontSize: 12,
  fontWeight: 700,
  color: "#6b7280",
  margin: 0,
};

const titleStyle = {
  fontSize: 28,
  fontWeight: 700,
  margin: "8px 0",
};

const subtitleStyle = {
  color: "#6b7280",
  margin: 0,
};

const sectionStyle = {
  marginTop: 24,
};

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const buttonStyle = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #ddd",
  cursor: "pointer",
  background: "#fff",
};

const linkStyle = {
  color: "#2563eb",
  textDecoration: "none",
};

const thStyle = {
  padding: 12,
  borderBottom: "1px solid #e5e7eb",
  fontSize: 13,
  color: "#6b7280",
};

const tdStyle = {
  padding: 12,
  borderBottom: "1px solid #f1f1f1",
};

const linkButtonStyle = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  textDecoration: "none",
  color: "#111",
  fontWeight: 600,
  background: "#fff",
};

const statusPillStyle = {
  padding: "4px 10px",
  borderRadius: 999,
  background: "#e0f2fe",
  color: "#0369a1",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "capitalize",
};

const errorBoxStyle = {
  padding: 12,
  borderRadius: 8,
  border: "1px solid #fecaca",
  background: "#fef2f2",
  color: "#b91c1c",
  marginBottom: 16,
};
