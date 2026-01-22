import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
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

const SESSION_OPTIONS = [
  { value: "full", label: "Full day" },
  { value: "half_am", label: "Half day (AM)" },
  { value: "half_pm", label: "Half day (PM)" },
] as const;

type LeaveType = {
  id: string;
  key: string;
  name: string;
  is_paid: boolean;
  is_active: boolean;
  allows_half_day: boolean;
  display_order: number;
};

type LeaveRequest = {
  id: string;
  leave_type_id: string;
  date_from: string;
  date_to: string;
  reason: string | null;
  status: string;
  decision_note: string | null;
  decided_at: string | null;
  start_session: string | null;
  end_session: string | null;
  leave_type?: { name?: string | null } | null;
};

type LeavePreviewRow = {
  leave_date: string;
  day_fraction: number;
  is_weekly_off: boolean;
  is_holiday: boolean;
  counted: boolean;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type FormState = {
  leave_type_id: string;
  date_from: string;
  date_to: string;
  start_session: string;
  end_session: string;
  reason: string;
};

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
  const [requestDaysMap, setRequestDaysMap] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<ToastState>(null);
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<LeavePreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    leave_type_id: "",
    date_from: "",
    date_to: "",
    start_session: "full",
    end_session: "full",
    reason: "",
  });

  const leaveTypeMap = useMemo(() => {
    return leaveTypes.reduce<Record<string, LeaveType>>((acc, type) => {
      acc[type.id] = type;
      return acc;
    }, {});
  }, [leaveTypes]);

  const selectedLeaveType = leaveTypeMap[form.leave_type_id];

  const previewTotal = useMemo(() => {
    return previewRows.reduce((sum, row) => {
      if (!row.counted) return sum;
      return sum + Number(row.day_fraction || 0);
    }, 0);
  }, [previewRows]);

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

  useEffect(() => {
    if (!selectedLeaveType?.allows_half_day) {
      setForm((prev) => ({ ...prev, start_session: "full", end_session: "full" }));
    }
  }, [selectedLeaveType?.allows_half_day]);

  useEffect(() => {
    let active = true;

    if (!ctx?.employeeId || !form.leave_type_id || !form.date_from || !form.date_to) {
      setPreviewRows([]);
      setPreviewError(null);
      return () => {
        active = false;
      };
    }

    (async () => {
      setPreviewLoading(true);
      const { data, error } = await supabase.rpc("erp_leave_request_preview", {
        p_employee_id: ctx.employeeId,
        p_leave_type_id: form.leave_type_id,
        p_date_from: form.date_from,
        p_date_to: form.date_to,
        p_start_session: form.start_session,
        p_end_session: form.end_session,
      });

      if (!active) return;

      if (error) {
        setPreviewError(error.message);
        setPreviewRows([]);
        setPreviewLoading(false);
        return;
      }

      setPreviewError(null);
      setPreviewRows((data as LeavePreviewRow[]) || []);
      setPreviewLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [
    ctx?.employeeId,
    form.leave_type_id,
    form.date_from,
    form.date_to,
    form.start_session,
    form.end_session,
  ]);

  async function loadLeaveTypes() {
    const { data, error } = await supabase
      .from("erp_hr_leave_types")
      .select("id, key, name, is_paid, is_active, allows_half_day, display_order")
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    const rows = (data as LeaveType[]) || [];
    setLeaveTypes(rows);
    if (!form.leave_type_id && rows.length) {
      setForm((prev) => ({ ...prev, leave_type_id: rows[0].id }));
    }
  }

  async function loadRequests(employeeId: string) {
    const { data, error } = await supabase
      .from("erp_hr_leave_requests")
      .select(
        "id, leave_type_id, date_from, date_to, reason, status, decision_note, decided_at, start_session, end_session, leave_type:leave_type_id(name)"
      )
      .eq("employee_id", employeeId)
      .order("created_at", { ascending: false });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    const rows = (data as LeaveRequest[]) || [];
    setRequests(rows);
    await loadRequestDays(rows);
  }

  async function loadRequestDays(rows: LeaveRequest[]) {
    if (!rows.length) {
      setRequestDaysMap({});
      return;
    }

    const requestIds = rows.map((row) => row.id);
    const { data, error } = await supabase
      .from("erp_hr_leave_request_days")
      .select("leave_request_id, day_fraction")
      .in("leave_request_id", requestIds);

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    const mapped = (data as { leave_request_id: string; day_fraction: number }[] | null)?.reduce(
      (acc, row) => {
        const current = acc[row.leave_request_id] ?? 0;
        acc[row.leave_request_id] = current + Number(row.day_fraction || 0);
        return acc;
      },
      {} as Record<string, number>
    );

    setRequestDaysMap(mapped || {});
  }

  async function saveDraft() {
    if (!ctx?.employeeId) return null;
    if (!form.leave_type_id || !form.date_from || !form.date_to) {
      setToast({ type: "error", message: "Leave type and date range are required." });
      return null;
    }

    const payload = {
      employee_id: ctx.employeeId,
      leave_type_id: form.leave_type_id,
      date_from: form.date_from,
      date_to: form.date_to,
      reason: form.reason.trim() || null,
      status: "draft",
      start_session: form.start_session,
      end_session: form.end_session,
      updated_by: ctx?.userId ?? null,
    };

    setSaving(true);

    const { data, error } = await supabase.rpc("erp_hr_leave_request_draft_upsert", {
      p_id: draftId || null,
      p_employee_id: payload.employee_id,
      p_leave_type_id: payload.leave_type_id,
      p_date_from: payload.date_from,
      p_date_to: payload.date_to,
      p_reason: payload.reason,
      p_start_session: payload.start_session,
      p_end_session: payload.end_session,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setSaving(false);
      return null;
    }

    const requestId = typeof data === "object" && data ? (data as { id?: string }).id : draftId;
    if (!requestId) {
      setToast({ type: "error", message: "Unable to save draft." });
      setSaving(false);
      return null;
    }

    setToast({ type: "success", message: draftId ? "Draft updated." : "Draft saved." });
    setSaving(false);
    setDraftId(requestId);
    await loadRequests(ctx.employeeId);
    return requestId;
  }

  async function submitDraft() {
    let requestId = draftId;
    if (!requestId) {
      const createdId = await saveDraft();
      if (!createdId) return;
      requestId = createdId;
      setDraftId(createdId);
    }

    setSaving(true);
    const { error } = await supabase.rpc("erp_leave_request_submit", {
      p_request_id: requestId,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Leave request submitted." });
    setSaving(false);
    setDraftId(null);
    setForm((prev) => ({
      ...prev,
      date_from: "",
      date_to: "",
      reason: "",
      start_session: "full",
      end_session: "full",
    }));
    await loadRequests(ctx.employeeId);
  }

  async function submitRequest(requestId: string) {
    setSaving(true);
    const { error } = await supabase.rpc("erp_leave_request_submit", {
      p_request_id: requestId,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setSaving(false);
      return;
    }

    setToast({ type: "success", message: "Leave request submitted." });
    setSaving(false);
    await loadRequests(ctx.employeeId);
  }

  async function cancelRequest(requestId: string) {
    const confirmed = window.confirm("Cancel this leave request?");
    if (!confirmed) return;

    const { error } = await supabase.rpc("erp_leave_request_cancel", {
      p_request_id: requestId,
      p_note: null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setToast({ type: "success", message: "Leave request cancelled." });
    await loadRequests(ctx.employeeId);
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
          <div style={formPreviewGridStyle}>
            <form style={formGridStyle}>
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
                Date from
                <input
                  type="date"
                  value={form.date_from}
                  onChange={(e) => setForm((prev) => ({ ...prev, date_from: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Date to
                <input
                  type="date"
                  value={form.date_to}
                  onChange={(e) => setForm((prev) => ({ ...prev, date_to: e.target.value }))}
                  style={inputStyle}
                />
              </label>
              {selectedLeaveType?.allows_half_day ? (
                <>
                  <label style={labelStyle}>
                    Start session
                    <select
                      value={form.start_session}
                      onChange={(e) => setForm((prev) => ({ ...prev, start_session: e.target.value }))}
                      style={inputStyle}
                    >
                      {SESSION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={labelStyle}>
                    End session
                    <select
                      value={form.end_session}
                      onChange={(e) => setForm((prev) => ({ ...prev, end_session: e.target.value }))}
                      style={inputStyle}
                    >
                      {SESSION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
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
              <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                <button type="button" onClick={saveDraft} style={buttonStyle} disabled={saving}>
                  {saving ? "Saving..." : "Save Draft"}
                </button>
                <button type="button" onClick={submitDraft} style={primaryButtonStyle} disabled={saving}>
                  {saving ? "Submitting..." : "Submit"}
                </button>
              </div>
            </form>
            <div style={previewCardStyle}>
              <div style={previewHeaderStyle}>
                <div>
                  <h4 style={{ margin: 0 }}>Preview</h4>
                  <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                    Estimated leave days before submitting.
                  </p>
                </div>
                <span style={previewTotalStyle}>Total: {formatDayCount(previewTotal)}</span>
              </div>
              {previewLoading ? (
                <p style={{ margin: 0, color: "#6b7280" }}>Loading preview…</p>
              ) : previewError ? (
                <p style={{ margin: 0, color: "#b91c1c" }}>{previewError}</p>
              ) : previewRows.length === 0 ? (
                <p style={{ margin: 0, color: "#6b7280" }}>Select details to preview days.</p>
              ) : (
                <div style={previewTableWrapStyle}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={thStyle}>Date</th>
                        <th style={thStyle}>Holiday/Off</th>
                        <th style={thStyle}>Counted</th>
                        <th style={thStyle}>Day fraction</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row) => (
                        <tr key={row.leave_date}>
                          <td style={tdStyle}>{formatDate(row.leave_date)}</td>
                          <td style={tdStyle}>
                            {row.is_holiday ? "Holiday" : row.is_weekly_off ? "Weekly off" : "—"}
                          </td>
                          <td style={tdStyle}>{row.counted ? "Yes" : "No"}</td>
                          <td style={tdStyle}>{formatDayCount(row.day_fraction)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
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
                    const countedDays = requestDaysMap[request.id];
                    return (
                      <tr key={request.id}>
                        <td style={tdStyle}>{request.leave_type?.name || request.leave_type_id}</td>
                        <td style={tdStyle}>
                          {formatDate(request.date_from)} → {formatDate(request.date_to)}
                          <div style={{ color: "#6b7280", marginTop: 4 }}>
                            {formatSession(request.start_session)} → {formatSession(request.end_session)}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          {typeof countedDays === "number" ? formatDayCount(countedDays) : "—"}
                        </td>
                        <td style={tdStyle}>{STATUS_LABELS[request.status] || request.status}</td>
                        <td style={tdStyle}>
                          {request.reason || "—"}
                          {request.decision_note ? (
                            <div style={{ marginTop: 6, color: "#6b7280" }}>
                              Decision: {request.decision_note}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {request.status === "draft" ? (
                              <button
                                type="button"
                                onClick={() => submitRequest(request.id)}
                                style={primaryButtonStyle}
                              >
                                Submit
                              </button>
                            ) : null}
                            {request.status === "submitted" || request.status === "approved" ? (
                              <button
                                type="button"
                                onClick={() => cancelRequest(request.id)}
                                style={buttonStyle}
                              >
                                Cancel
                              </button>
                            ) : null}
                            {request.status !== "draft" && request.status !== "submitted" ? (
                              <span style={{ color: "#6b7280" }}>—</span>
                            ) : null}
                          </div>
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

function formatDayCount(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "—";
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(1);
}

function formatSession(value?: string | null) {
  if (!value || value === "full") return "Full day";
  if (value === "half_am") return "Half day (AM)";
  if (value === "half_pm") return "Half day (PM)";
  return value;
}

const containerStyle: CSSProperties = {
  maxWidth: 1150,
  margin: "0 auto",
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

const formPreviewGridStyle: CSSProperties = {
  display: "grid",
  gap: 20,
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  alignItems: "flex-start",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  alignItems: "end",
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

const previewCardStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 16,
  backgroundColor: "#f9fafb",
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const previewHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const previewTotalStyle: CSSProperties = {
  fontWeight: 700,
  color: "#111827",
};

const previewTableWrapStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  overflowX: "auto",
  backgroundColor: "#fff",
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
