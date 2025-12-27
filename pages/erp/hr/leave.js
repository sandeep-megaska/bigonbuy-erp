import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { supabase } from "../../../lib/supabaseClient";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../lib/erpContext";

export default function HrLeavePage() {
  const router = useRouter();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [leaveTypes, setLeaveTypes] = useState([]);
  const [requests, setRequests] = useState([]);
  const [employees, setEmployees] = useState([]);

  const [ltName, setLtName] = useState("");
  const [ltDesc, setLtDesc] = useState("");

  const [reqEmployee, setReqEmployee] = useState("");
  const [reqType, setReqType] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");

  const canWrite = useMemo(() => (ctx ? isHr(ctx.roleKey) : false), [ctx]);

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
      await Promise.all([
        loadEmployees(context.companyId, active),
        loadLeaveTypes(context.companyId, active),
        loadRequests(context.companyId, active),
      ]);
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [router]);

  async function loadEmployees(companyId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_no")
      .eq("company_id", companyId)
      .order("full_name", { ascending: true });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) {
      setEmployees(data || []);
      if (!reqEmployee && data?.length) setReqEmployee(data[0].id);
    }
  }

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
      if (!reqType && data?.length) setReqType(data[0].id);
    }
  }

  async function loadRequests(companyId, isActive = true) {
    const { data, error } = await supabase
      .from("erp_leave_requests")
      .select("id, employee_id, leave_type_id, start_date, end_date, days, reason, status, approved_by, approved_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isActive) setErr(error.message);
      return;
    }
    if (isActive) setRequests(data || []);
  }

  async function createLeaveType(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can create leave types.");
      return;
    }
    if (!ltName.trim()) {
      setErr("Leave type name required.");
      return;
    }
    const payload = {
      company_id: ctx.companyId,
      name: ltName.trim(),
      description: ltDesc.trim() || null,
    };
    const { error } = await supabase.from("erp_leave_types").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }
    setLtName("");
    setLtDesc("");
    await loadLeaveTypes(ctx.companyId);
  }

  async function createRequest(e) {
    e.preventDefault();
    if (!ctx?.companyId) return;
    if (!reqEmployee || !reqType) {
      setErr("Choose employee and leave type.");
      return;
    }
    const payload = {
      company_id: ctx.companyId,
      employee_id: reqEmployee,
      leave_type_id: reqType,
      start_date: startDate || null,
      end_date: endDate || null,
      days: days ? Number(days) : null,
      reason: reason.trim() || null,
      status: "requested",
    };
    const { error } = await supabase.from("erp_leave_requests").insert(payload);
    if (error) {
      setErr(error.message);
      return;
    }
    setStartDate("");
    setEndDate("");
    setDays("");
    setReason("");
    await loadRequests(ctx.companyId);
  }

  async function updateRequestStatus(id, status) {
    if (!ctx?.companyId) return;
    if (!canWrite) {
      setErr("Only HR/admin/owner can update leave requests.");
      return;
    }
    const payload = {
      status,
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("erp_leave_requests")
      .update(payload)
      .eq("id", id)
      .eq("company_id", ctx.companyId);
    if (error) {
      setErr(error.message);
      return;
    }
    await loadRequests(ctx.companyId);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (loading) return <div style={{ padding: 24 }}>Loading leave…</div>;

  if (!ctx?.companyId) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Leave</h1>
        <p style={{ color: "#b91c1c" }}>{err || "No company is linked to this account."}</p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0 }}>Leave</h1>
          <p style={{ marginTop: 6, color: "#555" }}>Configure leave types and requests.</p>
          <p style={{ marginTop: 0, color: "#777", fontSize: 13 }}>
            Signed in as <b>{ctx?.email}</b> · Role: <b>{ctx?.roleKey}</b>
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <a href="/erp/hr">← HR Home</a>
          <a href="/erp">ERP Home</a>
        </div>
      </div>

      {err ? (
        <div style={{ marginTop: 12, padding: 12, background: "#fff3f3", border: "1px solid #ffd3d3", borderRadius: 8 }}>
          {err}
        </div>
      ) : null}

      <div style={{ marginTop: 18, display: "grid", gap: 18, gridTemplateColumns: "1fr 1fr" }}>
        <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>Leave Types</h3>
          {!canWrite ? (
            <div style={{ color: "#777" }}>You are in read-only mode (only owner/admin/hr can create/update).</div>
          ) : (
            <form onSubmit={createLeaveType} style={{ display: "grid", gap: 10 }}>
              <input value={ltName} onChange={(e) => setLtName(e.target.value)} placeholder="Name" style={inputStyle} />
              <textarea value={ltDesc} onChange={(e) => setLtDesc(e.target.value)} placeholder="Description" style={{ ...inputStyle, minHeight: 70 }} />
              <button style={buttonStyle}>Add Leave Type</button>
            </form>
          )}

          <ul style={{ marginTop: 16, paddingLeft: 18 }}>
            {leaveTypes.map((lt) => (
              <li key={lt.id} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{lt.name}</div>
                <div style={{ color: "#555" }}>{lt.description || "—"}</div>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ padding: 16, border: "1px solid #eee", borderRadius: 12, background: "#fff" }}>
          <h3 style={{ marginTop: 0 }}>New Leave Request</h3>
          <form onSubmit={createRequest} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <select value={reqEmployee} onChange={(e) => setReqEmployee(e.target.value)} style={inputStyle}>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>{emp.full_name} {emp.employee_no ? `(${emp.employee_no})` : ""}</option>
              ))}
            </select>
            <select value={reqType} onChange={(e) => setReqType(e.target.value)} style={inputStyle}>
              {leaveTypes.map((lt) => (
                <option key={lt.id} value={lt.id}>{lt.name}</option>
              ))}
            </select>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="Start Date" style={inputStyle} />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="End Date" style={inputStyle} />
            <input value={days} onChange={(e) => setDays(e.target.value)} placeholder="Days" style={inputStyle} />
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" style={{ ...inputStyle, minHeight: 70 }} />
            <div style={{ gridColumn: "1 / -1" }}>
              <button style={buttonStyle}>Submit Request</button>
            </div>
          </form>
        </div>
      </div>

      <div style={{ marginTop: 18, border: "1px solid #eee", borderRadius: 12, overflow: "hidden", background: "#fff" }}>
        <div style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fafafa", fontWeight: 600 }}>
          Leave Requests ({requests.length})
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={thStyle}>Employee</th>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Details</th>
                <th style={thStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((row) => {
                const emp = employees.find((e) => e.id === row.employee_id);
                const lt = leaveTypes.find((l) => l.id === row.leave_type_id);
                return (
                  <tr key={row.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{emp?.full_name || "—"}</div>
                      <div style={{ fontSize: 12, color: "#777" }}>{emp?.employee_no || row.employee_id}</div>
                      <div style={{ fontSize: 12, color: "#777" }}>Type: {lt?.name || row.leave_type_id}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>Start: {row.start_date || "—"}</div>
                      <div>End: {row.end_date || "—"}</div>
                      <div>Days: {row.days ?? "—"}</div>
                    </td>
                    <td style={tdStyle}>
                      <div>{row.reason || "—"}</div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>ID: {row.id}</div>
                    </td>
                    <td style={{ ...tdStyle, minWidth: 160 }}>
                      <div style={{ fontWeight: 600 }}>{row.status}</div>
                      {row.approved_by ? (
                        <div style={{ fontSize: 12, color: "#777" }}>
                          By {row.approved_by}<br />
                          {row.approved_at ? new Date(row.approved_at).toLocaleString() : ""}
                        </div>
                      ) : null}
                      {canWrite ? (
                        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                          <button onClick={() => updateRequestStatus(row.id, "approved")} style={smallButtonStyle}>Approve</button>
                          <button onClick={() => updateRequestStatus(row.id, "rejected")} style={smallButtonStyle}>Reject</button>
                        </div>
                      ) : (
                        <div style={{ color: "#777", fontSize: 12, marginTop: 6 }}>Read-only</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const inputStyle = { padding: 10, borderRadius: 8, border: "1px solid #ddd", width: "100%" };
const buttonStyle = { padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const smallButtonStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #ddd", cursor: "pointer" };
const thStyle = { padding: 12, borderBottom: "1px solid #eee" };
const tdStyle = { padding: 12, borderBottom: "1px solid #f1f1f1", verticalAlign: "top" };
