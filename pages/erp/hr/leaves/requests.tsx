import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import {
  getCompanyContext,
  getEmployeeContext,
  isHr,
  requireAuthRedirectHome,
} from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

const STATUS_OPTIONS = ["draft", "submitted", "approved", "rejected", "cancelled"] as const;

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

type EmployeeRow = {
  id: string;
  full_name: string | null;
  employee_code: string | null;
};

type LeaveType = {
  id: string;
  key: string;
  name: string;
  is_paid: boolean;
  is_active: boolean;
  allows_half_day: boolean;
  counts_weekly_off: boolean;
  counts_holiday: boolean;
  display_order: number;
};

type LeaveRequest = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  date_from: string;
  date_to: string;
  reason: string | null;
  status: string;
  approver_user_id: string | null;
  decided_at: string | null;
  decision_note: string | null;
  submitted_at: string | null;
  cancelled_at: string | null;
  start_session: string | null;
  end_session: string | null;
  employee?: { full_name?: string | null; employee_code?: string | null } | null;
  leave_type?: { name?: string | null } | null;
};

type LeavePreviewRow = {
  leave_date: string;
  day_fraction: number;
  is_weekly_off: boolean;
  is_holiday: boolean;
  counted: boolean;
};

type ReviewModalState = {
  open: boolean;
  request?: LeaveRequest;
  status?: "approved" | "rejected";
};

type ToastState = { type: "success" | "error"; message: string } | null;

type FormState = {
  employee_id: string;
  leave_type_id: string;
  date_from: string;
  date_to: string;
  start_session: string;
  end_session: string;
  reason: string;
};

