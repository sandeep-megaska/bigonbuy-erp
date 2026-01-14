import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getCompanyContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

const pageWrapper: React.CSSProperties = {
  padding: 24,
  fontFamily: "system-ui",
  maxWidth: 1200,
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

const formGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 12,
};

type LeaveType = {
  code: string;
  name: string;
  is_paid: boolean;
};

type LeaveRequest = {
  id: string;
  leave_type_code: string;
  start_date: string;
  end_date: string;
  days: number | null;
  reason: string | null;
  status: string;
  reviewer_notes: string | null;
  reviewed_at: string | null;
};

export default function EmployeeLeavesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [access, setAccess] = useState({ isAuthenticated: false, isManager: false, roleKey: undefined as string | undefined });
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    leave_type_code: "",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const leaveTypeByCode = useMemo(() => {
    const map = new Map<string, LeaveType>();
    leaveTypes.forEach((type) => map.set(type.code, type));
    return map;
  }, [leaveTypes]);

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
      const { data: employeeData, error: employeeError } = await supabase.rpc("erp_hr_my_employee_id");
      if (employeeError) {
        setToast({ type: "error", message: employeeError.message });
        setLoading(false);
        return;
      }
      setEmployeeId(employeeData);
      await Promise.all([loadLeaveTypes(), loadRequests()]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadLeaveTypes() {
    const { data, error } = await supabase
      .from("erp_leave_types")
      .select("code, name, is_paid")
      .eq("is_active", true)
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
      .select("id, leave_type_code, start_date, end_date, days, reason, status, reviewer_notes, reviewed_at")
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
    if (!employeeId) {
      setToast({ type: "error", message: "Employee mapping missing." });
      return;
    }
    if (!form.leave_type_code || !form.start_date || !form.end_date) {
      setToast({ type: "error", message: "Leave type and dates are required." });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("erp_leave_request_submit", {
      p_employee_id: employeeId,
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

  async function cancelRequest(request: LeaveRequest) {
    const { error } = await supabase.rpc("erp_leave_request_set_status", {
      p_request_id: request.id,
      p_status: "cancelled",
      p_reviewer_notes: null,
    });
    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }
    setToast({ type: "success", message: "Leave request cancelled." });
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
          <h1 style={{ margin: 0 }}>My Leave Requests</h1>
          <p style={{ marginTop: 6, color: "#4b5563" }}>
            Submit and track your leave requests.
          </p>
        </div>
        <a href="/erp" style={{ color: "#2563eb", textDecoration: "none" }}>← ERP Home</a>
      </div>

      {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

      <div style={{ display: "grid", gap: 16 }}>
        <form onSubmit={handleSubmit} style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>New Request</h3>
          <div style={formGrid}>
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
          <h3 style={{ marginTop: 0 }}>My Requests</h3>
          {requests.length === 0 ? (
            <p style={{ color: "#6b7280", fontStyle: "italic" }}>No leave requests yet.</p>
          ) : (
            <table style={listTable}>
              <thead>
                <tr>
                  <th style={thStyle}>Leave</th>
                  <th style={thStyle}>Dates</th>
                  <th style={thStyle}>Reason</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => {
                  const type = leaveTypeByCode.get(request.leave_type_code);
                  return (
                    <tr key={request.id}>
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
                        {request.status === "submitted" ? (
                          <button type="button" style={subtleButton} onClick={() => cancelRequest(request)}>
                            Cancel
                          </button>
                        ) : (
                          "—"
                        )}
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
