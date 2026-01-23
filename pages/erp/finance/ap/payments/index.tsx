import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

const today = () => new Date().toISOString().slice(0, 10);

const getMonthBounds = (date = new Date()) => {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

type VendorOption = { id: string; legal_name: string };

type PaymentRow = {
  id: string;
  vendor_id: string;
  payment_date: string;
  amount: number;
  currency: string;
  mode: string;
  reference_no: string | null;
  note: string | null;
  is_void: boolean;
  void_reason: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const paymentModes = [
  { value: "bank", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
  { value: "card", label: "Card" },
  { value: "upi", label: "UPI" },
];

export default function ApPaymentsPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => getMonthBounds(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [dateStart, setDateStart] = useState(start);
  const [dateEnd, setDateEnd] = useState(end);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isVoidModalOpen, setIsVoidModalOpen] = useState(false);
  const [activePayment, setActivePayment] = useState<PaymentRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [formVendorId, setFormVendorId] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState(today());
  const [formAmount, setFormAmount] = useState("");
  const [formCurrency, setFormCurrency] = useState("INR");
  const [formMode, setFormMode] = useState("bank");
  const [formReference, setFormReference] = useState("");
  const [formNote, setFormNote] = useState("");
  const [voidReason, setVoidReason] = useState("");

  const currencyFormatters = useMemo(() => new Map<string, Intl.NumberFormat>(), []);

  const formatAmount = (amount: number, currency: string) => {
    const key = currency || "INR";
    const existing = currencyFormatters.get(key);
    if (existing) {
      return existing.format(amount);
    }
    const formatter = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: key,
      maximumFractionDigits: 2,
    });
    currencyFormatters.set(key, formatter);
    return formatter.format(amount);
  };

  const vendorLookup = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendor.legal_name])), [
    vendors,
  ]);

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

  const loadPayments = async () => {
    if (!ctx?.companyId) return;
    setIsLoadingData(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("erp_ap_vendor_payments")
      .select("id, vendor_id, payment_date, amount, currency, mode, reference_no, note, is_void, void_reason")
      .eq("company_id", ctx.companyId)
      .gte("payment_date", dateStart)
      .lte("payment_date", dateEnd)
      .order("payment_date", { ascending: false });

    if (loadError) {
      setError(loadError.message || "Failed to load payments.");
      setIsLoadingData(false);
      return;
    }

    setPayments((data || []) as PaymentRow[]);
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active) return;
      await loadPayments();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, dateStart, dateEnd]);

  const resetForm = () => {
    setFormVendorId("");
    setFormPaymentDate(today());
    setFormAmount("");
    setFormCurrency("INR");
    setFormMode("bank");
    setFormReference("");
    setFormNote("");
  };

  const handleOpenAdd = () => {
    resetForm();
    setIsAddModalOpen(true);
  };

  const handleSavePayment = async () => {
    if (!formVendorId || !formPaymentDate || !formAmount) return;
    setIsSaving(true);
    setToast(null);

    const amount = Number(formAmount);

    const { error: saveError } = await supabase.rpc("erp_ap_vendor_payment_upsert", {
      p_vendor_id: formVendorId,
      p_payment_date: formPaymentDate,
      p_amount: Number.isFinite(amount) ? amount : 0,
      p_currency: formCurrency || "INR",
      p_mode: formMode || "bank",
      p_reference_no: formReference || null,
      p_note: formNote || null,
      p_source: "manual",
      p_source_ref: null,
      p_id: null,
    });

    if (saveError) {
      setToast({ type: "error", message: saveError.message || "Failed to save payment." });
      setIsSaving(false);
      return;
    }

    setToast({ type: "success", message: "Payment recorded." });
    setIsSaving(false);
    setIsAddModalOpen(false);
    await loadPayments();
  };

  const handleOpenVoid = (payment: PaymentRow) => {
    setActivePayment(payment);
    setVoidReason("");
    setIsVoidModalOpen(true);
  };

  const handleVoidPayment = async () => {
    if (!activePayment) return;
    setIsVoiding(true);
    setToast(null);

    const { error: voidError } = await supabase.rpc("erp_ap_vendor_payment_void", {
      p_id: activePayment.id,
      p_reason: voidReason.trim(),
    });

    if (voidError) {
      setToast({ type: "error", message: voidError.message || "Failed to void payment." });
      setIsVoiding(false);
      return;
    }

    setToast({ type: "success", message: "Payment voided." });
    setIsVoiding(false);
    setIsVoidModalOpen(false);
    await loadPayments();
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading AP payments…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Unable to load AP payments.</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="AP Payments"
          description="Track vendor payments and reconcile outgoing cash."
          rightActions={
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button type="button" style={primaryButtonStyle} onClick={handleOpenAdd}>
                Add payment
              </button>
              <Link href="/erp/finance" style={secondaryButtonStyle}>
                Back to Finance
              </Link>
            </div>
          }
        />

        <section style={cardStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>
                From
              </span>
              <input type="date" value={dateStart} onChange={(event) => setDateStart(event.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>
                To
              </span>
              <input type="date" value={dateEnd} onChange={(event) => setDateEnd(event.target.value)} style={inputStyle} />
            </label>
            <button type="button" style={secondaryButtonStyle} onClick={loadPayments} disabled={isLoadingData}>
              {isLoadingData ? "Refreshing…" : "Refresh"}
            </button>
          </div>
          <p style={{ ...subtitleStyle, marginTop: 12 }}>
            Showing {payments.length} payments from {dateStart} to {dateEnd}.
          </p>
        </section>

        <section>
          {isLoadingData ? (
            <div style={subtitleStyle}>Loading payments…</div>
          ) : payments.length === 0 ? (
            <div style={subtitleStyle}>No payments recorded in this range.</div>
          ) : (
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Payment date</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Mode</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Note</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} style={payment.is_void ? { background: "#f8fafc" } : undefined}>
                    <td style={tableCellStyle}>{new Date(payment.payment_date).toLocaleDateString("en-GB")}</td>
                    <td style={tableCellStyle}>{vendorLookup.get(payment.vendor_id) || "—"}</td>
                    <td style={tableCellStyle}>{formatAmount(payment.amount, payment.currency)}</td>
                    <td style={tableCellStyle}>{payment.mode}</td>
                    <td style={tableCellStyle}>{payment.reference_no || "—"}</td>
                    <td style={tableCellStyle}>{payment.note || "—"}</td>
                    <td style={tableCellStyle}>
                      {payment.is_void ? (
                        <span style={{ color: "#b91c1c", fontWeight: 600 }} title={payment.void_reason || "Void"}>
                          Voided
                        </span>
                      ) : (
                        <span style={{ color: "#047857", fontWeight: 600 }}>Posted</span>
                      )}
                    </td>
                    <td style={tableCellStyle}>
                      {payment.is_void ? (
                        <span style={{ color: "#94a3b8" }}>—</span>
                      ) : (
                        <button type="button" style={secondaryButtonStyle} onClick={() => handleOpenVoid(payment)}>
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {toast && (
          <div
            style={{
              marginTop: 16,
              padding: "12px 14px",
              borderRadius: 10,
              background: toast.type === "success" ? "#ecfdf5" : "#fef2f2",
              border: `1px solid ${toast.type === "success" ? "#a7f3d0" : "#fecaca"}`,
              color: toast.type === "success" ? "#047857" : "#b91c1c",
              fontWeight: 600,
            }}
          >
            {toast.message}
          </div>
        )}

        {error && (
          <div style={{ marginTop: 16, color: "#b91c1c" }}>
            {error}
          </div>
        )}
      </div>

      {isAddModalOpen && (
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
          <div style={{ background: "white", borderRadius: 12, padding: 20, width: "min(560px, 92vw)" }}>
            <h3 style={{ marginTop: 0 }}>Add vendor payment</h3>
            <p style={{ color: "#64748b", marginTop: 6 }}>Record an outgoing payment to a vendor.</p>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Vendor</span>
                <select
                  value={formVendorId}
                  onChange={(event) => setFormVendorId(event.target.value)}
                  style={inputStyle}
                >
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
                  onChange={(event) => setFormPaymentDate(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Amount</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={formAmount}
                  onChange={(event) => setFormAmount(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Currency</span>
                  <input
                    value={formCurrency}
                    onChange={(event) => setFormCurrency(event.target.value.toUpperCase())}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: "grid", gap: 6 }}>
                  <span>Mode</span>
                  <select value={formMode} onChange={(event) => setFormMode(event.target.value)} style={inputStyle}>
                    {paymentModes.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Reference</span>
                <input
                  value={formReference}
                  onChange={(event) => setFormReference(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Note</span>
                <textarea
                  rows={3}
                  value={formNote}
                  onChange={(event) => setFormNote(event.target.value)}
                  style={{ ...inputStyle, minHeight: 80 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsAddModalOpen(false)}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleSavePayment}
                disabled={!formVendorId || !formPaymentDate || !formAmount || isSaving}
              >
                {isSaving ? "Saving…" : "Save payment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isVoidModalOpen && activePayment && (
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
            <h3 style={{ marginTop: 0 }}>Void payment</h3>
            <p style={{ color: "#64748b", marginTop: 6 }}>
              Provide a reason for voiding the payment to {vendorLookup.get(activePayment.vendor_id) || "the vendor"}.
            </p>
            <label style={{ display: "grid", gap: 6, marginTop: 12 }}>
              <span>Reason (min 5 characters)</span>
              <textarea
                rows={3}
                value={voidReason}
                onChange={(event) => setVoidReason(event.target.value)}
                style={{ ...inputStyle, minHeight: 80 }}
              />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsVoidModalOpen(false)}
                disabled={isVoiding}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleVoidPayment}
                disabled={isVoiding || voidReason.trim().length < 5}
              >
                {isVoiding ? "Voiding…" : "Void payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ErpShell>
  );
}
