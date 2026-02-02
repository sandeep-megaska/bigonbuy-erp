import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
import { apiGet, apiPost } from "../../../../lib/erp/apiFetch";
import { isMakerCheckerBypassAllowed } from "../../../../lib/erp/featureFlags";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";
import {
  getVendorPayment,
  setVendorPaymentAllocations,
  upsertVendorPayment,
  vendorPaymentRowSchema,
  voidVendorPayment,
  type VendorPaymentRow,
} from "../../../../lib/erp/vendorPayments";

type VendorOption = {
  id: string;
  legal_name: string;
};

type PaymentAccountOption = {
  id: string;
  code: string;
  name: string;
};

type InvoiceAllocationRow = {
  invoice_id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  due_date: string | null;
  invoice_total: number;
  outstanding_amount: number;
  allocated_amount: number;
};

type ApprovalRecord = {
  id: string;
  state: string;
  requested_by: string | null;
  requested_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const formatCurrency = (amount: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency }).format(amount);

/**
 * Dependency map:
 * UI: /erp/finance/vendor-payments/[id]
 * RPC: erp_ap_vendor_payment_get, erp_ap_vendor_payment_upsert, erp_ap_vendor_payment_approve,
 *      erp_ap_vendor_payment_void, erp_ap_vendor_payment_set_allocations, erp_ap_invoices_outstanding_list,
 *      erp_bank_txns_search, erp_bank_match_vendor_payment, erp_bank_unmatch
 * Tables: erp_ap_vendor_payments, erp_ap_vendor_payment_allocations, erp_gst_purchase_invoices,
 *         erp_vendors, erp_fin_journals, erp_bank_transactions
 */
