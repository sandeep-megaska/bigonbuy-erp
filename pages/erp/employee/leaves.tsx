import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../components/erp/ErpNavBar";
import { getEmployeeContext, requireAuthRedirectHome } from "../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../lib/erp/nav";
import { supabase } from "../../../lib/supabaseClient";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

type LeaveType = {
  id: string;
  code: string;
  name: string;
  is_paid: boolean;
};

type LeaveRequest = {
  id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  reviewer_notes: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

export default function EmployeeLeavesPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    leave_type_id: "",
    start_date: "",
    end_date: "",
    reason: "",
  });

  const leaveTypeMap = useMemo(() => {
    return leaveTypes.reduce<Record<string, LeaveType>>((acc, type) => {
      acc[type.id] = type;
      return acc;
    }, {});
  }, [leaveTypes]);

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

      await Promise.all([loadLeaveTypes(), loadRequests(context.employeeId)]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  async function loadLeaveTypes() {
    const { data, error } = await supabase
      .from("erp_leave_types")
      .select("id, code, name, is_paid")
      .eq("is_active", true)
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setLeaveTypes((data as LeaveType[]) || []);
    if (!form.leave_type_id && data?.length) {
      setForm((prev) => ({ ...prev, leave_type_id: data[0].id }));
    }
  }

  async function loadRequests(employeeId: string) {
    const { data, error } = await supabase
      .from("erp_leave_requests")
      .select("id, leave_type_id, start_date, end_date, days, reason, status, reviewer_notes")
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setRequests((data as LeaveRequest[]) || []);
  }

  async function submitRequest(event: FormEvent) {
    event.preventDefault();
    if (!ctx?.employeeId) return;
    if (!form.leave_type_id || !form.start_date || !form.end_date) {
      setToast({ type: "error", message: "Leave type and date range are required." });
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.rpc("erp_leave_request_submit", {
      p_employee_id: ctx.employeeId,
      p_leave_type_id: form.leave_type_id,
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
    setSubmitting(false);
    setForm({
      leave_type_id: form.leave_type_id,
      start_date: "",
      end_date: "",
      reason: "",
    });
    await loadRequests(ctx.employeeId);
  }

  async function cancelRequest(requestId: string) {
    const { error } = await supabase.rpc("erp_leave_request_set_status", {
      p_request_id: requestId,
      p_status: "cancelled",
      p_reviewer_notes: null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setToast({ type: "success", message: "Leave request cancelled." });
    if (ctx?.employeeId) {
      await loadRequests(ctx.employeeId);
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading your leave…</div>;
  }

  if (!ctx?.companyId || !ctx?.employeeId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>My Leave</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No employee profile is linked to this account."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={access.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Employee · Leave</p>
          <h1 style={titleStyle}>My Leave Requests</h1>
          <p style={subtitleStyle}>Submit and track leave requests.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp" style={linkStyle}>← Back to ERP Home</a>
          <button onClick={handleSignOut} style={buttonStyle}>Sign Out</button>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>New Leave Request</h3>
          <form onSubmit={submitRequest} style={formGridStyle}>
            <label style={labelStyle}>
              Leave type
              <select
                value={form.leave_type_id}
                onChange={(e) => setForm((prev) => ({ ...prev, leave_type_id: e.target.value }))}
                style={inputStyle}
              >
                <option value="">Select leave type</option>
                {leaveTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name} {type.is_paid ? "(Paid)" : "(Unpaid)"}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Start date
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm((prev) => ({ ...prev, start_date: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              End date
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm((prev) => ({ ...prev, end_date: e.target.value }))}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              Reason
              <textarea
                value={form.reason}
                onChange={(e) => setForm((prev) => ({ ...prev, reason: e.target.value }))}
                style={textareaStyle}
                rows={3}
                placeholder="Optional reason"
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="submit" style={primaryButtonStyle} disabled={submitting}>
                {submitting ? "Submitting..." : "Submit"}
              </button>
            </div>
          </form>
        </div>

        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Request History</h3>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Leave Type</th>
                  <th style={thStyle}>Dates</th>
                  <th style={thStyle}>Days</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ ...tdStyle, textAlign: "center" }}>
                      No leave requests yet.
                    </td>
                  </tr>
                ) : (
                  requests.map((request) => {
                    const leaveType = leaveTypeMap[request.leave_type_id];
                    return (
                      <tr key={request.id}>
                        <td style={tdStyle}>{leaveType ? leaveType.name : request.leave_type_id}</td>
                        <td style={tdStyle}>
                          {formatDate(request.start_date)} → {formatDate(request.end_date)}
                        </td>
                        <td style={tdStyle}>{request.days || "—"}</td>
                        <td style={tdStyle}>{STATUS_LABELS[request.status] || request.status}</td>
                        <td style={tdStyle}>
                          {request.reason || "—"}
                          {request.reviewer_notes ? (
                            <div style={{ marginTop: 6, color: "#6b7280" }}>
                              Reviewer: {request.reviewer_notes}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          {request.status === "submitted" ? (
                            <button
                              type="button"
                              onClick={() => cancelRequest(request.id)}
                              style={buttonStyle}
                            >
                              Cancel
                            </button>
                          ) : (
                            <span style={{ color: "#6b7280" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

const containerStyle: CSSProperties = {
  maxWidth: 1100,
  margin: "60px auto",
  padding: "32px 36px",
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  fontFamily: "Arial, sans-serif",
  backgroundColor: "#fff",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
  alignItems: "flex-start",
  borderBottom: "1px solid #eef1f6",
  paddingBottom: 20,
  marginBottom: 20,
};

const eyebrowStyle: CSSProperties = {
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontSize: 12,
  color: "#6b7280",
  margin: 0,
};

const titleStyle: CSSProperties = { margin: "6px 0 8px", fontSize: 30, color: "#111827" };

const subtitleStyle: CSSProperties = { margin: 0, color: "#4b5563", fontSize: 15 };

const linkStyle: CSSProperties = { color: "#2563eb", textDecoration: "none" };

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 18 };

const panelStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 20,
  backgroundColor: "#fff",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontWeight: 600,
  color: "#111827",
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
};

const textareaStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  resize: "vertical",
};

const tableWrapStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  overflowX: "auto",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: "12px 14px",
  backgroundColor: "#f9fafb",
  color: "#374151",
};

const tdStyle: CSSProperties = {
  padding: "12px 14px",
  borderTop: "1px solid #e5e7eb",
  verticalAlign: "top",
};

const buttonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  backgroundColor: "#fff",
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonStyle,
  backgroundColor: "#2563eb",
  borderColor: "#2563eb",
  color: "#fff",
};

const errorBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  color: "#b91c1c",
  marginBottom: 16,
};

const successBoxStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  backgroundColor: "#ecfdf5",
  border: "1px solid #a7f3d0",
  color: "#047857",
  marginBottom: 16,
};
