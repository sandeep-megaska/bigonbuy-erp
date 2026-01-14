import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../../../lib/supabaseClient";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";

export default function PayrollRunsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null);
  const [runs, setRuns] = useState([]);
  const [year, setYear] = useState(new Date().getFullYear().toString());
  const [month, setMonth] = useState((new Date().getMonth() + 1).toString().padStart(2, "0"));

  const canWrite = useMemo(() => {
    if (!ctx?.roleKey) return false;
    return ["owner", "admin", "hr", "payroll"].includes(ctx.roleKey);
  }, [ctx]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const context = await getCompanyContext(session);
      if (!active) return;
      setCtx(context);
      if (!context.companyId) {
        setErr(context.membershipError || "No active company membership found for this user.");
        setLoading(false);
        return;
      }
      await loadRuns(context.companyId, active, context.session);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadRuns(companyId, isActive = true, session = null) {
    const response = await fetch("/api/erp/payroll/runs/list", {
      method: "GET",
      headers: getAuthHeaders(session),
    });
    const payload = await response.json();
    if (!response.ok) {
      if (isActive) setErr(payload?.error || "Unable to load payroll runs.");
      return;
    }
    if (isActive) setRuns(payload.runs || []);
  }

  async function createRun(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    setErr("");
    if (!canWrite) {
      setErr("Only HR/admin/owner/payroll can create payroll runs.");
      return;
    }
    const monthValue = Number.parseInt(month, 10);
    if (!Number.isInteger(monthValue) || monthValue < 1 || monthValue > 12) {
      const message = "Month must be between 1 and 12.";
      setErr(message);
      showToast(message, "error");
      return;
    }
    const response = await fetch("/api/erp/payroll/runs/create", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        year: Number(year),
        month: monthValue,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setErr(payload?.error || "Unable to create payroll run.");
      return;
    }
    await loadRuns(ctx.companyId);
    if (payload?.id) {
      router.push(`/erp/hr/payroll/runs/${payload.id}`);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  function getAuthHeaders(sessionOverride = null) {
    const token = sessionOverride?.access_token ?? ctx?.session?.access_token;
    return token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" };
  }

  function showToast(message, type = "success") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }

  if (loading) return <div style={{ padding: 24 }}>Loading payroll runs…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Payroll Runs</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Payroll Runs</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Create payroll runs and open a run to manage items.</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr">← HR Home</a>
          <a href="/erp">ERP Home</a>
        </div>
      </div>

      {toast ? (
        <div style={{ marginTop: 12, padding: "10px 12px", borderRadius: 8, background: toast.type === "error" ? "#fef2f2" : "#ecfdf5", color: toast.type === "error" ? "#991b1b" : "#065f46", border: `1px solid ${toast.type === "error" ? "#fecaca" : "#a7f3d0"}` }}>
          {toast.message}
        </div>
      ) : null}

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
        <h3 style={{ marginTop: 0 }}>Create Payroll Run</h3>
        {!canWrite ? (
          <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin/hr/payroll can create runs).</div>
        ) : (
          <form onSubmit={createRun} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" style={inputStyle} />
            <input type="number" min="1" max="12" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="Month" style={inputStyle} />
            <div style={{ gridColumn: "1 / -1" }}>
              <button style={buttonStyle}>Create Run</button>
            </div>
          </form>
        )}
      </div>

      <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
        {runs.length === 0 ? (
          <div style={{ color: "#777" }}>No payroll runs yet.</div>
        ) : (
          runs.map((run) => (
            <div key={run.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, border: "1px solid #eee", borderRadius: 10, background: "#fff" }}>
              <div>
                <div style={{ fontWeight: 600 }}>{run.year}-{String(run.month).padStart(2, "0")}</div>
                <div style={{ fontSize: 12, color: "#777" }}>{run.status} · {run.id}</div>
              </div>
              <a href={`/erp/hr/payroll/runs/${run.id}`} style={smallButtonStyle}>Open Run</a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const smallButtonStyle = { padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