export default function VendorPaymentDetailPage() {
  const router = useRouter();
  const paymentId = typeof router.query.id === "string" ? router.query.id : "";
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [payment, setPayment] = useState<VendorPaymentRow | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isVoidOpen, setIsVoidOpen] = useState(false);
  const [isUnmatchOpen, setIsUnmatchOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);
  const [isUnmatching, setIsUnmatching] = useState(false);
  const [matchModalOpen, setMatchModalOpen] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matchRows, setMatchRows] = useState<BankTxnRow[]>([]);
  const [voidReason, setVoidReason] = useState("");
  const [unmatchReason, setUnmatchReason] = useState("");
  const [invoiceAllocations, setInvoiceAllocations] = useState<InvoiceAllocationRow[]>([]);
  const [isAllocationsLoading, setIsAllocationsLoading] = useState(false);
  const [isAllocationsSaving, setIsAllocationsSaving] = useState(false);
  const [approval, setApproval] = useState<ApprovalRecord | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);

  const [formVendorId, setFormVendorId] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formPaymentAccount, setFormPaymentAccount] = useState("");
  const [formReference, setFormReference] = useState("");
  const [formNote, setFormNote] = useState("");

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx?.roleKey]
  );

  const canBypass = useMemo(() => isMakerCheckerBypassAllowed(ctx?.roleKey), [ctx?.roleKey]);

  const approvalState = approval?.state ?? "draft";

  const totalAllocated = useMemo(
    () => invoiceAllocations.reduce((sum, row) => sum + Number(row.allocated_amount || 0), 0),
    [invoiceAllocations]
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

  useEffect(() => {
    let active = true;

    async function loadPaymentAccounts() {
      const { data, error: loadError } = await supabase.rpc("erp_gl_accounts_picklist", {
        p_q: null,
        p_include_inactive: false,
      });

      if (!active) return;

      if (loadError) {
        setError(loadError.message || "Failed to load payment accounts.");
        return;
      }

      setPaymentAccounts((data || []) as PaymentAccountOption[]);
    }

    loadPaymentAccounts();

    return () => {
      active = false;
    };
  }, []);

  const getAuthHeaders = () => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = ctx?.session?.access_token;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const loadApproval = async (companyId: string, entityId: string) => {
    if (!ctx?.session?.access_token) return;
    setApprovalLoading(true);
    try {
      const params = new URLSearchParams({
        companyId,
        entityType: "ap_payment",
        entityId,
      });
      const payload = await apiGet<{ data?: ApprovalRecord | null }>(
        `/api/finance/approvals/entity?${params.toString()}`,
        { headers: getAuthHeaders() }
      );
      setApproval(payload.data ?? null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load approval state.";
      setError(message || "Failed to load approval state.");
    } finally {
      setApprovalLoading(false);
    }
  };

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
    if (ctx?.companyId) {
      await loadApproval(ctx.companyId, paymentId);
    }
  };

  const loadAllocations = async (currentPayment: VendorPaymentRow) => {
    setIsAllocationsLoading(true);
    const { data: outstandingData, error: outstandingError } = await supabase.rpc(
      "erp_ap_invoices_outstanding_list",
      {
        p_vendor_id: currentPayment.vendor_id,
        p_from: null,
        p_to: null,
        p_q: null,
        p_limit: 200,
        p_offset: 0,
      }
    );

    if (outstandingError) {
      setError(outstandingError.message || "Failed to load outstanding invoices.");
      setIsAllocationsLoading(false);
      return;
    }

    const { data: allocationsData, error: allocationsError } = await supabase
      .from("erp_ap_vendor_payment_allocations")
      .select(
        "invoice_id, allocated_amount, erp_gst_purchase_invoices(invoice_no, invoice_date, due_date, computed_invoice_total, computed_taxable, computed_total_tax)"
      )
      .eq("company_id", currentPayment.company_id)
      .eq("payment_id", currentPayment.id)
      .eq("is_void", false);

    if (allocationsError) {
      setError(allocationsError.message || "Failed to load payment allocations.");
      setIsAllocationsLoading(false);
      return;
    }

    const existingAllocations = new Map<string, { allocated: number; invoice: any }>();
    (allocationsData || []).forEach((row: any) => {
      existingAllocations.set(row.invoice_id, {
        allocated: Number(row.allocated_amount || 0),
        invoice: row.erp_gst_purchase_invoices || null,
      });
    });

    const rows: InvoiceAllocationRow[] = (outstandingData || []).map((row: any) => {
      const existing = existingAllocations.get(row.invoice_id);
      return {
        invoice_id: row.invoice_id,
        invoice_no: row.invoice_no ?? null,
        invoice_date: row.invoice_date ?? null,
        due_date: row.due_date ?? null,
        invoice_total: Number(row.invoice_total || 0),
        outstanding_amount: Number(row.outstanding_amount || 0),
        allocated_amount: existing?.allocated ?? 0,
      };
    });

    existingAllocations.forEach((value, invoiceId) => {
      if (rows.find((row) => row.invoice_id === invoiceId)) return;
      const invoice = value.invoice;
      const invoiceTotal =
        Number(invoice?.computed_invoice_total || 0) ||
        Number(invoice?.computed_taxable || 0) + Number(invoice?.computed_total_tax || 0);
      rows.push({
        invoice_id: invoiceId,
        invoice_no: invoice?.invoice_no ?? null,
        invoice_date: invoice?.invoice_date ?? null,
        due_date: invoice?.due_date ?? null,
        invoice_total: invoiceTotal,
        outstanding_amount: Math.max(invoiceTotal - value.allocated, 0),
        allocated_amount: value.allocated,
      });
    });

    setInvoiceAllocations(rows);
    setIsAllocationsLoading(false);
  };

  useEffect(() => {
    if (!paymentId) return;
    void loadPayment();
  }, [paymentId]);

  useEffect(() => {
    if (!payment) return;
    void loadAllocations(payment);
  }, [payment?.id, payment?.vendor_id]);

  const openEdit = () => {
    if (!payment) return;
    setFormVendorId(payment.vendor_id);
    setFormPaymentDate(payment.payment_date);
    setFormAmount(String(payment.amount));
    setFormPaymentAccount(payment.payment_instrument_id || "");
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
      paymentInstrumentId: formPaymentAccount || null,
      currency: payment.currency || "INR",
      mode: payment.mode || "bank",
      reference: formReference || null,
      notes: formNote || null,
      source: payment.source || "manual",
      sourceRef: payment.source_ref || null,
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

  const handlePostBypass = async () => {
    if (!payment) return;
    setIsApproving(true);
    setToast(null);
    try {
      await apiPost(
        "/api/finance/ap/vendor-payments/post",
        { paymentId: payment.id },
        { headers: getAuthHeaders() }
      );
      setToast({ type: "success", message: "Vendor payment approved and posted." });
      await loadPayment();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to approve payment.";
      setToast({ type: "error", message });
    } finally {
      setIsApproving(false);
    }
  };

  const handleSubmit = async () => {
    if (!payment || !ctx?.companyId) return;
    setIsApproving(true);
    setToast(null);
    try {
      await apiPost(
        "/api/finance/approvals/submit",
        {
          companyId: ctx.companyId,
          entityType: "ap_payment",
          entityId: payment.id,
          note: null,
        },
        { headers: getAuthHeaders() }
      );
      setToast({ type: "success", message: "Vendor payment submitted for approval." });
      await loadApproval(ctx.companyId, payment.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to submit payment.";
      setToast({ type: "error", message });
    } finally {
      setIsApproving(false);
    }
  };

  const handleApprove = async () => {
    if (!payment || !ctx?.companyId) return;
    const comment = window.prompt("Approval note (optional):")?.trim() || null;
    setIsApproving(true);
    setToast(null);
    try {
      await apiPost(
        "/api/finance/approvals/approve",
        {
          companyId: ctx.companyId,
          entityType: "ap_payment",
          entityId: payment.id,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setToast({ type: "success", message: "Vendor payment approved and posted." });
      await loadPayment();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to approve payment.";
      setToast({ type: "error", message });
    } finally {
      setIsApproving(false);
    }
  };

  const handleReject = async () => {
    if (!payment || !ctx?.companyId) return;
    const comment = window.prompt("Rejection reason (optional):")?.trim() || null;
    setIsApproving(true);
    setToast(null);
    try {
      await apiPost(
        "/api/finance/approvals/reject",
        {
          companyId: ctx.companyId,
          entityType: "ap_payment",
          entityId: payment.id,
          comment,
        },
        { headers: getAuthHeaders() }
      );
      setToast({ type: "success", message: "Vendor payment rejected." });
      await loadApproval(ctx.companyId, payment.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to reject payment.";
      setToast({ type: "error", message });
    } finally {
      setIsApproving(false);
    }
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

  const handleSaveAllocations = async () => {
    if (!payment) return;
    setIsAllocationsSaving(true);
    setToast(null);

    const payload = invoiceAllocations
      .filter((row) => row.allocated_amount > 0)
      .map((row) => ({
        purchase_invoice_id: row.invoice_id,
        amount: row.allocated_amount,
      }));

    const totalAllocated = payload.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    if (totalAllocated > payment.amount) {
      setToast({ type: "error", message: "Total allocations exceed the payment amount." });
      setIsAllocationsSaving(false);
      return;
    }

    const { error: allocationError } = await setVendorPaymentAllocations(payment.id, payload);
    if (allocationError) {
      setToast({ type: "error", message: allocationError.message || "Failed to save allocations." });
      setIsAllocationsSaving(false);
      return;
    }

    setToast({ type: "success", message: "Allocations updated." });
    setIsAllocationsSaving(false);
    await loadAllocations(payment);
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
                disabled={!canWrite || payment.is_void || payment.status !== "draft"}
              >
                Edit
              </button>
              {payment.status === "draft" && canWrite ? (
                canBypass ? (
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={handlePostBypass}
                    disabled={isApproving}
                  >
                    {isApproving ? "Posting…" : "Post"}
                  </button>
                ) : approvalState === "submitted" ? (
                  <>
                    <button
                      type="button"
                      style={primaryButtonStyle}
                      onClick={handleApprove}
                      disabled={isApproving}
                    >
                      {isApproving ? "Approving…" : "Approve"}
                    </button>
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={handleReject}
                      disabled={isApproving}
                    >
                      Reject
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={handleSubmit}
                    disabled={isApproving}
                  >
                    {isApproving ? "Submitting…" : "Submit for Approval"}
                  </button>
                )
              ) : null}
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setIsVoidOpen(true)}
                disabled={!canWrite || payment.is_void || payment.status !== "approved" || payment.matched}
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
              <p style={subtitleStyle}>Payment date</p>
              <strong>{payment.payment_date}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Amount</p>
              <strong>{formatCurrency(payment.amount, payment.currency || "INR")}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Reference</p>
              <strong>{payment.reference_no || "—"}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Status</p>
              <span style={badgeStyle}>{payment.status}</span>
            </div>
            <div>
              <p style={subtitleStyle}>Accounting</p>
              <strong>{payment.finance_journal_id ? "Posted" : "Pending"}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Journal doc no</p>
              <strong>{payment.journal_doc_no || "—"}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Approval state</p>
              <strong>{approvalLoading ? "Loading…" : approvalState}</strong>
            </div>
          </div>
          <div>
            <p style={subtitleStyle}>Notes</p>
            <p>{payment.note || "—"}</p>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ color: "#6b7280" }}>
              Requested by: {approval?.requested_by || "—"} · {approval?.requested_at || "—"}
            </div>
            <div style={{ color: "#6b7280" }}>
              Reviewed by: {approval?.reviewed_by || "—"} · {approval?.reviewed_at || "—"}
            </div>
            <div style={{ color: "#6b7280" }}>Review note: {approval?.review_comment || "—"}</div>
            {payment.finance_journal_id ? (
              <div style={{ color: "#6b7280" }}>
                Journal:{" "}
                <Link href={`/erp/finance/journals/${payment.finance_journal_id}`}>
                  {payment.finance_journal_id}
                </Link>
              </div>
            ) : null}
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
          <h3 style={{ marginTop: 0 }}>Allocations</h3>
          <p style={subtitleStyle}>
            Allocate this payment against open vendor bills. Total allocations must be ≤{" "}
            {formatCurrency(payment.amount, payment.currency || "INR")}.
          </p>
          {isAllocationsLoading ? <p>Loading allocations…</p> : null}
          {!isAllocationsLoading && invoiceAllocations.length === 0 ? (
            <p style={subtitleStyle}>No outstanding invoices found for this vendor.</p>
          ) : null}
          {!isAllocationsLoading && invoiceAllocations.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Invoice</th>
                    <th style={tableHeaderCellStyle}>Invoice Date</th>
                    <th style={tableHeaderCellStyle}>Invoice Total</th>
                    <th style={tableHeaderCellStyle}>Outstanding</th>
                    <th style={tableHeaderCellStyle}>Allocate</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceAllocations.map((row) => (
                    <tr key={row.invoice_id}>
                      <td style={tableCellStyle}>{row.invoice_no || row.invoice_id}</td>
                      <td style={tableCellStyle}>{row.invoice_date || "—"}</td>
                      <td style={tableCellStyle}>
                        {formatCurrency(row.invoice_total, payment.currency || "INR")}
                      </td>
                      <td style={tableCellStyle}>
                        {formatCurrency(row.outstanding_amount, payment.currency || "INR")}
                      </td>
                      <td style={tableCellStyle}>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.allocated_amount}
                          style={inputStyle}
                          disabled={!canWrite || payment.status !== "draft"}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value || 0);
                            setInvoiceAllocations((prev) =>
                              prev.map((item) =>
                                item.invoice_id === row.invoice_id
                                  ? { ...item, allocated_amount: Number.isFinite(nextValue) ? nextValue : 0 }
                                  : item
                              )
                            );
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginTop: 16 }}>
            <div>
              <p style={subtitleStyle}>Allocated</p>
              <strong>{formatCurrency(totalAllocated, payment.currency || "INR")}</strong>
            </div>
            <div>
              <p style={subtitleStyle}>Remaining</p>
              <strong>
                {formatCurrency(Math.max(payment.amount - totalAllocated, 0), payment.currency || "INR")}
              </strong>
            </div>
            <button
              type="button"
              style={primaryButtonStyle}
              onClick={handleSaveAllocations}
              disabled={!canWrite || payment.status !== "draft" || isAllocationsSaving}
            >
              {isAllocationsSaving ? "Saving…" : "Save allocations"}
            </button>
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
                  <span>Reference: {payment.matched_bank_txn_id || "—"}</span>
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
                <span>Payment account</span>
                <select
                  value={formPaymentAccount}
                  onChange={(e) => setFormPaymentAccount(e.target.value)}
                  style={inputStyle}
                >
                  <option value="">Select payment account</option>
                  {paymentAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} · {account.name}
                    </option>
                  ))}
                </select>
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
