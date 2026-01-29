import Link from "next/link";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/router";

import ErpShell from "../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, isHr, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { getCurrentErpAccess, type ErpAccessState } from "../../../../lib/erp/nav";
import { supabase } from "../../../../lib/supabaseClient";

type SettlementItem = {
  id: string;
  kind: "earning" | "deduction";
  code?: string | null;
  name: string;
  amount: number;
  notes?: string | null;
  sort_order: number;
};

type SettlementClearance = {
  id: string;
  department: string;
  item: string;
  is_done: boolean;
  notes?: string | null;
  sort_order: number;
};

type SettlementEmployee = {
  id: string;
  employee_code: string;
  full_name: string;
};

type SettlementExit = {
  id: string;
  employee_id: string;
  status: string;
  last_working_day: string | null;
};

type SettlementPayload = {
  settlement: {
    id: string;
    exit_id: string;
    status: string;
    notes?: string | null;
  } | null;
  lines: SettlementItem[];
  clearances: SettlementClearance[];
  employee: SettlementEmployee | null;
  exit: SettlementExit | null;
  earnings_total?: number | string | null;
  deductions_total?: number | string | null;
  net_amount?: number | string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

type EditableLine = {
  id: string;
  kind: "earning" | "deduction";
  title: string;
  amount: string;
  remarks: string;
  sortOrder: number;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeAmount(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(numeric)) return null;
  return numeric;
}

function sumTotals(lines: EditableLine[], kind: "earning" | "deduction") {
  return lines
    .filter((line) => line.kind === kind)
    .reduce((acc, line) => acc + (Number(line.amount) || 0), 0);
}

function createTempId() {
  return `temp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function renderStatusLabel(status: string) {
  if (status === "finalized") return "Finalized";
  if (status === "submitted") return "Submitted";
  if (status === "approved") return "Approved";
  if (status === "paid") return "Paid";
  return status || "Draft";
}

export default function FinalSettlementDetailPage() {
  const router = useRouter();
  const settlementId = useMemo(() => {
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
  const [settlementData, setSettlementData] = useState<SettlementPayload | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [deletedLineIds, setDeletedLineIds] = useState<string[]>([]);
  const [toast, setToast] = useState<ToastState>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [finalizeModalOpen, setFinalizeModalOpen] = useState(false);

  const canManage = useMemo(
    () => access.isManager || isHr(ctx?.roleKey),
    [access.isManager, ctx?.roleKey]
  );

  const settlement = settlementData?.settlement ?? null;
  const isLocked = settlement?.status ? settlement.status !== "draft" : false;

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

      await loadData();
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router, settlementId]);

  async function loadData() {
    if (!settlementId) return;
    setToast(null);

    const { data, error } = await supabase.rpc("erp_hr_final_settlement_get", {
      p_settlement_id: settlementId,
    });

    if (error) {
      setToast({ type: "error", message: error.message || "Unable to load settlement." });
      return;
    }

    const payload = data as SettlementPayload;
    setSettlementData(payload);
    setNotes(payload?.settlement?.notes || "");

    const mappedLines: EditableLine[] = (payload?.lines ?? []).map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.name,
      amount: item.amount?.toString() ?? "0",
      remarks: item.notes ?? "",
      sortOrder: item.sort_order ?? 0,
    }));
    setLines(mappedLines);
    setDeletedLineIds([]);
  }

  function showToast(message: string, type: "success" | "error" = "success") {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  }

  async function handleAddLine(kind: "earning" | "deduction") {
    setLines((prev) => [
      ...prev,
      {
        id: createTempId(),
        kind,
        title: "",
        amount: "0",
        remarks: "",
        sortOrder: prev.length + 1,
      },
    ]);
  }

  function handleLineChange(id: string, field: keyof EditableLine, value: string | number) {
    setLines((prev) =>
      prev.map((line) => (line.id === id ? { ...line, [field]: value } : line))
    );
  }

  function handleRemoveLine(id: string) {
    setLines((prev) => prev.filter((line) => line.id !== id));
    if (!id.startsWith("temp-")) {
      setDeletedLineIds((prev) => [...prev, id]);
    }
  }

  async function handleSave() {
    if (!settlement?.exit_id) return;
    if (!canManage) {
      showToast("You do not have permission to update settlements.", "error");
      return;
    }

    const invalidLine = lines.find(
      (line) => !line.title.trim() || Number(line.amount) < 0 || Number.isNaN(Number(line.amount))
    );
    if (invalidLine) {
      showToast("Please ensure every line has a title and non-negative amount.", "error");
      return;
    }

    setActionLoading(true);

    const { data: settlementId, error: headerError } = await supabase.rpc(
      "erp_hr_final_settlement_upsert_header",
      {
        p_settlement_id: settlement?.id ?? null,
        p_exit_id: settlement.exit_id,
        p_notes: notes || null,
      }
    );

    if (headerError || !settlementId) {
      showToast(headerError?.message || "Unable to save settlement header.", "error");
      setActionLoading(false);
      return;
    }

    for (const line of lines) {
      const lineId = line.id.startsWith("temp-") ? null : line.id;
      const { error: lineError } = await supabase.rpc("erp_hr_final_settlement_line_upsert", {
        p_settlement_id: settlementId,
        p_line_id: lineId,
        p_line_type: line.kind,
        p_title: line.title,
        p_amount: Number(line.amount),
        p_remarks: line.remarks || null,
        p_sort: line.sortOrder || 0,
      });

      if (lineError) {
        showToast(lineError.message || "Unable to save line items.", "error");
        setActionLoading(false);
        return;
      }
    }

    for (const lineId of deletedLineIds) {
      const { error: deleteError } = await supabase.rpc("erp_hr_final_settlement_line_delete", {
        p_settlement_id: settlementId,
        p_line_id: lineId,
      });

      if (deleteError) {
        showToast(deleteError.message || "Unable to remove line item.", "error");
        setActionLoading(false);
        return;
      }
    }

    showToast("Settlement saved successfully.", "success");
    setActionLoading(false);
    await loadData();
  }

  async function handleFinalize() {
    if (!settlement?.id) return;
    setActionLoading(true);
    const { error } = await supabase.rpc("erp_hr_final_settlement_finalize", {
      p_settlement_id: settlement.id,
    });

    if (error) {
      showToast(error.message || "Unable to finalize settlement.", "error");
      setActionLoading(false);
      return;
    }

    showToast("Settlement finalized.", "success");
    setActionLoading(false);
    await loadData();
  }

  const computedEarnings = sumTotals(lines, "earning");
  const computedDeductions = sumTotals(lines, "deduction");
  const dbEarnings = normalizeAmount(settlementData?.earnings_total ?? null);
  const dbDeductions = normalizeAmount(settlementData?.deductions_total ?? null);
  const dbNet = normalizeAmount(settlementData?.net_amount ?? null);
  const totalEarnings = dbEarnings ?? computedEarnings;
  const totalDeductions = dbDeductions ?? computedDeductions;
  const netPayable = dbNet ?? totalEarnings - totalDeductions;

  if (loading) {
    return (
      <ErpShell activeModule="hr">
        <div style={pageContainerStyle}>Loading final settlement…</div>
      </ErpShell>
    );
  }

  const exitRecord = settlementData?.exit;
  const employee = settlementData?.employee;

  return (
    <ErpShell activeModule="hr">
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={subtitleStyle}>HR · Final Settlements</p>
            <h1 style={h1Style}>Final Settlement</h1>
            <p style={subtitleStyle}>Prepare HR-side settlement notes for the employee exit.</p>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Link href="/erp/hr/final-settlements" style={{ color: "#2563eb", textDecoration: "none" }}>
              Back to Settlements
            </Link>
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

        {settlement ? (
          <section style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Employee</div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>
                  {employee?.full_name || "Unnamed"}
                </div>
                <div style={{ color: "#6b7280" }}>{employee?.employee_code || "—"}</div>
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  <strong>Exit reference:</strong> {settlement.exit_id}
                </div>
                <div style={{ marginTop: 4, fontSize: 14 }}>
                  <strong>Last working day:</strong> {formatDate(exitRecord?.last_working_day)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={badgeStyle}>{renderStatusLabel(settlement.status)}</span>
              </div>
            </div>
            {isLocked ? (
              <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
                Settlement is locked and cannot be edited.
              </div>
            ) : null}
          </section>
        ) : (
          <section style={cardStyle}>
            <div style={{ fontWeight: 600 }}>Settlement not found.</div>
            <div style={{ marginTop: 6, color: "#6b7280", fontSize: 13 }}>
              Return to the exit detail page to create a draft settlement.
            </div>
            <div style={{ marginTop: 12 }}>
              <Link href="/erp/hr/exits" style={{ ...secondaryButtonStyle, textDecoration: "none" }}>
                Back to Exits
              </Link>
            </div>
          </section>
        )}

        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Summary</h3>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Earnings total</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(totalEarnings)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Deductions total</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{formatCurrency(totalDeductions)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>Net payable</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(netPayable)}</div>
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Notes</div>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              disabled={isLocked}
              style={{ ...inputStyle, width: "100%", resize: "vertical" }}
            />
          </div>
        </section>

        <section style={cardStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h3 style={{ margin: 0 }}>Line Items</h3>
            {!isLocked ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" style={secondaryButtonStyle} onClick={() => handleAddLine("earning")}
                  disabled={!canManage || actionLoading}
                >
                  Add Earning
                </button>
                <button type="button" style={secondaryButtonStyle} onClick={() => handleAddLine("deduction")}
                  disabled={!canManage || actionLoading}
                >
                  Add Deduction
                </button>
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            {lines.length === 0 ? (
              <div style={{ fontSize: 13, color: "#6b7280" }}>
                No line items yet. Add earnings and deductions to compute net payable.
              </div>
            ) : (
              lines.map((line, index) => (
                <div
                  key={line.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "120px 1fr 140px 1fr auto",
                    gap: 12,
                    alignItems: "center",
                  }}
                >
                  <select
                    value={line.kind}
                    onChange={(event) => handleLineChange(line.id, "kind", event.target.value)}
                    style={inputStyle}
                    disabled={isLocked}
                  >
                    <option value="earning">Earning</option>
                    <option value="deduction">Deduction</option>
                  </select>
                  <input
                    value={line.title}
                    onChange={(event) => handleLineChange(line.id, "title", event.target.value)}
                    placeholder="Line item name"
                    style={inputStyle}
                    disabled={isLocked}
                  />
                  <input
                    value={line.amount}
                    onChange={(event) => handleLineChange(line.id, "amount", event.target.value)}
                    placeholder="Amount"
                    type="number"
                    min={0}
                    step="0.01"
                    style={inputStyle}
                    disabled={isLocked}
                  />
                  <input
                    value={line.remarks}
                    onChange={(event) => handleLineChange(line.id, "remarks", event.target.value)}
                    placeholder="Remarks"
                    style={inputStyle}
                    disabled={isLocked}
                  />
                  {!isLocked ? (
                    <button
                      type="button"
                      onClick={() => handleRemoveLine(line.id)}
                      style={{ ...secondaryButtonStyle, padding: "8px 12px" }}
                      disabled={actionLoading}
                    >
                      Remove
                    </button>
                  ) : (
                    <span style={{ fontSize: 12, color: "#6b7280" }}>#{index + 1}</span>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {settlementData?.clearances?.length ? (
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Clearance Checklist</h3>
            <div style={{ display: "grid", gap: 8 }}>
              {settlementData.clearances.map((clearance) => (
                <div
                  key={clearance.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "8px 12px",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{clearance.department}</div>
                    <div style={{ fontSize: 13, color: "#6b7280" }}>{clearance.item}</div>
                    {clearance.notes ? (
                      <div style={{ fontSize: 12, color: "#6b7280" }}>{clearance.notes}</div>
                    ) : null}
                  </div>
                  <span style={{ ...badgeStyle, backgroundColor: clearance.is_done ? "#dcfce7" : "#fef3c7", color: clearance.is_done ? "#166534" : "#92400e" }}>
                    {clearance.is_done ? "Done" : "Pending"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Actions</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              disabled={actionLoading || !canManage || isLocked}
              onClick={handleSave}
            >
              {actionLoading ? "Saving…" : "Save Draft"}
            </button>
            <button
              type="button"
              style={primaryButtonStyle}
              disabled={actionLoading || !canManage || isLocked || !settlement?.id}
              onClick={() => setFinalizeModalOpen(true)}
            >
              {actionLoading ? "Finalizing…" : "Finalize Settlement"}
            </button>
          </div>
          {!canManage ? (
            <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
              You do not have permission to edit final settlements.
            </div>
          ) : null}
        </section>
      </div>

      {finalizeModalOpen ? (
        <div style={modalOverlayStyle} role="dialog" aria-modal="true">
          <div style={modalCardStyle}>
            <h3 style={{ marginTop: 0 }}>Finalize Settlement</h3>
            <p style={{ color: "#6b7280", marginTop: 4 }}>
              This will lock the settlement and prevent further edits. Continue?
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                disabled={actionLoading}
                onClick={() => setFinalizeModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                disabled={actionLoading}
                onClick={async () => {
                  setFinalizeModalOpen(false);
                  await handleFinalize();
                }}
              >
                {actionLoading ? "Finalizing…" : "Finalize"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ErpShell>
  );
}

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  backgroundColor: "rgba(15, 23, 42, 0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 40,
  padding: 16,
};

const modalCardStyle: CSSProperties = {
  backgroundColor: "#fff",
  borderRadius: 12,
  padding: 20,
  width: "100%",
  maxWidth: 420,
  boxShadow: "0 10px 25px rgba(15, 23, 42, 0.2)",
};
