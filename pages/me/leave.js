import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../lib/supabaseClient";
import { getEmployeeContext, requireAuthRedirectHome } from "../../lib/erpContext";

export default function EmployeeLeavePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");

  const currentYear = useMemo(() => new Date().getFullYear(), []);

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
      await Promise.all([
        loadLeaveTypes(context.companyId, active),
        loadBalances(context.companyId, context.employeeId, active),
        loadRequests(context.companyId, context.employeeId, active),
      ]);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadLeaveTypes(companyId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_leave_types")
      .select("id, name, description")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) {
      setLeaveTypes(data || []);
      const first = data?.[0]?.id;
      if (!leaveTypeId && first) setLeaveTypeId(first);
    }
  }

  async function loadBalances(companyId, employeeId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_leave_balances")
      .select("*")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .eq("year", currentYear)
      .order("leave_type_id", { ascending: true });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) setBalances(data || []);
  }

  async function loadRequests(companyId, employeeId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_leave_requests")
      .select("id, leave_type_id, start_date, end_date, days, reason, status, created_at, approved_at, approved_by")
      .eq("company_id", companyId)
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) setRequests(data || []);
  }

  async function createRequest(e) {
    e.preventDefault();
    if (!ctx?.companyId || !ctx?.employeeId) return;
    if (!leaveTypeId) {
      setErr("Select a leave type.");
      return;
    }
    if (!startDate || !endDate) {
      setErr("Start and end dates are required.");
      return;
    }
    const { error } = await supabase.rpc("erp_leave_request_submit", {
      p_employee_id: ctx.employeeId,
      p_leave_type_id: leaveTypeId,
      p_start_date: startDate,
      p_end_date: endDate,
      p_reason: reason.trim() || null,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setStartDate("");
    setEndDate("");
    setDays("");
    setReason("");
    await loadRequests(ctx.companyId, ctx.employeeId);
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  const balanceMap = useMemo(() => {
    const map = {};
    balances.forEach((b) => {
      map[b.leave_type_id] = b;
    });
    return map;
  }, [balances]);

  const renderBalance = (leaveTypeId) => {
    const bal = balanceMap[leaveTypeId];
    if (!bal) return "—";
    const available = bal.days_available ?? bal.balance ?? bal.available ?? bal.remaining ?? bal.days ?? "—";
    const used = bal.days_used ?? bal.used ?? bal.consumed ?? null;
    return used !== null && used !== undefined ? `${available} available · ${used} used` : `${available} available`;
  };

  if (loading) {
    return <div style={containerStyle}>Loading leave…</div>;
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Leave</h1>
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
          <h1 style={titleStyle}>Leave</h1>
          <p style={subtitleStyle}>View balances and request time off.</p>
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

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "2fr 1.2fr", marginTop: 18 }}>
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, background: "#fff" }}>
          <h3 style={{ margin: "0 0 8px" }}>Request Leave</h3>
          <form onSubmit={createRequest} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            <select value={leaveTypeId} onChange={(e) => setLeaveTypeId(e.target.value)} style={inputStyle}>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>
                  {lt.name}
                </option>
              ))}
            </select>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              placeholder="Days"
              style={inputStyle}
              type="number"
              min="0"
              step="0.5"
            />
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason"
              style={{ ...inputStyle, minHeight: 80, gridColumn: "1 / -1" }}
            />
            <div style={{ gridColumn: "1 / -1" }}>
              <button style={buttonStyle}>Submit Request</button>
            </div>
          </form>
        </div>

        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, background: "#fff" }}>
          <h3 style={{ margin: "0 0 6px" }}>Balances ({currentYear})</h3>
          <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {leaveTypes.map((lt) => (
              <li key={lt.id} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{lt.name}</div>
                <div style={{ color: "#4b5563", fontSize: 14 }}>{renderBalance(lt.id)}</div>
              </li>
            ))}
            {!leaveTypes.length ? <li style={{ color: "#6b7280" }}>No leave types available.</li> : null}
          </ul>
        </div>
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Your Requests ({requests.length})
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={thStyle}>Leave Type</th>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Details</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => {
                const lt = leaveTypes.find((l) => l.id === row.leave_type_id);
                return (
                  <tr key={row.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{lt?.name || row.leave_type_id}</div>
                      <div style={{ fontSize: 12, color: "#777" }}>{lt?.description || "—"}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>Start: {row.start_date || "—"}</div>
                      <div>End: {row.end_date || "—"}</div>
                      <div>Days: {row.days ?? "—"}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>{row.reason || "—"}</div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
                        Requested: {row.created_at ? new Date(row.created_at).toLocaleDateString() : "—"}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{row.status}</div>
                      {row.approved_by ? (
                        <div style={{ fontSize: 12, color: "#777", marginTop: 4 }}>
                          By {row.approved_by}
                          <br />
                          {row.approved_at ? new Date(row.approved_at).toLocaleString() : ""}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!requests.length ? (
                <tr>
                  <td style={tdStyle} colSpan={4}>
                    No requests yet.
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

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const thStyle = { padding: 12, borderBottom: "1px solid #eee", whiteSpace: "nowrap" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
