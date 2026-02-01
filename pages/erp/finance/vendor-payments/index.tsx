import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
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
  approveVendorPayment,
  createVendorPaymentDraft,
  searchVendorPayments,
  vendorPaymentListSchema,
  type VendorPaymentRow,
} from "../../../../lib/erp/vendorPayments";

const today = () => new Date().toISOString().slice(0, 10);

const last30Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

type VendorOption = {
  id: string;
  legal_name: string;
};

type PaymentAccountOption = {
  id: string;
  code: string;
  name: string;
};

type ToastState = { type: "success" | "error"; message: string } | null;

// This is the canonical AP outgoing cash module. Do not create parallel payment UIs elsewhere.
export default function VendorPaymentsListPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => last30Days(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<PaymentAccountOption[]>([]);
  const [payments, setPayments] = useState<VendorPaymentRow[]>([]);
  const [dateStart, setDateStart] = useState(start);
  const [dateEnd, setDateEnd] = useState(end);
  const [vendorId, setVendorId] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPosting, setIsPosting] = useState<string | null>(null);

  const [formVendorId, setFormVendorId] = useState("");
  const [formPaymentDate, setFormPaymentDate] = useState(today());
  const [formAmount, setFormAmount] = useState("");
  const [formPaymentAccount, setFormPaymentAccount] = useState("");
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

  const loadPayments = async (targetOffset = offset) => {
    if (!ctx?.companyId) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);

    const { data, error: loadError } = await searchVendorPayments({
      from: dateStart,
      to: dateEnd,
      vendorId: vendorId || null,
      query: query.trim() || null,
      limit: 50,
      offset: targetOffset,
    });

    if (loadError) {
      setError(loadError.message || "Failed to load payments.");
      setIsLoadingData(false);
      return;
    }

    const parsed = vendorPaymentListSchema.safeParse(data ?? []);
    if (!parsed.success) {
      setError("Failed to parse vendor payments.");
      setIsLoadingData(false);
      return;
    }

    setPayments(parsed.data);
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadPayments(0);
      if (active) setOffset(0);
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, dateStart, dateEnd, vendorId]);

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setOffset(0);
    await loadPayments(0);
  };

  const resetForm = () => {
    setFormVendorId("");
    setFormPaymentDate(today());
    setFormAmount("");
    setFormPaymentAccount("");
    setFormReference("");
    setFormNote("");
  };

  const handleOpenCreate = () => {
    resetForm();
    setToast(null);
    setIsModalOpen(true);
  };

  const handleSavePayment = async () => {
    if (!formVendorId || !formPaymentDate || !formAmount) return;
    setIsSaving(true);
    setToast(null);

    const amount = Number(formAmount.replace(/,/g, ""));
    const { data, error: saveError } = await createVendorPaymentDraft({
      vendorId: formVendorId,
      paymentDate: formPaymentDate,
      amount: Number.isFinite(amount) ? amount : 0,
      paymentInstrumentId: formPaymentAccount || null,
      reference: formReference || null,
      notes: formNote || null,
    });

    if (saveError) {
      setToast({ type: "error", message: saveError.message || "Failed to save payment." });
      setIsSaving(false);
      return;
    }

    setIsSaving(false);
    setIsModalOpen(false);
    const newId = data as string | null;
    setToast({ type: "success", message: "Vendor payment saved as draft." });
    await loadPayments(0);
    if (newId) {
      void router.push(`/erp/finance/vendor-payments/${newId}`);
    }
  };

  const handleApprove = async (paymentId: string) => {
    setIsPosting(paymentId);
    setToast(null);
    const { error: approveError } = await approveVendorPayment(paymentId);

    if (approveError) {
      setToast({ type: "error", message: approveError.message || "Failed to approve payment." });
      setIsPosting(null);
      return;
    }

    setToast({ type: "success", message: "Vendor payment approved and posted." });
    setIsPosting(null);
    await loadPayments(0);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading...</div>
      </ErpShell>
    );
  }

  if (error) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader title="Vendor Payments" />
          <div style={cardStyle}>{error}</div>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          title="Vendor Payments"
          description="Record and match vendor payments against bank transactions."
          rightActions={
            <div style={{ display: "flex", gap: 12 }}>
              {canWrite && (
                <button style={primaryButtonStyle} onClick={handleOpenCreate}>
                  Create Payment
                </button>
              )}
            </div>
          }
        />

        <form onSubmit={handleSearch} style={{ ...cardStyle, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={subtitleStyle}>From</span>
              <input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={subtitleStyle}>To</span>
              <input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} style={inputStyle} />
            </label>
            <label style={{ display: "grid", gap: 6, minWidth: 220 }}>
              <span style={subtitleStyle}>Vendor</span>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} style={inputStyle}>
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, minWidth: 180 }}>
              <span style={subtitleStyle}>Status</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
                <option value="">All statuses</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="void">Void</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6, flex: 1, minWidth: 220 }}>
              <span style={subtitleStyle}>Search</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={inputStyle}
                placeholder="Reference, mode, note"
              />
            </label>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={primaryButtonStyle} type="submit">
              Search
            </button>
            <button
              style={secondaryButtonStyle}
              type="button"
              onClick={() => {
                setDateStart(start);
                setDateEnd(end);
                setVendorId("");
                setQuery("");
                setStatusFilter("");
                setOffset(0);
              }}
            >
              Reset
            </button>
          </div>
        </form>

        {toast && (
          <div style={{ ...cardStyle, borderColor: toast.type === "error" ? "#fecaca" : "#bbf7d0" }}>
            <strong>{toast.message}</strong>
          </div>
        )}

        <div style={{ ...cardStyle, padding: 0 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Payment Date</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                  <th style={tableHeaderCellStyle}>Accounting</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Journal Doc No</th>
                  <th style={tableHeaderCellStyle}>Allocations</th>
                  <th style={tableHeaderCellStyle}>Matched</th>
                  <th style={tableHeaderCellStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData && (
                  <tr>
                    <td style={tableCellStyle} colSpan={10}>
                      Loading payments...
                    </td>
                  </tr>
                )}
                {!isLoadingData && payments.length === 0 && (
                  <tr>
                    <td style={tableCellStyle} colSpan={10}>
                      No vendor payments found.
                    </td>
                  </tr>
                )}
                {payments
                  .filter((payment) => (statusFilter ? payment.status === statusFilter : true))
                  .map((payment) => {
                    const matchedTooltip = payment.matched
                      ? `Matched: ${payment.matched_bank_txn_date ?? ""} · ${payment.matched_bank_txn_amount ?? ""}`
                      : "";
                    return (
                      <tr
                        key={payment.id}
                        style={{
                          ...(payment.is_void ? { opacity: 0.6, backgroundColor: "#f9fafb" } : {}),
                        }}
                      >
                        <td style={tableCellStyle}>{payment.payment_date}</td>
                        <td style={tableCellStyle}>{payment.vendor_name || "—"}</td>
                        <td style={tableCellStyle}>
                          {payment.currency} {payment.amount.toLocaleString("en-IN")}
                        </td>
                        <td style={tableCellStyle}>
                          <span style={badgeStyle}>{payment.status}</span>
                        </td>
                        <td style={tableCellStyle}>
                          {payment.finance_journal_id ? "Posted" : payment.status === "draft" ? "Pending" : "—"}
                        </td>
                        <td style={tableCellStyle}>{payment.reference_no || "—"}</td>
                        <td style={tableCellStyle}>{payment.journal_doc_no || "—"}</td>
                        <td style={tableCellStyle}>{payment.allocation_count || 0}</td>
                        <td style={tableCellStyle}>
                          {payment.matched ? (
                            <span
                              title={matchedTooltip}
                              style={{ ...badgeStyle, backgroundColor: "#dcfce7", color: "#166534" }}
                            >
                              Yes
                            </span>
                          ) : (
                            <span style={{ ...badgeStyle, backgroundColor: "#f3f4f6", color: "#6b7280" }}>No</span>
                          )}
                        </td>
                        <td style={tableCellStyle}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button
                              style={secondaryButtonStyle}
                              onClick={() => router.push(`/erp/finance/vendor-payments/${payment.id}`)}
                            >
                              View
                            </button>
                            {canWrite && payment.status === "draft" ? (
                              <button
                                style={primaryButtonStyle}
                                onClick={() => handleApprove(payment.id)}
                                disabled={isPosting === payment.id}
                              >
                                {isPosting === payment.id ? "Posting…" : "Approve"}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: 16 }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={async () => {
                const nextOffset = Math.max(0, offset - 50);
                setOffset(nextOffset);
                await loadPayments(nextOffset);
              }}
              disabled={offset === 0}
            >
              Previous
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={async () => {
                const nextOffset = offset + 50;
                setOffset(nextOffset);
                await loadPayments(nextOffset);
              }}
              disabled={payments.length < 50}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {isModalOpen && (
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
            <h3 style={{ marginTop: 0 }}>Create vendor payment</h3>
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
                onClick={() => setIsModalOpen(false)}
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
                {isSaving ? "Saving..." : "Save Payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ErpShell>
  );
}
