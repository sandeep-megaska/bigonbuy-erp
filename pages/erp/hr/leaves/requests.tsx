import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const pageWrapper: React.CSSProperties = {
  padding: 24,
  fontFamily: "system-ui",
  maxWidth: 1300,
  margin: "0 auto",
};

const cardStyle: React.CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: 16,
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
};

const inputStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 8,
  padding: "8px 10px",
  fontSize: 14,
  width: "100%",
};

const buttonStyle: React.CSSProperties = {
  background: "#2563eb",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  cursor: "pointer",
  fontSize: 14,
};

const subtleButton: React.CSSProperties = {
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  borderRadius: 8,
  padding: "6px 10px",
  cursor: "pointer",
  fontSize: 12,
};

const labelStyle: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 6, fontSize: 13 };

const toastStyle = (type: "success" | "error"): React.CSSProperties => ({
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${type === "success" ? "#a7f3d0" : "#fecaca"}`,
  background: type === "success" ? "#ecfdf5" : "#fef2f2",
  color: type === "success" ? "#047857" : "#b91c1c",
  marginBottom: 12,
});

const listTable: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 8px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#6b7280",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "top",
};

const badgeStyle = (status: string): React.CSSProperties => {
  const palette: Record<string, { bg: string; border: string; color: string }> = {
    draft: { bg: "#f3f4f6", border: "#e5e7eb", color: "#374151" },
    submitted: { bg: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
    approved: { bg: "#ecfdf3", border: "#a7f3d0", color: "#047857" },
    rejected: { bg: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
    cancelled: { bg: "#fef9c3", border: "#fde68a", color: "#92400e" },
  };
  const colors = palette[status] ?? palette.draft;
  return {
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 8px",
    borderRadius: 999,
    background: colors.bg,
    color: colors.color,
    border: `1px solid ${colors.border}`,
    fontSize: 12,
    textTransform: "capitalize",
  };
};

const emptyText: React.CSSProperties = { color: "#6b7280", fontStyle: "italic" };

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

type Employee = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
};

type LeaveRequest = {
  id: string;
  employee_id: string;
  leave_type_code: string;
  start_date: string;
  end_date: string;
  days: number | null;
  reason: string | null;
  status: string;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export default function LeaveRequestsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined as string | undefined });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    employee_id: "",
    leave_type_code: "",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const canManage = useMemo(
    () => ["owner", "admin", "hr", "payroll"].includes(ctx?.roleKey ?? ""),
    [ctx?.roleKey]
  );
  const canSubmitOnBehalf = useMemo(() => isHr(ctx?.roleKey), [ctx?.roleKey]);
  const leaveTypeByCode = useMemo(() => {
    const map = new Map<string, LeaveType>();
    leaveTypes.forEach((type) => map.set(type.code, type));
    return map;
  }, [leaveTypes]);
  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach((employee) => map.set(employee.id, employee));
    return map;
  }, [employees]);

  useEffect(() => {
    let active = true;
    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;
      const [accessState, context] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
      ]);
      if (!active) return;
      setAccess(accessState);
      setCtx(context);
      if (!context.companyId) {
        setToast({ type: "error", message: context.membershipError || "No company membership found." });
        setLoading(false);
        return;
      }
      await Promise.all([loadEmployees(), loadLeaveTypes(), loadRequests()]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_code")
      .order("full_name", { ascending: true });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setEmployees(data || []);
    if (!form.employee_id && data?.length) {
      setForm((prev) => ({ ...prev, employee_id: data[0].id }));
    }
  }

  async function loadLeaveTypes() {
    const { data, error } = await supabase
      .from("erp_leave_types")
      .select("id, code, name, is_paid")
      .order("name", { ascending: true });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setLeaveTypes(data || []);
    if (!form.leave_type_code && data?.length) {
      setForm((prev) => ({ ...prev, leave_type_code: data[0].code }));
    }
  }

  async function loadRequests() {
    const { data, error } = await supabase
      .from("erp_leave_requests")
      .select("id, employee_id, leave_type_code, start_date, end_date, days, reason, status, reviewer_notes, reviewed_at, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setRequests(data || []);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setToast(null);
    if (!canSubmitOnBehalf) {
      setToast({ type: "error", message: "Only HR/Admin can submit on behalf of employees." });
      return;
    }
    if (!form.employee_id || !form.leave_type_code || !form.start_date || !form.end_date) {
      setToast({ type: "error", message: "Employee, leave type, and dates are required." });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("erp_leave_request_submit", {
      p_employee_id: form.employee_id,
      p_leave_type_code: form.leave_type_code,
      p_start_date: form.start_date,
      p_end_date: form.end_date,
      p_reason: form.reason.trim() || null,
    });
    if (error) {
      setToast({ type: "error", message: error.message });
      setSubmitting(false);
      return;
    }
    setToast({ type: "success", message: "Leave request submitted." });
    setForm((prev) => ({ ...prev, start_date: "", end_date: "", reason: "" }));
    await loadRequests();
    setSubmitting(false);
  }

  async function updateStatus(request: LeaveRequest, status: string) {
    setToast(null);
    const note = window.prompt("Reviewer notes (optional)") || null;
    const { error } = await supabase.rpc("erp_leave_request_set_status", {
      p_request_id: request.id,
      p_status: status,
      p_reviewer_notes: note,
    });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setToast({ type: "success", message: `Leave request ${status}.` });
    await loadRequests();
  }

  if (loading) {
    return <div style={pageWrapper}>Loading leave requests…</div>;
  }

  return (
    <div style={pageWrapper}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0 }}>Leave Requests</h1>
          <p style={{ marginTop: 6, color: "#4b5563" }}>
            Review, approve, or cancel employee leave requests.
          </p>
        </div>
        <a href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>← HR Home</a>
      </div>

      {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

      <div style={{ display: "grid", gap: 16 }}>
        <form onSubmit={handleSubmit} style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Submit Request (HR)</h3>
          <div style={formGrid}>
            <label style={labelStyle}>
              Employee
              <select
                style={inputStyle}
                value={form.employee_id}
                onChange={(e) => setForm((prev) => ({ ...prev, employee_id: e.target.value }))}
              >
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name || "Employee"} {employee.employee_code ? `(${employee.employee_code})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Leave Type
              <select
                style={inputStyle}
                value={form.leave_type_code}
                onChange={(e) => setForm((prev) => ({ ...prev, leave_type_code: e.target.value }))}
              >
                {leaveTypes.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.name} {type.is_paid ? "(Paid)" : "(Unpaid)"}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Start Date
              <input
                type="date"
                style={inputStyle}
                value={form.start_date}
                onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
              />
            </label>
            <label style={labelStyle}>
              End Date
              <input
                type="date"
                style={inputStyle}
                value={form.end_date}
                onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
              />
            </label>
            <label style={labelStyle}>
              Reason
              <input
                style={inputStyle}
                value={form.reason}
                onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                placeholder="Optional"
              />
            </label>
          </div>
          <div style={{ marginTop: 16 }}>
            <button type="submit" style={buttonStyle} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Request"}
            </button>
          </div>
        </form>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Requests</h3>
          {requests.length === 0 ? (
            <p style={emptyText}>No leave requests yet.</p>
          ) : (
            <table style={listTable}>
              <thead>
                <tr>
                  <th style={thStyle}>Employee</th>
                  <th style={thStyle}>Leave</th>
                  <th style={thStyle}>Dates</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const employee = employeeById.get(request.employee_id);
                  const type = leaveTypeByCode.get(request.leave_type_code);
                  return (
                    <tr key={request.id}>
                      <td style={tdStyle}>
                        <strong>{employee?.full_name || "Employee"}</strong>
                        <div style={{ fontSize: 12, color: "#6b7280" }}>{employee?.employee_code || ""}</div>
                      </td>
                      <td style={tdStyle}>
                        {type?.name || request.leave_type_code}
                        {type?.is_paid === false ? (
                          <div style={{ fontSize: 12, color: "#b91c1c" }}>Unpaid</div>
                        ) : null}
                      </td>
                      <td style={tdStyle}>
                        {request.start_date} → {request.end_date}
                        {request.days ? (
                          <div style={{ fontSize: 12, color: "#6b7280" }}>{request.days} days</div>
                        ) : null}
                      </td>
                      <td style={tdStyle}>{request.reason || "—"}</td>
                      <td style={tdStyle}>
                        <span style={badgeStyle(request.status)}>{request.status}</span>
                        {request.reviewer_notes ? (
                          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                            {request.reviewer_notes}
                          </div>
                        ) : null}
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {canManage ? (
                          <>
                            <button
                              type="button"
                              style={subtleButton}
                              onClick={() => updateStatus(request, "approved")}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              style={subtleButton}
                              onClick={() => updateStatus(request, "rejected")}
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              style={subtleButton}
                              onClick={() => updateStatus(request, "cancelled")}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <span style={{ color: "#6b7280" }}>Read-only</span>
                        )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
