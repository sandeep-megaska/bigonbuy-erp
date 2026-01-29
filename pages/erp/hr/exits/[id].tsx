import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  h1Style,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type ExitDetail = {
  exit: any;
  employee: any;
  manager: any;
  exit_type: any;
  exit_reason: any;
};

type ToastState = { type: "success" | "error"; message: string } | null;

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function renderStatusBadge(status: string) {
  const normalized = status?.toLowerCase() || "draft";
  const colors: Record<string, CSSProperties> = {
    draft: { backgroundColor: "#e0f2fe", color: "#0369a1" },
    approved: { backgroundColor: "#dcfce7", color: "#166534" },
    rejected: { backgroundColor: "#fee2e2", color: "#b91c1c" },
    completed: { backgroundColor: "#e5e7eb", color: "#1f2937" },
  };
  return <span style={{ ...badgeStyle, ...colors[normalized] }}>{status}</span>;
}

export default function EmployeeExitDetailPage() {
  const router = useRouter();
  const exitId = useMemo(() => {
    const param = router.query.id;
    return Array.isArray(param) ? param[0] : param;
  }, [router.query.id]);

  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [exitData, setExitData] = useState<ExitDetail | null>(null);
  const [error, setError] = useState<string>("");
  const [toast, setToast] = useState<ToastState>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [settlementId, setSettlementId] = useState<string | null>(null);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [rejectModal, setRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );
  const isHrAdmin = useMemo(() => isHr(ctx?.roleKey), [ctx?.roleKey]);

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

      await loadExit();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, exitId]);

  async function loadExit() {
    if (!exitId) return;
    setError("");
    const { data, error: loadError } = await supabase.rpc("erp_hr_exit_get", {
      p_exit_id: exitId,
    });
    if (loadError) {
      setError(loadError.message || "Unable to load exit details.");
      return;
    }
    if (!data) {
      setError("Exit request not found.");
      return;
    }
    setExitData(data as ExitDetail);
    await loadSettlementId();
  }

  async function loadSettlementId() {
    if (!exitId) return;
    setSettlementLoading(true);
    const { data, error: settlementError } = await supabase.rpc(
      "erp_hr_final_settlement_by_exit_get",
      { p_exit_id: exitId }
    );
    if (settlementError) {
      setSettlementId(null);
      setSettlementLoading(false);
      return;
    }
    setSettlementId((data as string) ?? null);
    setSettlementLoading(false);
  }

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ type, message });
    setTimeout(() => setToast(null), 2500);
  }

  async function handleStatusChange(status: "approved" | "rejected" | "completed") {
    if (!exitData?.exit?.id || !canManage) {
      showToast("You do not have permission to update exit requests.", "error");
      return;
    }

    if (status === "rejected") {
      setRejectModal(true);
      return;
    }

    await submitStatus(status);
  }

  async function submitStatus(status: "approved" | "rejected" | "completed", reason?: string) {
    if (!exitData?.exit?.id) return;
    setActionLoading(true);
    const { error: updateError } = await supabase.rpc("erp_hr_exit_set_status", {
      p_exit_id: exitData.exit.id,
      p_status: status,
      p_rejection_reason: reason ?? null,
    });

    if (updateError) {
      showToast(updateError.message || "Unable to update exit request.", "error");
      setActionLoading(false);
      return;
    }

    showToast(`Exit request ${status} successfully.`);
    setActionLoading(false);
    await loadExit();
  }

  async function handleSettlementCTA() {
    if (!exitRecord?.id) return;
    if (settlementId) {
      router.push(`/erp/hr/final-settlements/${settlementId}`);
      return;
    }

    setActionLoading(true);
    const { data, error: createError } = await supabase.rpc(
      "erp_hr_final_settlement_upsert_header",
      {
        p_settlement_id: null,
        p_exit_id: exitRecord.id,
        p_notes: null,
      }
    );

    if (createError) {
      showToast(createError.message || "Unable to create settlement draft.", "error");
      setActionLoading(false);
      return;
    }

    setActionLoading(false);
    const newSettlementId = (data as string | null) ?? null;
    setSettlementId(newSettlementId);
    if (newSettlementId) {
      router.push(`/erp/hr/final-settlements/${newSettlementId}`);
    } else {
      await loadSettlementId();
    }
  }

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading exit details…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Exit Request</h1>
          <p style={{ color: "#b91c1c" }}>No active company membership found.</p>
        </div>
      </ErpShell>
    );
  }

  const exitRecord = exitData?.exit;
  const employee = exitData?.employee;
  const manager = exitData?.manager;
  const exitType = exitData?.exit_type;
  const exitReason = exitData?.exit_reason;

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={subtitleStyle}>HR · Employee Exits</p>
            <h1 style={h1Style}>Exit Request</h1>
            <p style={subtitleStyle}>
              Manage approvals, completion, and exit history for the selected employee.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href="/erp/hr/exits" style={{ color: "#2563eb", textDecoration: "none" }}>
              Back to Exits
            </Link>
          </div>
        </header>

        {toast ? (
          <div
            style={{
              ...cardStyle,
              borderColor: toast.type === "success" ? "#86efac" : "#fecaca",
              backgroundColor: toast.type === "success" ? "#ecfdf3" : "#fff1f2",
              color: toast.type === "success" ? "#166534" : "#b91c1c",
            }}
          >
            {toast.message}
          </div>
        ) : null}

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", color: "#b91c1c" }}>{error}</div>
        ) : null}

        {exitRecord ? (
          <div style={{ display: "grid", gap: 16 }}>
            <section style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>Employee</div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {employee?.full_name || "Unnamed"}
                  </div>
                  <div style={{ color: "#6b7280" }}>{employee?.employee_code || "—"}</div>
                </div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  {renderStatusBadge(exitRecord.status)}
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
                <div><strong>Last working day:</strong> {formatDate(exitRecord.last_working_day)}</div>
                <div><strong>Exit type:</strong> {exitType?.name || "—"}</div>
                <div><strong>Exit reason:</strong> {exitReason?.name || "—"}</div>
                <div><strong>Manager:</strong> {manager?.full_name || "—"}</div>
              </div>
            </section>

            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Exit Details</h3>
              <div style={{ display: "grid", gap: 8 }}>
                <div><strong>Initiated on:</strong> {formatDate(exitRecord.initiated_on)}</div>
                <div><strong>Notice period days:</strong> {exitRecord.notice_period_days ?? "—"}</div>
                <div><strong>Notice waived:</strong> {exitRecord.notice_waived ? "Yes" : "No"}</div>
                <div><strong>Notes:</strong> {exitRecord.notes || "—"}</div>
              </div>
            </section>

            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Approvals Timeline</h3>
              <div style={{ display: "grid", gap: 8 }}>
                <div><strong>Initiated:</strong> {formatDate(exitRecord.created_at)}</div>
                <div><strong>Approved:</strong> {formatDate(exitRecord.approved_at)}</div>
                <div><strong>Rejected:</strong> {formatDate(exitRecord.rejected_at)}</div>
                <div><strong>Completed:</strong> {formatDate(exitRecord.completed_at)}</div>
                <div><strong>Rejection reason:</strong> {exitRecord.rejection_reason || "—"}</div>
              </div>
            </section>

            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Actions</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {exitRecord.status === "draft" && canManage ? (
                  <>
                    <button
                      type="button"
                      style={primaryButtonStyle}
                      disabled={actionLoading}
                      onClick={() => handleStatusChange("approved")}
                    >
                      {actionLoading ? "Updating…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      disabled={actionLoading}
                      onClick={() => handleStatusChange("rejected")}
                    >
                      {actionLoading ? "Updating…" : "Reject"}
                    </button>
                  </>
                ) : null}
                {exitRecord.status === "approved" && isHrAdmin ? (
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    disabled={actionLoading}
                    onClick={() => handleStatusChange("completed")}
                  >
                    {actionLoading ? "Completing…" : "Complete"}
                  </button>
                ) : null}
                {!canManage ? (
                  <span style={{ color: "#6b7280" }}>You do not have access to manage exits.</span>
                ) : null}
              </div>
            </section>

            <section style={cardStyle}>
              <h3 style={{ marginTop: 0 }}>Final Settlement</h3>
              <p style={{ color: "#6b7280", marginTop: 4 }}>
                Create or open the HR settlement statement tied to this exit.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  style={primaryButtonStyle}
                  disabled={
                    !isHrAdmin ||
                    actionLoading ||
                    settlementLoading ||
                    (!settlementId && !["approved", "completed"].includes(exitRecord.status))
                  }
                  onClick={handleSettlementCTA}
                >
                  {settlementLoading
                    ? "Checking…"
                    : settlementId
                      ? "Open Final Settlement"
                      : "Create Final Settlement"}
                </button>
                {exitRecord.status !== "approved" && exitRecord.status !== "completed" ? (
                  <span style={{ fontSize: 12, color: "#6b7280" }}>
                    Settlement can be created once the exit is approved.
                  </span>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
      </div>

      {rejectModal ? (
        <div style={modalOverlayStyle}>
          <div style={modalCardStyle}>
            <h3 style={{ marginTop: 0 }}>Reject Exit Request</h3>
            <p style={{ color: "#6b7280", marginTop: 4 }}>
              Provide an optional rejection reason.
            </p>
            <textarea
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              rows={4}
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => {
                  setRejectModal(false);
                  setRejectionReason("");
                }}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={actionLoading}
                onClick={async () => {
                  const reason = rejectionReason;
                  setRejectModal(false);
                  setRejectionReason("");
                  await submitStatus("rejected", reason);
                }}
              >
                {actionLoading ? "Rejecting…" : "Reject"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ErpShell>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 14,
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.35)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};

const modalCardStyle: CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 20,
  width: "100%",
  maxWidth: 520,
  boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25)",
  display: "grid",
  gap: 12,
};