export default function HrLeaveRequestsPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [employeeCtx, setEmployeeCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [requestDaysMap, setRequestDaysMap] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  const [dateFromFilter, setDateFromFilter] = useState<string>("");
  const [dateToFilter, setDateToFilter] = useState<string>("");
  const [toast, setToast] = useState<ToastState>(null);
  const [reviewModal, setReviewModal] = useState<ReviewModalState>({ open: false });
  const [reviewNotes, setReviewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [previewRows, setPreviewRows] = useState<LeavePreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    employee_id: "",
    leave_type_id: "",
    date_from: "",
    date_to: "",
    start_session: "full",
    end_session: "full",
    reason: "",
  });

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

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

  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (statusFilter !== "all" && req.status !== statusFilter) return false;
      if (employeeFilter !== "all" && req.employee_id !== employeeFilter) return false;
      if (dateFromFilter && req.date_to < dateFromFilter) return false;
      if (dateToFilter && req.date_from > dateToFilter) return false;
      return true;
    });
  }, [requests, statusFilter, employeeFilter, dateFromFilter, dateToFilter]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const [accessState, context, employeeContext] = await Promise.all([
        getCurrentErpAccess(session),
        getCompanyContext(session),
        getEmployeeContext(session),
      ]);
      if (!active) return;

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);
      setEmployeeCtx(employeeContext);

      if (!context.companyId) {
        setLoading(false);
        return;
      }

      await Promise.all([
        loadLeaveTypes(),
        loadRequests(),
        accessState.isManager || isHr(context.roleKey) ? loadEmployees() : Promise.resolve(),
      ]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (form.employee_id) return;
    if (canManage && employees.length) {
      setForm((prev) => ({ ...prev, employee_id: employees[0].id }));
      return;
    }
    if (!canManage && employeeCtx?.employeeId) {
      setForm((prev) => ({ ...prev, employee_id: employeeCtx.employeeId }));
    }
  }, [canManage, employees, employeeCtx?.employeeId, form.employee_id]);

  useEffect(() => {
    if (!selectedLeaveType?.allows_half_day) {
      setForm((prev) => ({ ...prev, start_session: "full", end_session: "full" }));
    }
  }, [selectedLeaveType?.allows_half_day]);

  useEffect(() => {
    let active = true;

    if (!form.employee_id || !form.leave_type_id || !form.date_from || !form.date_to) {
      setPreviewRows([]);
      setPreviewError(null);
      return () => {
        active = false;
      };
    }

    (async () => {
      setPreviewLoading(true);
      const { data, error } = await supabase.rpc("erp_leave_request_preview", {
        p_employee_id: form.employee_id,
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
    form.employee_id,
    form.leave_type_id,
    form.date_from,
    form.date_to,
    form.start_session,
    form.end_session,
  ]);

  async function loadLeaveTypes() {
    const { data, error } = await supabase
      .from("erp_hr_leave_types")
      .select(
        "id, key, name, is_paid, is_active, allows_half_day, counts_weekly_off, counts_holiday, display_order"
      )
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setLeaveTypes((data as LeaveType[]) || []);
  }

  async function loadEmployees() {
    const { data, error } = await supabase
      .from("erp_employees")
      .select("id, full_name, employee_code")
      .order("full_name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setEmployees((data as EmployeeRow[]) || []);
  }

  async function loadRequests() {
    const { data, error } = await supabase
      .from("erp_hr_leave_requests")
      .select(
        "id, employee_id, leave_type_id, date_from, date_to, reason, status, approver_user_id, decided_at, decision_note, submitted_at, cancelled_at, start_session, end_session, employee:employee_id(full_name, employee_code), leave_type:leave_type_id(name)"
      )
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

  function openReviewModal(request: LeaveRequest, status: "approved" | "rejected") {
    setReviewModal({ open: true, request, status });
    setReviewNotes("");
  }

  function closeReviewModal() {
    setReviewModal({ open: false });
    setReviewNotes("");
  }

  async function submitReview() {
    if (!reviewModal.request || !reviewModal.status) return;
    if (!canManage) {
      setToast({ type: "error", message: "Only HR/admin/payroll can approve or reject." });
      return;
    }

    setSaving(true);

    const { error } = await supabase.rpc("erp_leave_request_decide", {
      p_request_id: reviewModal.request.id,
      p_decision: reviewModal.status,
      p_note: reviewNotes.trim() || null,
    });

    if (error) {
      setToast({ type: "error", message: error.message });
      setSaving(false);
      return;
    }

    setToast({
      type: "success",
      message: `Leave request ${reviewModal.status === "approved" ? "approved" : "rejected"}.`,
    });
    setSaving(false);
    closeReviewModal();
    await loadRequests();
  }

  async function saveDraft() {
    if (!form.employee_id) {
      setToast({ type: "error", message: "Please select an employee." });
      return null;
    }

    if (!form.leave_type_id || !form.date_from || !form.date_to) {
      setToast({ type: "error", message: "Leave type and date range are required." });
      return null;
    }

    const payload = {
      employee_id: form.employee_id,
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

    if (draftId) {
      const { data, error } = await supabase
        .from("erp_hr_leave_requests")
        .update(payload)
        .eq("id", draftId)
        .select("id")
        .maybeSingle();

      if (error) {
        setToast({ type: "error", message: error.message });
        setSaving(false);
        return null;
      }

      setToast({ type: "success", message: "Draft updated." });
      setSaving(false);
      await loadRequests();
      return data?.id ?? draftId;
    }

    const { data, error } = await supabase
      .from("erp_hr_leave_requests")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      setToast({ type: "error", message: error.message });
      setSaving(false);
      return null;
    }

    setToast({ type: "success", message: "Draft saved." });
    setSaving(false);
    setDraftId(data.id);
    await loadRequests();
    return data.id;
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
    await loadRequests();
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
    await loadRequests();
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
    await loadRequests();
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/");
  };

  if (loading) {
    return <div style={containerStyle}>Loading leave requests…</div>;
  }

  if (!ctx?.companyId) {
    return (
      <div style={containerStyle}>
        <h1 style={{ marginTop: 0 }}>Leave Requests</h1>
        <p style={{ color: "#b91c1c" }}>
          {ctx?.membershipError || "No active company membership found for this user."}
        </p>
        <button onClick={handleSignOut} style={buttonStyle}>
          Sign Out
        </button>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div style={containerStyle}>
        <p style={eyebrowStyle}>HR · Leave</p>
        <h1 style={titleStyle}>Leave Requests</h1>
        <p style={subtitleStyle}>You do not have access to manage leave requests.</p>
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
          <p style={eyebrowStyle}>HR · Leave</p>
          <h1 style={titleStyle}>Leave Requests</h1>
          <p style={subtitleStyle}>Create, preview, and action employee leave requests.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role:{" "}
            <strong>{ctx?.roleKey || access.roleKey || "member"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <a href="/erp/hr/leaves/types" style={linkStyle}>Manage Leave Types</a>
          <a href="/erp/hr" style={linkStyle}>← Back to HR Home</a>
        </div>
      </header>

      {toast ? (
        <div style={toast.type === "success" ? successBoxStyle : errorBoxStyle}>{toast.message}</div>
      ) : null}

      <section style={sectionStyle}>
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Create Leave Request</h3>
          <div style={formPreviewGridStyle}>
            <form style={formGridStyle}>
              <label style={labelStyle}>
                Employee
                <select
                  value={form.employee_id}
                  onChange={(e) => setForm((prev) => ({ ...prev, employee_id: e.target.value }))}
                  style={inputStyle}
                >
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name || "Employee"} ({employee.employee_code || employee.id})
                    </option>
                  ))}
                </select>
              </label>
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
                    Calculated days before submitting.
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
          <div style={toolbarStyle}>
            <label style={filterLabelStyle}>
              Status
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="all">All</option>
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              Employee
              <select
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                style={selectStyle}
              >
                <option value="all">All</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.full_name || "Employee"}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              Date from
              <input
                type="date"
                value={dateFromFilter}
                onChange={(e) => setDateFromFilter(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={filterLabelStyle}>
              Date to
              <input
                type="date"
                value={dateToFilter}
                onChange={(e) => setDateToFilter(e.target.value)}
                style={inputStyle}
              />
            </label>
            <span style={{ color: "#6b7280" }}>Total: {filteredRequests.length}</span>
          </div>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Employee</th>
                  <th style={thStyle}>Leave Type</th>
                  <th style={thStyle}>Dates</th>
                  <th style={thStyle}>Days</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Approver</th>
                  <th style={thStyle}>Decided At</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ ...tdStyle, textAlign: "center" }}>
                      No leave requests found.
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((req) => {
                    const countedDays = requestDaysMap[req.id];
                    return (
                      <tr key={req.id}>
                        <td style={tdStyle}>
                          <strong>{req.employee?.full_name || "Employee"}</strong>
                          <div style={{ color: "#6b7280" }}>{req.employee?.employee_code || req.employee_id}</div>
                        </td>
                        <td style={tdStyle}>{req.leave_type?.name || req.leave_type_id}</td>
                        <td style={tdStyle}>
                          {formatDate(req.date_from)} → {formatDate(req.date_to)}
                          <div style={{ color: "#6b7280", marginTop: 4 }}>
                            {formatSession(req.start_session)} → {formatSession(req.end_session)}
                          </div>
                        </td>
                        <td style={tdStyle}>
                          {typeof countedDays === "number" ? formatDayCount(countedDays) : "—"}
                        </td>
                        <td style={tdStyle}>{STATUS_LABELS[req.status] || req.status}</td>
                        <td style={tdStyle}>{req.approver_user_id || "—"}</td>
                        <td style={tdStyle}>{formatDateTime(req.decided_at)}</td>
                        <td style={tdStyle}>
                          {req.reason || "—"}
                          {req.decision_note ? (
                            <div style={{ marginTop: 6, color: "#6b7280" }}>
                              Decision: {req.decision_note}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right" }}>
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                            {req.status === "draft" ? (
                              <button
                                type="button"
                                onClick={() => submitRequest(req.id)}
                                style={primaryButtonStyle}
                              >
                                Submit
                              </button>
                            ) : null}
                            {req.status === "submitted" || req.status === "approved" ? (
                              <button type="button" onClick={() => cancelRequest(req.id)} style={buttonStyle}>
                                Cancel
                              </button>
                            ) : null}
                            {req.status === "submitted" ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => openReviewModal(req, "approved")}
                                  style={primaryButtonStyle}
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openReviewModal(req, "rejected")}
                                  style={buttonStyle}
                                >
                                  Reject
                                </button>
                              </>
                            ) : null}
                            {req.status !== "draft" && req.status !== "submitted" ? (
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

      {reviewModal.open && reviewModal.request && reviewModal.status ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <div style={modalHeaderStyle}>
              <div>
                <h3 style={{ margin: 0 }}>
                  {reviewModal.status === "approved" ? "Approve" : "Reject"} Leave Request
                </h3>
                <p style={{ margin: "4px 0 0", color: "#6b7280" }}>
                  {reviewModal.request.employee?.full_name || "Employee"} ·{" "}
                  {formatDate(reviewModal.request.date_from)} → {formatDate(reviewModal.request.date_to)}
                </p>
              </div>
              <button type="button" onClick={closeReviewModal} style={buttonStyle}>Close</button>
            </div>
            <label style={labelStyle}>
              Reviewer notes
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                style={textareaStyle}
                rows={4}
                placeholder="Optional notes for the employee"
              />
            </label>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button type="button" onClick={closeReviewModal} style={buttonStyle}>Cancel</button>
              <button type="button" onClick={submitReview} style={primaryButtonStyle} disabled={saving}>
                {saving ? "Saving..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
  maxWidth: 1200,
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

const toolbarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
};

const filterLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontWeight: 600,
  color: "#111827",
};

const selectStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
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

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.4)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  zIndex: 40,
};

const modalCardStyle: CSSProperties = {
  width: "min(640px, 100%)",
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 24,
  boxShadow: "0 16px 40px rgba(15, 23, 42, 0.2)",
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
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
