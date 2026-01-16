import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/router";
import type { CSSProperties } from "react";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type ExitRowRaw = {
  id: string;
  status: string;
  initiated_on: string | null;
  last_working_day: string | null;
  notice_period_days: number | null;
  notice_waived: boolean | null;
  notes: string | null;
  approved_at: string | null;
  completed_at: string | null;
  employee: { id: string; full_name: string | null; employee_code: string | null }[] | null;
  manager: { id: string; full_name: string | null; employee_code: string | null }[] | null;
  exit_type: { id: string; name: string | null }[] | null;
  exit_reason: { id: string; name: string | null }[] | null;
};

type ExitRow = {
  id: string;
  status: string;
  initiated_on: string | null;
  last_working_day: string | null;
  notice_period_days: number | null;
  notice_waived: boolean | null;
  notes: string | null;
  approved_at: string | null;
  completed_at: string | null;
  employee: { id: string; full_name: string | null; employee_code: string | null } | null;
  manager: { id: string; full_name: string | null; employee_code: string | null } | null;
  exit_type: { id: string; name: string | null } | null;
  exit_reason: { id: string; name: string | null } | null;
};

type Settlement = {
  id: string;
  status: string;
  notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  payment_mode: string | null;
  payment_reference: string | null;
};

type SettlementItem = {
  id: string;
  kind: "earning" | "deduction";
  code: string | null;
  name: string;
  amount: number;
  notes: string | null;
  sort_order: number;
};

type SettlementClearance = {
  id: string;
  department: string;
  item: string;
  is_done: boolean;
  done_at: string | null;
  done_by_user_id: string | null;
  notes: string | null;
  sort_order: number;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const paymentModes = [
  { value: "", label: "Select payment mode" },
  { value: "bank", label: "Bank" },
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "other", label: "Other" },
];

