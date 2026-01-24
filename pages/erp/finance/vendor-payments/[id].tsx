import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import BankTxnMatchModal, { type BankTxnRow } from "../../../../components/erp/finance/BankTxnMatchModal";
import {
  badgeStyle,
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";
import {
  getVendorPayment,
  upsertVendorPayment,
  vendorPaymentRowSchema,
  voidVendorPayment,
  type VendorPaymentRow,
} from "../../../../lib/erp/vendorPayments";

type VendorOption = {
  id: string;
  legal_name: string;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount);

export default function VendorPaymentDetailPage() {
  const router = useRouter();
  const paymentId = typeof router.query.id === "string" ? router.query.id : "";
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [payment, setPayment] = useState<VendorPaymentRow | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isVoidOpen, setIsVoidOpen] = useState(false);
  const [isUnmatchOpen, setIsUnmatchOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [isUnmatching, setIsUnmatching] = useState(false);
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchRows, setMatchRows] = useState<BankTxnRow[]>([]);
  const [voidReason, setVoidReason] = useState("");
  const [unmatchReason, setUnmatchReason] = useState("");

  const [formVendorId, setFormVendorId] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCurrency, setFormCurrency] = useState("INR");
  const [formMode, setFormMode] = useState("bank");
  const [formReference, setFormReference] = useState("");
  const [formNote, setFormNote] = useState("");

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx?.roleKey]
  );

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      setCtx(context);
      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    let active = true;

    async function loadVendors() {
      if (!ctx?.companyId) return;

      const { data, error: loadError } = await supabase
        .from("erp_vendors")
        .select("id, legal_name")
        .eq("company_id", ctx.companyId)
        .order("legal_name");

      if (!active) return;

      if (loadError) {
        setError(loadError.message || "Failed to load vendors.");
        return;
      }

      setVendors((data || []) as VendorOption[]);
    }

    loadVendors();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const loadPayment = async () => {
    if (!paymentId) return;
    setError(null);
    const { data, error: loadError } = await getVendorPayment(paymentId);

    if (loadError) {
      setError(loadError.message || "Failed to load payment.");
      return;
    }

    const parsed = vendorPaymentRowSchema.safeParse((data as VendorPaymentRow[] | null)?.[0]);
    if (!parsed.success) {
      setError("Failed to parse payment data.");
      return;
    }

    setPayment(parsed.data);
  };

  useEffect(() => {
    if (!paymentId) return;
    void loadPayment();
  }, [paymentId]);

  const openEdit = () => {
    if (!payment) return;
    setFormVendorId(payment.vendor_id);
    setFormPaymentDate(payment.payment_date);
    setFormAmount(String(payment.amount));
    setFormCurrency(payment.currency || "INR");
    setFormMode(payment.mode || "bank");
    setFormReference(payment.reference_no || "");
    setFormNote(payment.note || "");
    setToast(null);
    setIsEditOpen(true);
  };

  const handleSave = async () => {
    if (!payment) return;
    setIsSaving(true);
    setToast(null);

    const amount = Number(formAmount.replace(/,/g, ""));
    const { error: saveError } = await upsertVendorPayment({
      id: payment.id,
      vendorId: formVendorId,
      paymentDate: formPaymentDate,
      amount: Number.isFinite(amount) ? amount : 0,
      currency: formCurrency || "INR",
      mode: formMode || "bank",
      referenceNo: formReference || null,
      note: formNote || null,
    });

    if (saveError) {
      setToast({ type: "error", message: saveError.message || "Failed to update payment." });
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    setIsEditOpen(false);
    setToast({ type: "success", message: "Payment updated." });
    await loadPayment();
  };

  const handleVoid = async () => {
    if (!payment) return;
    setIsVoiding(true);
    setToast(null);

    const { error: voidError } = await voidVendorPayment(payment.id, voidReason.trim());

    if (voidError) {
      setToast({ type: "error", message: voidError.message || "Failed to void payment." });
      setIsVoiding(false);
      return;
    }

    setIsVoiding(false);
    setIsVoidOpen(false);
    setVoidReason("");
    setToast({ type: "success", message: "Payment voided." });
    await loadPayment();
  };

  const handleUnmatch = async () => {
    if (!payment?.matched_bank_txn_id) return;
    setIsUnmatching(true);
    setToast(null);

    const { error: unmatchError } = await supabase.rpc("erp_bank_unmatch", {
      p_bank_txn_id: payment.matched_bank_txn_id,
      p_reason: unmatchReason.trim(),
    });

    if (unmatchError) {
      setToast({ type: "error", message: unmatchError.message || "Failed to unmatch." });
      setIsUnmatching(false);
      return;
    }

    setIsUnmatching(false);
    setIsUnmatchOpen(false);
    setUnmatchReason("");
    setToast({ type: "success", message: "Bank transaction unmatched." });
    await loadPayment();
  };

  const handleSearchBankTxns = async (params: {
    fromDate: string;
    toDate: string;
    query: string;
    minAmount: string;
    maxAmount: string;
    unmatchedOnly: boolean;
    debitOnly: boolean;
  }) => {
    setMatchLoading(true);
    setMatchError(null);

    const minAmount = params.minAmount ? Number(params.minAmount) : null;
    const maxAmount = params.maxAmount ? Number(params.maxAmount) : null;

    const { data, error: listError } = await supabase.rpc("erp_bank_txns_search", {
      p_from: params.fromDate,
      p_to: params.toDate,
      p_source: null,
      p_query: params.query.trim() || null,
      p_min_amount: Number.isFinite(minAmount) ? minAmount : null,
      p_max_amount: Number.isFinite(maxAmount) ? maxAmount : null,
    });

    if (listError) {
      setMatchError(listError.message || "Failed to load bank transactions.");
      setMatchLoading(false);
      return;
    }

    setMatchRows((data as BankTxnRow[]) || []);
    setMatchLoading(false);
  };

  const handleMatch = async (txn: BankTxnRow, notes: string) => {
    if (!payment) return;
    setMatchLoading(true);
    setMatchError(null);

    const { error: matchError } = await supabase.rpc("erp_bank_match_vendor_payment", {
      p_bank_txn_id: txn.id,
      p_vendor_payment_id: payment.id,
      p_confidence: "manual",
      p_notes: notes.trim() || null,
    });

    if (matchError) {
      setMatchError(matchError.message || "Failed to match bank transaction.");
      setMatchLoading(false);
      return;
    }

    setMatchLoading(false);
    setMatchModalOpen(false);
    await loadPayment();
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading...</div>
      </ErpShell>
    );
  }

  if (error || !payment) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader title="Vendor Payment" />
          <div style={cardStyle}>{error || "Payment not found."}</div>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          title={`Payment ${payment.reference_no || payment.id}`}
          description={`Vendor payment recorded on ${payment.payment_date}.`}
          rightActions={
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={openEdit}
                disabled={!canWrite || payment.is_void || payment.matched}
              >
                Edit
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsVoidOpen(true)}
                disabled={!canWrite || payment.is_void || payment.matched}
              >
                Void
              </button>
            </div>
          }
        />

        {toast && (
          <div style={{ ...cardStyle, borderColor: toast.type === "error" ? "#fecaca" : "#bbf7d0" }}>
            <strong>{toast.message}</strong>
          </div>
        )}

        <div style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
            <div>
              <p style={subtitleStyle}>Vendor</p>
              <strong>{payment.vendor_name || payment.vendor_id}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Amount</p>
              <strong>{formatCurrency(payment.amount, payment.currency || "INR")}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Mode</p>
              <strong>{payment.mode || "—"}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Reference</p>
              <strong>{payment.reference_no || "—"}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Status</p>
              {payment.is_void ? (
                <span style={{ ...badgeStyle, backgroundColor: "#f3f4f6", color: "#4b5563" }}>VOID</span>
              ) : payment.matched ? (
                <span style={{ ...badgeStyle, backgroundColor: "#dcfce7", color: "#166534" }}>Matched</span>
              ) : (
                <span style={{ ...badgeStyle, backgroundColor: "#e0f2fe", color: "#0369a1" }}>Open</span>
              )}
            </div>
          </div>
          <div>
            <p style={subtitleStyle}>Notes</p>
            <p>{payment.note || "—"}</p>
          </div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div>
              <p style={subtitleStyle}>Created</p>
              <p>{payment.created_at}</p>
            </div>
            <div>
              <p style={subtitleStyle}>Updated</p>
              <p>{payment.updated_at}</p>
            </div>
          </div>
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Bank Matching</h3>
          {payment.matched ? (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ ...cardStyle, backgroundColor: "#f8fafc" }}>
                <p style={subtitleStyle}>Matched bank transaction</p>
                <strong>{payment.matched_bank_txn_description || "—"}</strong>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8 }}>
                  <span>Date: {payment.matched_bank_txn_date || "—"}</span>
                  <span>Amount: {payment.matched_bank_txn_amount ?? "—"}</span>
                </div>
              </div>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsUnmatchOpen(true)}
                disabled={!canWrite}
              >
                Unmatch
              </button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              <p style={subtitleStyle}>No bank transaction matched yet.</p>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => setMatchModalOpen(true)}
                disabled={!canWrite || payment.is_void}
              >
                Match Bank Transaction
              </button>
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Audit</h3>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Field</th>
                  <th style={tableHeaderCellStyle}>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={tableCellStyle}>Created by</td>
                  <td style={tableCellStyle}>{payment.created_by}</td>
                </tr>
                <tr>
                  <td style={tableCellStyle}>Updated by</td>
                  <td style={tableCellStyle}>{payment.updated_by}</td>
                </tr>
                <tr>
                  <td style={tableCellStyle}>Source</td>
                  <td style={tableCellStyle}>{payment.source}</td>
                </tr>
                <tr>
                  <td style={tableCellStyle}>Source ref</td>
                  <td style={tableCellStyle}>{payment.source_ref || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {isEditOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(520px, 92vw)" }}>
            <h3 style={{ marginTop: 0 }}>Edit vendor payment</h3>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Vendor</span>
                <select value={formVendorId} onChange={(e) => setFormVendorId(e.target.value)} style={inputStyle}>
                  <option value="">Select vendor</option>
                  {vendors.map((vendor) => (
                    <option key={vendor.id} value={vendor.id}>
                      {vendor.legal_name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Payment date</span>
                <input
                  type="date"
                  value={formPaymentDate}
                  onChange={(e) => setFormPaymentDate(e.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Amount</span>
                <input value={formAmount} onChange={(e) => setFormAmount(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Currency</span>
                <input value={formCurrency} onChange={(e) => setFormCurrency(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Mode</span>
                <input value={formMode} onChange={(e) => setFormMode(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Reference</span>
                <input value={formReference} onChange={(e) => setFormReference(e.target.value)} style={inputStyle} />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Notes</span>
                <textarea
                  rows={3}
                  value={formNote}
                  onChange={(e) => setFormNote(e.target.value)}
                  style={{ ...inputStyle, minHeight: 90 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsEditOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleSave}
                disabled={!formVendorId || !formPaymentDate || !formAmount || isSaving}
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isVoidOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(520px, 92vw)" }}>
            <h3 style={{ marginTop: 0 }}>Void vendor payment</h3>
            <p style={{ color: "#64748b", marginTop: 6 }}>
              Provide a reason for voiding this payment.
            </p>
            <textarea
              rows={3}
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              style={{ ...inputStyle, width: "100%", minHeight: 90 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsVoidOpen(false)}
                disabled={isVoiding}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleVoid}
                disabled={!voidReason.trim() || isVoiding}
              >
                {isVoiding ? "Voiding..." : "Confirm void"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isUnmatchOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            zIndex: 60,
          }}
        >
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(520px, 92vw)" }}>
            <h3 style={{ marginTop: 0 }}>Unmatch bank transaction</h3>
            <p style={{ color: "#64748b", marginTop: 6 }}>
              Provide a reason for unmatching this transaction.
            </p>
            <textarea
              rows={3}
              value={unmatchReason}
              onChange={(e) => setUnmatchReason(e.target.value)}
              style={{ ...inputStyle, width: "100%", minHeight: 90 }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsUnmatchOpen(false)}
                disabled={isUnmatching}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleUnmatch}
                disabled={!unmatchReason.trim() || isUnmatching}
              >
                {isUnmatching ? "Unmatching..." : "Confirm unmatch"}
              </button>
            </div>
          </div>
        </div>
      )}

      <BankTxnMatchModal
        open={matchModalOpen}
        paymentDate={payment.payment_date}
        paymentAmount={payment.amount}
        currency={payment.currency}
        loading={matchLoading}
        error={matchError}
        transactions={matchRows}
        onClose={() => setMatchModalOpen(false)}
        onSearch={handleSearchBankTxns}
        onMatch={handleMatch}
      />
    </ErpShell>
  );
}
