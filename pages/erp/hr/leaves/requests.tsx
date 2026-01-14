import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpNavBar from "../../../../components/erp/ErpNavBar";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
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

type LeaveRequest = {
  id: string;
  employee_id: string;
  leave_type_code: string;
  start_date: string;
  end_date: string;
  days: number;
  reason: string | null;
  status: string;
  reviewer_notes: string | null;
  reviewed_at: string | null;
  employee?: { full_name?: string | null; employee_code?: string | null } | null;
};

type LeaveType = {
  code: string;
  name: string;
  is_paid: boolean;
};

type ReviewModalState = {
  open: boolean;
  request?: LeaveRequest;
  status?: "approved" | "rejected";
};

type ToastState = { type: "success" | "error"; message: string } | null;

export default function HrLeaveRequestsPage() {
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
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [toast, setToast] = useState<ToastState>(null);
  const [reviewModal, setReviewModal] = useState<ReviewModalState>({ open: false });
  const [reviewNotes, setReviewNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const leaveTypeMap = useMemo(() => {
    return leaveTypes.reduce<Record<string, LeaveType>>((acc, type) => {
      acc[type.code] = type;
      return acc;
    }, {});
  }, [leaveTypes]);

  const filteredRequests = useMemo(() => {
    if (statusFilter === "all") return requests;
    return requests.filter((req) => req.status === statusFilter);
  }, [requests, statusFilter]);

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

      setAccess({
        ...accessState,
        roleKey: accessState.roleKey ?? context.roleKey ?? undefined,
      });
      setCtx(context);

      if (!context.companyId) {
        setLoading(false);
        return;
      }

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
      .order("name", { ascending: true });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setLeaveTypes((data as LeaveType[]) || []);
  }

  async function loadRequests() {
    const { data, error } = await supabase
      .from("erp_leave_requests")
      .select(
        "id, employee_id, leave_type_code, start_date, end_date, days, reason, status, reviewer_notes, reviewed_at, employee:employee_id(full_name, employee_code)"
      )
      .order("created_at", { ascending: false });

    if (error) {
      setToast({ type: "error", message: error.message });
      return;
    }

    setRequests((data as LeaveRequest[]) || []);
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

    const { error } = await supabase.rpc("erp_leave_request_set_status", {
      p_request_id: reviewModal.request.id,
      p_status: reviewModal.status,
      p_reviewer_notes: reviewNotes.trim() || null,
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

  return (
    <div style={containerStyle}>
      <ErpNavBar access={access} roleKey={ctx?.roleKey} />

      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>HR · Leave</p>
          <h1 style={titleStyle}>Leave Requests</h1>
          <p style={subtitleStyle}>Review and action employee leave submissions.</p>
          <p style={{ margin: "8px 0 0", color: "#4b5563" }}>
            Signed in as <strong>{ctx?.email}</strong> · Role: {" "}
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
                <th style={thStyle}>Notes</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ ...tdStyle, textAlign: "center" }}>
                    No leave requests found.
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => {
                  const leaveType = leaveTypeMap[req.leave_type_code];
                  return (
                    <tr key={req.id}>
                      <td style={tdStyle}>
                        <strong>{req.employee?.full_name || "Employee"}</strong>
                        <div style={{ color: "#6b7280" }}>{req.employee?.employee_code || req.employee_id}</div>
                      </td>
                      <td style={tdStyle}>
                        {leaveType ? leaveType.name : req.leave_type_code}
                        {leaveType ? (
                          <div style={{ color: "#6b7280" }}>{leaveType.is_paid ? "Paid" : "Unpaid"}</div>
                        ) : null}
                      </td>
                      <td style={tdStyle}>
                        {formatDate(req.start_date)} → {formatDate(req.end_date)}
                      </td>
                      <td style={tdStyle}>{req.days || "—"}</td>
                      <td style={tdStyle}>{STATUS_LABELS[req.status] || req.status}</td>
                      <td style={tdStyle}>
                        {req.reason || "—"}
                        {req.reviewer_notes ? (
                          <div style={{ marginTop: 6, color: "#6b7280" }}>
                            Reviewer: {req.reviewer_notes}
                          </div>
                        ) : null}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        {req.status === "submitted" ? (
                          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
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
                          </div>
                        ) : (
                          <span style={{ color: "#6b7280" }}>No actions</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
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
                  {reviewModal.request.employee?.full_name || "Employee"} · {" "}
                  {formatDate(reviewModal.request.start_date)} → {formatDate(reviewModal.request.end_date)}
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

const containerStyle: CSSProperties = {
  maxWidth: 1150,
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

const sectionStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 16 };

const toolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
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

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontWeight: 600,
  color: "#111827",
};

const textareaStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  resize: "vertical",
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