export default function ExitDetailPage() {
  const router = useRouter();
  const exitId = typeof router.query.id === "string" ? router.query.id : "";
  const [ctx, setCtx] = useState<any>(null);
  const [access, setAccess] = useState<ErpAccessState>({
    isAuthenticated: false,
    isManager: false,
    roleKey: undefined,
  });
  const [loading, setLoading] = useState(true);
  const [exitRecord, setExitRecord] = useState<ExitRow | null>(null);
  const [exitLoading, setExitLoading] = useState(false);
  const [settlementLoading, setSettlementLoading] = useState(false);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [items, setItems] = useState<SettlementItem[]>([]);
  const [clearances, setClearances] = useState<SettlementClearance[]>([]);
  const [activeTab, setActiveTab] = useState<"details" | "settlement">("details");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [itemForm, setItemForm] = useState({
    kind: "earning",
    code: "",
    name: "",
    amount: "",
    notes: "",
  });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [clearanceForm, setClearanceForm] = useState({
    department: "",
    item: "",
    notes: "",
  });
  const [paymentForm, setPaymentForm] = useState({
    payment_mode: "",
    payment_reference: "",
  });
  const [settlementNotes, setSettlementNotes] = useState("");

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const settlementReady = exitRecord?.status === "approved" || exitRecord?.status === "completed";
  const settlementStatus = settlement?.status || "draft";
  const settlementLocked = settlementStatus !== "draft";

  const totals = useMemo(() => {
    const earnings = items
      .filter((item) => item.kind === "earning")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const deductions = items
      .filter((item) => item.kind === "deduction")
      .reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      earnings,
      deductions,
      net: earnings - deductions,
    };
  }, [items]);

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

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!ctx?.companyId || !exitId) return;
    loadExit();
    loadSettlement();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx?.companyId, exitId]);

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ type, message });
    setTimeout(() => setToast(null), 2500);
  }

  async function loadExit() {
    setExitLoading(true);
    const { data, error } = await supabase
      .from("erp_hr_employee_exits")
      .select(
        `
        id,
        status,
        initiated_on,
        last_working_day,
        notice_period_days,
        notice_waived,
        notes,
        approved_at,
        completed_at,
        employee:erp_employees!erp_hr_employee_exits_employee_id_fkey (
          id, full_name, employee_code
        ),
        manager:erp_employees!erp_hr_employee_exits_manager_employee_id_fkey (
          id, full_name, employee_code
        ),
        exit_type:erp_hr_employee_exit_types ( id, name ),
        exit_reason:erp_hr_employee_exit_reasons ( id, name )
      `
      )
      .eq("id", exitId)
      .maybeSingle();

    if (error) {
      setExitLoading(false);
      showToast(error.message || "Unable to load exit details.", "error");
      return;
    }

    const raw = (data ?? null) as ExitRowRaw | null;
    if (!raw) {
      setExitRecord(null);
      setExitLoading(false);
      return;
    }

    setExitRecord({
      id: raw.id,
      status: raw.status,
      initiated_on: raw.initiated_on,
      last_working_day: raw.last_working_day,
      notice_period_days: raw.notice_period_days,
      notice_waived: raw.notice_waived,
      notes: raw.notes,
      approved_at: raw.approved_at,
      completed_at: raw.completed_at,
      employee: raw.employee?.[0] ?? null,
      manager: raw.manager?.[0] ?? null,
      exit_type: raw.exit_type?.[0] ?? null,
      exit_reason: raw.exit_reason?.[0] ?? null,
    });
    setExitLoading(false);
  }

  async function loadSettlement() {
    setSettlementLoading(true);
    const { data, error } = await supabase.rpc("erp_hr_final_settlement_get", {
      p_exit_id: exitId,
    });

    if (error) {
      setSettlementLoading(false);
      showToast(error.message || "Unable to load final settlement.", "error");
      return;
    }

    const settlementData = data?.settlement ?? null;
    setSettlement(settlementData?.id ? settlementData : null);
    setSettlementNotes(settlementData?.notes || "");
    const rawItems = (data?.items ?? []) as SettlementItem[];
    const rawClearances = (data?.clearances ?? []) as SettlementClearance[];
    setItems(
      rawItems.map((item) => ({
        ...item,
        amount: Number(item.amount || 0),
      }))
    );
    setClearances(rawClearances);
    setPaymentForm({
      payment_mode: settlementData?.payment_mode || "",
      payment_reference: settlementData?.payment_reference || "",
    });
    setSettlementLoading(false);
  }

  async function handleExitAction(action: "submit" | "approve" | "reject" | "complete") {
    if (!canManage) {
      showToast("You do not have permission to update exit requests.", "error");
      return;
    }

    if (!exitRecord?.id) return;

    let reason: string | null = null;
    if (action === "reject") {
      reason = window.prompt("Rejection reason (optional)") || "";
    }

    setActionLoading(action);
    const rpcName =
      action === "submit"
        ? "erp_hr_employee_exit_submit"
        : action === "approve"
          ? "erp_hr_employee_exit_approve"
          : action === "reject"
            ? "erp_hr_employee_exit_reject"
            : "erp_hr_employee_exit_complete";
    const payload =
      action === "reject" ? { p_exit_id: exitRecord.id, p_reason: reason } : { p_exit_id: exitRecord.id };
    const { error } = await supabase.rpc(rpcName, payload);

    if (error) {
      showToast(error.message || "Unable to update exit request.", "error");
      setActionLoading(null);
      return;
    }

    showToast(`Exit request ${action}d successfully.`);
    await loadExit();
    await loadSettlement();
    setActionLoading(null);
  }

  async function ensureSettlement() {
    if (settlement?.id) return settlement.id;
    const { data, error } = await supabase.rpc("erp_hr_final_settlement_upsert", {
      p_exit_id: exitId,
      p_notes: settlementNotes || null,
    });
    if (error) {
      showToast(error.message || "Unable to create final settlement.", "error");
      return null;
    }
    await loadSettlement();
    return data as string;
  }

  async function handleSaveSettlementNotes() {
    if (!canManage) {
      showToast("You do not have permission to edit settlement notes.", "error");
      return;
    }

    if (!settlementReady) {
      showToast("Final settlement is available after exit approval.", "error");
      return;
    }

    const settlementId = await ensureSettlement();
    if (!settlementId) return;
    const { error } = await supabase
      .from("erp_hr_final_settlements")
      .update({ notes: settlementNotes })
      .eq("id", settlementId);

    if (error) {
      showToast(error.message || "Unable to update settlement notes.", "error");
      return;
    }

    showToast("Settlement notes updated.");
    await loadSettlement();
  }

  async function handleAddItem(event: FormEvent) {
    event.preventDefault();
    if (!canManage) {
      showToast("You do not have permission to manage settlement items.", "error");
      return;
    }

    if (settlementLocked) {
      showToast("Settlement is locked after submission.", "error");
      return;
    }

    if (!itemForm.name || !itemForm.amount) {
      showToast("Please provide a name and amount.", "error");
      return;
    }

    const settlementId = await ensureSettlement();
    if (!settlementId) return;

    const payload = {
      company_id: ctx?.companyId,
      settlement_id: settlementId,
      kind: itemForm.kind,
      code: itemForm.code || null,
      name: itemForm.name,
      amount: Number(itemForm.amount),
      notes: itemForm.notes || null,
      sort_order: items.length + 1,
    };

    const { error } = await supabase.from("erp_hr_final_settlement_items").insert(payload);
    if (error) {
      showToast(error.message || "Unable to add settlement item.", "error");
      return;
    }

    setItemForm({ kind: "earning", code: "", name: "", amount: "", notes: "" });
    showToast("Settlement item added.");
    await loadSettlement();
  }

  async function handleUpdateItem() {
    if (!canManage || !editingItemId) return;
    if (settlementLocked) {
      showToast("Settlement is locked after submission.", "error");
      return;
    }

    if (!itemForm.name || !itemForm.amount) {
      showToast("Please provide a name and amount.", "error");
      return;
    }

    const { error } = await supabase
      .from("erp_hr_final_settlement_items")
      .update({
        kind: itemForm.kind,
        code: itemForm.code || null,
        name: itemForm.name,
        amount: Number(itemForm.amount),
        notes: itemForm.notes || null,
      })
      .eq("id", editingItemId);

    if (error) {
      showToast(error.message || "Unable to update settlement item.", "error");
      return;
    }

    setEditingItemId(null);
    setItemForm({ kind: "earning", code: "", name: "", amount: "", notes: "" });
    showToast("Settlement item updated.");
    await loadSettlement();
  }

  async function handleDeleteItem(itemId: string) {
    if (!canManage) {
      showToast("You do not have permission to delete settlement items.", "error");
      return;
    }

    if (settlementLocked) {
      showToast("Settlement is locked after submission.", "error");
      return;
    }

    const confirmed = window.confirm("Delete this settlement item?");
    if (!confirmed) return;

    const { error } = await supabase.from("erp_hr_final_settlement_items").delete().eq("id", itemId);
    if (error) {
      showToast(error.message || "Unable to delete settlement item.", "error");
      return;
    }

    showToast("Settlement item deleted.");
    await loadSettlement();
  }

  async function handleAddClearance(event: FormEvent) {
    event.preventDefault();
    if (!canManage) {
      showToast("You do not have permission to manage clearances.", "error");
      return;
    }

    if (settlementLocked) {
      showToast("Settlement is locked after submission.", "error");
      return;
    }

    if (!clearanceForm.department || !clearanceForm.item) {
      showToast("Please provide department and item.", "error");
      return;
    }

    const settlementId = await ensureSettlement();
    if (!settlementId) return;

    const payload = {
      company_id: ctx?.companyId,
      settlement_id: settlementId,
      department: clearanceForm.department,
      item: clearanceForm.item,
      notes: clearanceForm.notes || null,
      sort_order: clearances.length + 1,
    };

    const { error } = await supabase.from("erp_hr_final_settlement_clearances").insert(payload);
    if (error) {
      showToast(error.message || "Unable to add clearance item.", "error");
      return;
    }

    setClearanceForm({ department: "", item: "", notes: "" });
    showToast("Clearance item added.");
    await loadSettlement();
  }

  async function handleToggleClearance(clearance: SettlementClearance, nextValue: boolean) {
    if (!canManage) {
      showToast("You do not have permission to update clearances.", "error");
      return;
    }

    const { error } = await supabase
      .from("erp_hr_final_settlement_clearances")
      .update({
        is_done: nextValue,
        done_at: nextValue ? new Date().toISOString() : null,
        done_by_user_id: nextValue ? ctx?.userId ?? null : null,
      })
      .eq("id", clearance.id);

    if (error) {
      showToast(error.message || "Unable to update clearance item.", "error");
      return;
    }

    await loadSettlement();
  }

  async function handleDeleteClearance(clearanceId: string) {
    if (!canManage) {
      showToast("You do not have permission to delete clearances.", "error");
      return;
    }

    if (settlementLocked) {
      showToast("Settlement is locked after submission.", "error");
      return;
    }

    const confirmed = window.confirm("Delete this clearance item?");
    if (!confirmed) return;

    const { error } = await supabase.from("erp_hr_final_settlement_clearances").delete().eq("id", clearanceId);
    if (error) {
      showToast(error.message || "Unable to delete clearance item.", "error");
      return;
    }

    showToast("Clearance item deleted.");
    await loadSettlement();
  }

  async function handleSettlementStatus(nextStatus: "submitted" | "approved" | "paid") {
    if (!canManage) {
      showToast("You do not have permission to update settlement status.", "error");
      return;
    }

    if (!settlementReady) {
      showToast("Final settlement is available after exit approval.", "error");
      return;
    }

    const settlementId = await ensureSettlement();
    if (!settlementId) return;

    if (nextStatus === "paid" && !paymentForm.payment_mode) {
      showToast("Select payment mode before marking paid.", "error");
      return;
    }

    const { error } = await supabase.rpc("erp_hr_final_settlement_set_status", {
      p_settlement_id: settlementId,
      p_status: nextStatus,
      p_payment_mode: paymentForm.payment_mode || null,
      p_payment_reference: paymentForm.payment_reference || null,
    });

    if (error) {
      showToast(error.message || "Unable to update settlement status.", "error");
      return;
    }

    showToast("Settlement status updated.");
    await loadSettlement();
  }

  function renderStatusBadge(status: string) {
    const normalized = status?.toLowerCase() || "draft";
    const colors: Record<string, CSSProperties> = {
      draft: { backgroundColor: "#e0f2fe", color: "#0369a1" },
      submitted: { backgroundColor: "#fef3c7", color: "#b45309" },
      approved: { backgroundColor: "#dcfce7", color: "#166534" },
      paid: { backgroundColor: "#dbeafe", color: "#1d4ed8" },
      rejected: { backgroundColor: "#fee2e2", color: "#b91c1c" },
      completed: { backgroundColor: "#e5e7eb", color: "#1f2937" },
      withdrawn: { backgroundColor: "#e5e7eb", color: "#1f2937" },
    };
    return <span style={{ ...badgeStyle, ...colors[normalized] }}>{status}</span>;
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
          <h1 style={{ ...h1Style, marginTop: 0 }}>Employee Exit</h1>
          <p style={{ color: "#b91c1c" }}>No active company membership found.</p>
        </div>
      </ErpShell>
    );
  }

  if (!exitId) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>
          <h1 style={{ ...h1Style, marginTop: 0 }}>Employee Exit</h1>
          <p style={{ color: "#b91c1c" }}>Missing exit ID.</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>HR · Exits</p>
            <h1 style={h1Style}>Exit Details</h1>
            <p style={subtitleStyle}>
              Review exit approvals and manage the final settlement workflow.
            </p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href="/erp/hr" style={{ color: "#2563eb", textDecoration: "none" }}>
              HR Home
            </Link>
            <Link href="/erp/hr/exits" style={{ color: "#2563eb", textDecoration: "none" }}>
              Employee Exits
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

        <section style={cardStyle}>
          <div style={tabHeaderStyle}>
            <button
              type="button"
              onClick={() => setActiveTab("details")}
              style={activeTab === "details" ? activeTabStyle : tabStyle}
            >
              Details
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("settlement")}
              style={activeTab === "settlement" ? activeTabStyle : tabStyle}
            >
              Final Settlement
            </button>
          </div>
        </section>

        {activeTab === "details" ? (
          <section style={cardStyle}>
            {exitLoading ? <p style={{ color: "#6b7280" }}>Loading exit details…</p> : null}
            {!exitRecord ? (
              <p style={{ margin: 0, color: "#6b7280" }}>Exit request not found.</p>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>{exitRecord.employee?.full_name || "Employee"}</div>
                    <div style={{ color: "#6b7280", fontSize: 13 }}>
                      {exitRecord.employee?.employee_code || "No employee code"}
                    </div>
                  </div>
                  {renderStatusBadge(exitRecord.status)}
                </div>

                <div style={detailGridStyle}>
                  <div>
                    <div style={detailLabelStyle}>Exit Type</div>
                    <div>{exitRecord.exit_type?.name || "—"}</div>
                  </div>
                  <div>
                    <div style={detailLabelStyle}>Reason</div>
                    <div>{exitRecord.exit_reason?.name || "—"}</div>
                  </div>
                  <div>
                    <div style={detailLabelStyle}>Initiated</div>
                    <div>{formatDate(exitRecord.initiated_on)}</div>
                  </div>
                  <div>
                    <div style={detailLabelStyle}>Last Working Day</div>
                    <div>{formatDate(exitRecord.last_working_day)}</div>
                  </div>
                  <div>
                    <div style={detailLabelStyle}>Notice Period</div>
                    <div>
                      {exitRecord.notice_period_days
                        ? `${exitRecord.notice_period_days} days${exitRecord.notice_waived ? " (waived)" : ""}`
                        : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={detailLabelStyle}>Manager</div>
                    <div>{exitRecord.manager?.full_name || "—"}</div>
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={detailLabelStyle}>Notes</div>
                    <div>{exitRecord.notes || "—"}</div>
                  </div>
                </div>

                {canManage ? (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    {exitRecord.status === "draft" ? (
                      <button
                        type="button"
                        style={primaryButtonStyle}
                        disabled={actionLoading !== null}
                        onClick={() => handleExitAction("submit")}
                      >
                        {actionLoading === "submit" ? "Submitting…" : "Submit for Approval"}
                      </button>
                    ) : null}
                    {exitRecord.status === "submitted" ? (
                      <>
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          disabled={actionLoading !== null}
                          onClick={() => handleExitAction("approve")}
                        >
                          {actionLoading === "approve" ? "Approving…" : "Approve Exit"}
                        </button>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          disabled={actionLoading !== null}
                          onClick={() => handleExitAction("reject")}
                        >
                          {actionLoading === "reject" ? "Rejecting…" : "Reject Exit"}
                        </button>
                      </>
                    ) : null}
                    {exitRecord.status === "approved" ? (
                      <button
                        type="button"
                        style={primaryButtonStyle}
                        disabled={actionLoading !== null}
                        onClick={() => handleExitAction("complete")}
                      >
                        {actionLoading === "complete" ? "Completing…" : "Mark Completed"}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <div style={{ color: "#6b7280", fontSize: 13 }}>Read-only access.</div>
                )}
              </div>
            )}
          </section>
        ) : null}

        {activeTab === "settlement" ? (
          <section style={cardStyle}>
            {settlementLoading ? <p style={{ color: "#6b7280" }}>Loading final settlement…</p> : null}

            {!settlementReady ? (
              <div style={{ color: "#b91c1c", fontSize: 14 }}>
                Final settlement is available once the exit is approved.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 18 }}>
                <div style={settlementHeaderStyle}>
                  <div>
                    <div style={{ color: "#6b7280", fontSize: 13, textTransform: "uppercase" }}>Status</div>
                    <div style={{ marginTop: 6 }}>
                      {renderStatusBadge(settlementStatus)}
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>Total Earnings</div>
                    <div style={{ fontWeight: 700 }}>{formatCurrency(totals.earnings)}</div>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>Total Deductions</div>
                    <div style={{ fontWeight: 700 }}>{formatCurrency(totals.deductions)}</div>
                  </div>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>Net Payable</div>
                    <div style={{ fontWeight: 700 }}>{formatCurrency(totals.net)}</div>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div style={sectionHeaderStyle}>
                    <h3 style={{ margin: 0 }}>Settlement Notes</h3>
                    {settlementLocked ? (
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Locked</span>
                    ) : null}
                  </div>
                  <textarea
                    value={settlementNotes}
                    onChange={(event) => setSettlementNotes(event.target.value)}
                    style={{ ...inputStyle, minHeight: 80 }}
                    disabled={settlementLocked || !canManage}
                    placeholder="Optional notes for the settlement."
                  />
                  <div>
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={handleSaveSettlementNotes}
                      disabled={settlementLocked || !canManage}
                    >
                      Save Notes
                    </button>
                  </div>
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div style={sectionHeaderStyle}>
                    <h3 style={{ margin: 0 }}>Settlement Line Items</h3>
                    {settlementLocked ? (
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Locked</span>
                    ) : null}
                  </div>

                  {canManage && !settlementLocked ? (
                    <form onSubmit={editingItemId ? undefined : handleAddItem} style={formGridStyle}>
                      <label style={labelStyle}>
                        Type
                        <select
                          value={itemForm.kind}
                          onChange={(event) => setItemForm({ ...itemForm, kind: event.target.value })}
                          style={inputStyle}
                        >
                          <option value="earning">Earning</option>
                          <option value="deduction">Deduction</option>
                        </select>
                      </label>
                      <label style={labelStyle}>
                        Code
                        <input
                          type="text"
                          value={itemForm.code}
                          onChange={(event) => setItemForm({ ...itemForm, code: event.target.value })}
                          style={inputStyle}
                          placeholder="Optional"
                        />
                      </label>
                      <label style={labelStyle}>
                        Name
                        <input
                          type="text"
                          value={itemForm.name}
                          onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })}
                          style={inputStyle}
                          placeholder="e.g., Leave encashment"
                        />
                      </label>
                      <label style={labelStyle}>
                        Amount
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={itemForm.amount}
                          onChange={(event) => setItemForm({ ...itemForm, amount: event.target.value })}
                          style={inputStyle}
                          placeholder="0.00"
                        />
                      </label>
                      <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                        Notes
                        <input
                          type="text"
                          value={itemForm.notes}
                          onChange={(event) => setItemForm({ ...itemForm, notes: event.target.value })}
                          style={inputStyle}
                          placeholder="Optional notes"
                        />
                      </label>
                      <div style={{ display: "flex", gap: 10 }}>
                        {editingItemId ? (
                          <>
                            <button
                              type="button"
                              style={primaryButtonStyle}
                              onClick={handleUpdateItem}
                            >
                              Update Item
                            </button>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => {
                                setEditingItemId(null);
                                setItemForm({ kind: "earning", code: "", name: "", amount: "", notes: "" });
                              }}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button type="submit" style={primaryButtonStyle}>
                            Add Item
                          </button>
                        )}
                      </div>
                    </form>
                  ) : null}

                  {!items.length ? (
                    <p style={{ margin: 0, color: "#6b7280" }}>No settlement items added.</p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={tableHeaderCellStyle}>Type</th>
                            <th style={tableHeaderCellStyle}>Name</th>
                            <th style={tableHeaderCellStyle}>Code</th>
                            <th style={tableHeaderCellStyle}>Amount</th>
                            <th style={tableHeaderCellStyle}>Notes</th>
                            <th style={tableHeaderCellStyle}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.id}>
                              <td style={tableCellStyle}>{item.kind}</td>
                              <td style={tableCellStyle}>{item.name}</td>
                              <td style={tableCellStyle}>{item.code || "—"}</td>
                              <td style={tableCellStyle}>{formatCurrency(item.amount)}</td>
                              <td style={tableCellStyle}>{item.notes || "—"}</td>
                              <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                {canManage && !settlementLocked ? (
                                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                                    <button
                                      type="button"
                                      style={secondaryButtonStyle}
                                      onClick={() => {
                                        setEditingItemId(item.id);
                                        setItemForm({
                                          kind: item.kind,
                                          code: item.code || "",
                                          name: item.name,
                                          amount: String(item.amount),
                                          notes: item.notes || "",
                                        });
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      style={secondaryButtonStyle}
                                      onClick={() => handleDeleteItem(item.id)}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{ color: "#6b7280", fontSize: 12 }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div style={sectionHeaderStyle}>
                    <h3 style={{ margin: 0 }}>Clearance Checklist</h3>
                    {settlementLocked ? (
                      <span style={{ color: "#6b7280", fontSize: 12 }}>Locked</span>
                    ) : null}
                  </div>

                  {canManage && !settlementLocked ? (
                    <form onSubmit={handleAddClearance} style={formGridStyle}>
                      <label style={labelStyle}>
                        Department
                        <input
                          type="text"
                          value={clearanceForm.department}
                          onChange={(event) => setClearanceForm({ ...clearanceForm, department: event.target.value })}
                          style={inputStyle}
                          placeholder="e.g., IT"
                        />
                      </label>
                      <label style={labelStyle}>
                        Item
                        <input
                          type="text"
                          value={clearanceForm.item}
                          onChange={(event) => setClearanceForm({ ...clearanceForm, item: event.target.value })}
                          style={inputStyle}
                          placeholder="e.g., Laptop returned"
                        />
                      </label>
                      <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
                        Notes
                        <input
                          type="text"
                          value={clearanceForm.notes}
                          onChange={(event) => setClearanceForm({ ...clearanceForm, notes: event.target.value })}
                          style={inputStyle}
                          placeholder="Optional notes"
                        />
                      </label>
                      <div>
                        <button type="submit" style={primaryButtonStyle}>
                          Add Clearance
                        </button>
                      </div>
                    </form>
                  ) : null}

                  {!clearances.length ? (
                    <p style={{ margin: 0, color: "#6b7280" }}>No clearance items added.</p>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={tableHeaderCellStyle}>Done</th>
                            <th style={tableHeaderCellStyle}>Department</th>
                            <th style={tableHeaderCellStyle}>Checklist Item</th>
                            <th style={tableHeaderCellStyle}>Notes</th>
                            <th style={tableHeaderCellStyle}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {clearances.map((clearance) => (
                            <tr key={clearance.id}>
                              <td style={tableCellStyle}>
                                <input
                                  type="checkbox"
                                  checked={clearance.is_done}
                                  onChange={(event) => handleToggleClearance(clearance, event.target.checked)}
                                  disabled={!canManage}
                                />
                              </td>
                              <td style={tableCellStyle}>{clearance.department}</td>
                              <td style={tableCellStyle}>{clearance.item}</td>
                              <td style={tableCellStyle}>{clearance.notes || "—"}</td>
                              <td style={{ ...tableCellStyle, textAlign: "right" }}>
                                {canManage && !settlementLocked ? (
                                  <button
                                    type="button"
                                    style={secondaryButtonStyle}
                                    onClick={() => handleDeleteClearance(clearance.id)}
                                  >
                                    Delete
                                  </button>
                                ) : (
                                  <span style={{ color: "#6b7280", fontSize: 12 }}>—</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gap: 12 }}>
                  <div style={sectionHeaderStyle}>
                    <h3 style={{ margin: 0 }}>Approvals & Payment</h3>
                  </div>
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      {settlementStatus === "draft" ? (
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          onClick={() => handleSettlementStatus("submitted")}
                          disabled={!canManage}
                        >
                          Submit Settlement
                        </button>
                      ) : null}
                      {settlementStatus === "submitted" ? (
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          onClick={() => handleSettlementStatus("approved")}
                          disabled={!canManage}
                        >
                          Approve Settlement
                        </button>
                      ) : null}
                    </div>

                    {settlementStatus === "approved" ? (
                      <div style={{ display: "grid", gap: 12 }}>
                        <div style={formGridStyle}>
                          <label style={labelStyle}>
                            Payment Mode
                            <select
                              value={paymentForm.payment_mode}
                              onChange={(event) =>
                                setPaymentForm({ ...paymentForm, payment_mode: event.target.value })
                              }
                              style={inputStyle}
                              disabled={!canManage}
                            >
                              {paymentModes.map((mode) => (
                                <option key={mode.value} value={mode.value}>
                                  {mode.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={labelStyle}>
                            Reference
                            <input
                              type="text"
                              value={paymentForm.payment_reference}
                              onChange={(event) =>
                                setPaymentForm({ ...paymentForm, payment_reference: event.target.value })
                              }
                              style={inputStyle}
                              placeholder="Transaction ID or cheque"
                              disabled={!canManage}
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          style={primaryButtonStyle}
                          onClick={() => handleSettlementStatus("paid")}
                          disabled={!canManage}
                        >
                          Mark Paid
                        </button>
                      </div>
                    ) : null}
                    {settlementStatus === "paid" ? (
                      <div style={{ color: "#166534", fontWeight: 600 }}>Settlement marked as paid.</div>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}

const tabHeaderStyle: CSSProperties = {
  display: "flex",
  gap: 12,
};

const tabStyle: CSSProperties = {
  ...secondaryButtonStyle,
  borderRadius: 999,
};

const activeTabStyle: CSSProperties = {
  ...primaryButtonStyle,
  borderRadius: 999,
};

const detailGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
};

const detailLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  marginBottom: 6,
};

const sectionHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const settlementHeaderStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
  padding: 16,
  borderRadius: 12,
  border: "1px solid #e5e7eb",
  backgroundColor: "#f8fafc",
};

const formGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
};

const labelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  fontSize: 13,
  color: "#111827",
  fontWeight: 600,
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(value || 0);
}
