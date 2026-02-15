import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
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
} from "../../../../../components/erp/uiStyles";
import { apiFetch } from "../../../../../lib/erp/apiFetch";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { downloadCsv, type CsvColumn } from "../../../../../lib/erp/exportCsv";
import { supabase } from "../../../../../lib/supabaseClient";

const today = () => new Date().toISOString().slice(0, 10);

const last90Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

type VendorOption = { id: string; legal_name: string };

type VendorBalanceRow = {
  vendor_id: string;
  vendor_name: string | null;
  total_bills: number | null;
  total_payments: number | null;
  total_advances: number | null;
  net_payable: number | null;
};

type VendorAgingRow = {
  vendor_id: string;
  vendor_name: string | null;
  bucket_0_30: number | null;
  bucket_31_60: number | null;
  bucket_61_90: number | null;
  bucket_90_plus: number | null;
  outstanding_total: number | null;
};

type InvoiceOutstandingRow = {
  invoice_id: string;
  vendor_id: string;
  vendor_name: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  invoice_total: number | null;
  allocated_total: number | null;
  outstanding_amount: number | null;
  currency: string | null;
  source: string | null;
  validation_status: string | null;
  is_void: boolean | null;
};

type PaymentUnallocatedRow = {
  payment_id: string;
  vendor_id: string;
  vendor_name: string | null;
  payment_date: string | null;
  payment_amount: number | null;
  allocated_total: number | null;
  unallocated_amount: number | null;
  currency: string | null;
  mode: string | null;
  reference_no: string | null;
  note: string | null;
  source: string | null;
  is_void: boolean | null;
  matched: boolean | null;
  matched_bank_txn_id: string | null;
  matched_bank_txn_date: string | null;
  matched_bank_txn_amount: number | null;
  matched_bank_txn_description: string | null;
};

type AllocationRow = {
  allocation_id: string;
  invoice_id: string;
  payment_id: string;
  vendor_id: string;
  allocated_amount: number;
  allocation_date: string;
  note: string | null;
  source: string | null;
  source_ref: string | null;
  is_void: boolean;
  void_reason: string | null;
  voided_at: string | null;
  voided_by: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  payment_date: string | null;
  payment_amount: number | null;
  payment_currency: string | null;
  payment_mode: string | null;
  payment_reference_no: string | null;
  payment_note: string | null;
  payment_source: string | null;
  payment_source_ref: string | null;
  matched: boolean | null;
  matched_bank_txn_id: string | null;
  matched_bank_txn_date: string | null;
  matched_bank_txn_amount: number | null;
  matched_bank_txn_description: string | null;
};

type ToastState = { type: "success" | "error"; message: string } | null;

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

const formatAmount = (value: number | null, currency: string | null) => {
  if (value == null) return "—";
  const safeCurrency = currency || "INR";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: safeCurrency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (error) {
    return `${safeCurrency} ${value.toLocaleString("en-IN")}`;
  }
};

/**
 * Dependency map:
 * UI: /erp/finance/ap/outstanding -> GET /api/finance/ap/vendor-balances
 * API: vendor-balances -> RPC: erp_ap_vendor_balances
 * RPC tables: erp_gst_purchase_invoices, erp_ap_vendor_payments, erp_ap_vendor_advances, erp_vendors
 *
 * UI: /erp/finance/ap/outstanding -> GET /api/finance/ap/vendor-aging
 * API: vendor-aging -> RPC: erp_ap_vendor_aging
 * RPC tables: erp_gst_purchase_invoices, erp_ap_vendor_payment_allocations, erp_vendors
 *
 * UI: /erp/finance/ap/outstanding -> RPC: erp_ap_invoices_outstanding_list
 * RPC tables: erp_gst_purchase_invoices, erp_ap_vendor_payment_allocations, erp_vendors
 *
 * UI: /erp/finance/ap/outstanding -> RPC: erp_ap_payments_unallocated_list
 * RPC tables: erp_ap_vendor_payments, erp_ap_vendor_payment_allocations, erp_vendors, erp_bank_transactions
 *
 * UI: /erp/finance/ap/outstanding -> RPC: erp_ap_allocations_for_invoice
 * RPC tables: erp_ap_vendor_payment_allocations, erp_ap_vendor_payments, erp_bank_transactions
 *
 * UI: /erp/finance/ap/outstanding -> RPC: erp_ap_allocate_vendor_payment
 * RPC tables: erp_ap_vendor_payment_allocations, erp_ap_vendor_payments, erp_gst_purchase_invoices
 *
 * UI: /erp/finance/ap/outstanding -> RPC: erp_ap_allocation_void
 * RPC tables: erp_ap_vendor_payment_allocations
 */
export default function ApOutstandingPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => last90Days(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [asOfDate, setAsOfDate] = useState(today());
  const [balanceRows, setBalanceRows] = useState<VendorBalanceRow[]>([]);
  const [agingRows, setAgingRows] = useState<VendorAgingRow[]>([]);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [agingError, setAgingError] = useState<string | null>(null);
  const [isBalancesLoading, setIsBalancesLoading] = useState(false);
  const [isAgingLoading, setIsAgingLoading] = useState(false);
  const [fromDate, setFromDate] = useState(start);
  const [toDate, setToDate] = useState(end);
  const [vendorId, setVendorId] = useState("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [invoiceRows, setInvoiceRows] = useState<InvoiceOutstandingRow[]>([]);
  const [paymentRows, setPaymentRows] = useState<PaymentUnallocatedRow[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [selectedPaymentId, setSelectedPaymentId] = useState<string | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [isAllocationsLoading, setIsAllocationsLoading] = useState(false);
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const [allocationAmount, setAllocationAmount] = useState("");
  const [allocationDate, setAllocationDate] = useState(today());
  const [allocationNote, setAllocationNote] = useState("");
  const [isSavingAllocation, setIsSavingAllocation] = useState(false);
  const hasAppliedQuery = useRef(false);

  const selectedInvoice = useMemo(
    () => invoiceRows.find((row) => row.invoice_id === selectedInvoiceId) || null,
    [invoiceRows, selectedInvoiceId]
  );

  const selectedPayment = useMemo(
    () => paymentRows.find((row) => row.payment_id === selectedPaymentId) || null,
    [paymentRows, selectedPaymentId]
  );

  const canAllocate = useMemo(() => {
    if (!selectedInvoice || !selectedPayment) return false;
    if (selectedInvoice.is_void || selectedPayment.is_void) return false;
    if (selectedInvoice.vendor_id !== selectedPayment.vendor_id) return false;
    const invoiceOutstanding = selectedInvoice.outstanding_amount ?? 0;
    const paymentUnallocated = selectedPayment.unallocated_amount ?? 0;
    return invoiceOutstanding > 0 && paymentUnallocated > 0;
  }, [selectedInvoice, selectedPayment]);

  const handleBalancesExport = () => {
    if (balanceRows.length === 0) return;
    const columns: CsvColumn<VendorBalanceRow>[] = [
      { header: "Vendor", accessor: (row) => row.vendor_name ?? "" },
      { header: "Total Bills", accessor: (row) => `${row.total_bills ?? 0}` },
      { header: "Total Payments", accessor: (row) => `${row.total_payments ?? 0}` },
      { header: "Total Advances", accessor: (row) => `${row.total_advances ?? 0}` },
      { header: "Net Payable", accessor: (row) => `${row.net_payable ?? 0}` },
    ];
    downloadCsv(`ap-vendor-balances-${asOfDate}.csv`, columns, balanceRows);
  };

  const handleAgingExport = () => {
    if (agingRows.length === 0) return;
    const columns: CsvColumn<VendorAgingRow>[] = [
      { header: "Vendor", accessor: (row) => row.vendor_name ?? "" },
      { header: "0-30", accessor: (row) => `${row.bucket_0_30 ?? 0}` },
      { header: "31-60", accessor: (row) => `${row.bucket_31_60 ?? 0}` },
      { header: "61-90", accessor: (row) => `${row.bucket_61_90 ?? 0}` },
      { header: "90+", accessor: (row) => `${row.bucket_90_plus ?? 0}` },
      { header: "Outstanding Total", accessor: (row) => `${row.outstanding_total ?? 0}` },
    ];
    downloadCsv(`ap-vendor-aging-${asOfDate}.csv`, columns, agingRows);
  };

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
    if (!router.isReady || hasAppliedQuery.current) return;
    const vendorFromQuery = typeof router.query.vendorId === "string" ? router.query.vendorId : "";
    const queryFromQuery = typeof router.query.q === "string" ? router.query.q : "";
    if (vendorFromQuery) {
      setVendorId(vendorFromQuery);
    }
    if (queryFromQuery) {
      setQueryInput(queryFromQuery);
      setQuery(queryFromQuery);
    }
    hasAppliedQuery.current = true;
  }, [router.isReady, router.query.vendorId, router.query.q]);

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

  const loadBalances = async () => {
    if (!ctx?.session?.access_token) return;
    setIsBalancesLoading(true);
    setBalanceError(null);
    const params = new URLSearchParams();
    if (vendorId) params.set("vendorId", vendorId);
    if (asOfDate) params.set("asOf", asOfDate);
    const res = await apiFetch(`/api/finance/ap/vendor-balances?${params.toString()}`, {
      headers: { Authorization: `Bearer ${ctx.session.access_token}` },
    });
    const payload = (await res.json()) as { ok: boolean; data?: VendorBalanceRow[]; error?: string };
    if (!res.ok || !payload.ok) {
      setBalanceError(payload.error || "Failed to load vendor balances.");
      setIsBalancesLoading(false);
      return;
    }
    setBalanceRows(payload.data || []);
    setIsBalancesLoading(false);
  };

  const loadAging = async () => {
    if (!ctx?.session?.access_token) return;
    setIsAgingLoading(true);
    setAgingError(null);
    const params = new URLSearchParams();
    if (vendorId) params.set("vendorId", vendorId);
    if (asOfDate) params.set("asOf", asOfDate);
    const res = await apiFetch(`/api/finance/ap/vendor-aging?${params.toString()}`, {
      headers: { Authorization: `Bearer ${ctx.session.access_token}` },
    });
    const payload = (await res.json()) as { ok: boolean; data?: VendorAgingRow[]; error?: string };
    if (!res.ok || !payload.ok) {
      setAgingError(payload.error || "Failed to load vendor aging.");
      setIsAgingLoading(false);
      return;
    }
    setAgingRows(payload.data || []);
    setIsAgingLoading(false);
  };

  useEffect(() => {
    if (!ctx?.session?.access_token) return;
    void loadBalances();
    void loadAging();
  }, [ctx?.session?.access_token, vendorId, asOfDate]);

  const loadAllocations = async (invoiceId: string | null) => {
    if (!ctx?.companyId || !invoiceId) {
      setAllocations([]);
      return;
    }
    setIsAllocationsLoading(true);

    const { data, error: loadError } = await supabase.rpc("erp_ap_allocations_for_invoice", {
      p_invoice_id: invoiceId,
    });

    if (loadError) {
      setError(loadError.message || "Failed to load allocations.");
      setIsAllocationsLoading(false);
      return;
    }

    setAllocations((data || []) as AllocationRow[]);
    setIsAllocationsLoading(false);
  };

  const loadData = async () => {
    if (!ctx?.companyId) return;
    setIsLoadingData(true);
    setError(null);
    setToast(null);

    const { data: invoices, error: invoiceError } = await supabase.rpc(
      "erp_ap_invoices_outstanding_list",
      {
        p_vendor_id: vendorId || null,
        p_from: fromDate || null,
        p_to: toDate || null,
        p_q: query.trim() || null,
        p_limit: 200,
        p_offset: 0,
      }
    );

    if (invoiceError) {
      setError(invoiceError.message || "Failed to load outstanding invoices.");
      setIsLoadingData(false);
      return;
    }

    const { data: payments, error: paymentError } = await supabase.rpc(
      "erp_ap_payments_unallocated_list",
      {
        p_vendor_id: vendorId || null,
        p_from: fromDate || null,
        p_to: toDate || null,
        p_q: query.trim() || null,
        p_limit: 200,
        p_offset: 0,
      }
    );

    if (paymentError) {
      setError(paymentError.message || "Failed to load unallocated payments.");
      setIsLoadingData(false);
      return;
    }

    const invoiceRowsData = (invoices || []) as InvoiceOutstandingRow[];
    const paymentRowsData = (payments || []) as PaymentUnallocatedRow[];

    const nextInvoiceId =
      selectedInvoiceId && invoiceRowsData.some((row) => row.invoice_id === selectedInvoiceId)
        ? selectedInvoiceId
        : null;
    const nextPaymentId =
      selectedPaymentId && paymentRowsData.some((row) => row.payment_id === selectedPaymentId)
        ? selectedPaymentId
        : null;

    setInvoiceRows(invoiceRowsData);
    setPaymentRows(paymentRowsData);
    setSelectedInvoiceId(nextInvoiceId);
    setSelectedPaymentId(nextPaymentId);
    await loadAllocations(nextInvoiceId);

    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadData();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId, fromDate, toDate, vendorId, query]);

  useEffect(() => {
    (async () => {
      await loadAllocations(selectedInvoiceId);
    })();
  }, [selectedInvoiceId]);

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    setQuery(queryInput);
  };

  const handleReset = () => {
    setFromDate(start);
    setToDate(end);
    setVendorId("");
    setQueryInput("");
    setQuery("");
    setSelectedInvoiceId(null);
    setSelectedPaymentId(null);
  };

  const openAllocationModal = () => {
    if (!selectedInvoice || !selectedPayment) return;
    const invoiceOutstanding = selectedInvoice.outstanding_amount ?? 0;
    const paymentUnallocated = selectedPayment.unallocated_amount ?? 0;
    const defaultAmount = Math.min(invoiceOutstanding, paymentUnallocated);
    setAllocationAmount(defaultAmount > 0 ? defaultAmount.toString() : "");
    setAllocationDate(today());
    setAllocationNote("");
    setAllocationModalOpen(true);
  };

  const handleAllocate = async () => {
    if (!selectedInvoice || !selectedPayment) return;
    const amountValue = Number(allocationAmount.replace(/,/g, ""));
    if (!Number.isFinite(amountValue) || amountValue <= 0) return;

    setIsSavingAllocation(true);
    setToast(null);

    const { error: allocateError } = await supabase.rpc("erp_ap_allocate_vendor_payment", {
      p_vendor_id: selectedInvoice.vendor_id,
      p_invoice_id: selectedInvoice.invoice_id,
      p_payment_id: selectedPayment.payment_id,
      p_allocated_amount: amountValue,
      p_allocation_date: allocationDate,
      p_note: allocationNote || null,
      p_source: "manual",
      p_source_ref: null,
    });

    if (allocateError) {
      setToast({ type: "error", message: allocateError.message || "Failed to allocate payment." });
      setIsSavingAllocation(false);
      return;
    }

    setAllocationModalOpen(false);
    setIsSavingAllocation(false);
    setToast({ type: "success", message: "Allocation saved." });
    await loadData();
    await loadAllocations(selectedInvoice?.invoice_id ?? null);
  };

  const handleVoidAllocation = async (allocation: AllocationRow) => {
    const reason = window.prompt("Provide a void reason for this allocation.");
    if (!reason) return;

    setToast(null);

    const { error: voidError } = await supabase.rpc("erp_ap_allocation_void", {
      p_allocation_id: allocation.allocation_id,
      p_void_reason: reason,
    });

    if (voidError) {
      setToast({ type: "error", message: voidError.message || "Failed to void allocation." });
      return;
    }

    setToast({ type: "success", message: "Allocation voided." });
    await loadData();
    await loadAllocations(selectedInvoice?.invoice_id ?? null);
  };

  if (loading) {
    return (
      <>
        <div style={pageContainerStyle}>Loading AP outstanding…</div>
      </>
    );
  }

  if (!ctx?.companyId) {
    return (
      <>
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="AP Outstanding"
            description="Allocate vendor payments against purchase invoices."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="AP Outstanding"
          description="Allocate vendor payments to outstanding invoices."
          rightActions={
            <div style={{ display: "flex", gap: 12 }}>
              <Link href="/erp/finance/ap/vendor-ledger" style={secondaryButtonStyle}>
                Vendor Ledger
              </Link>
              <Link href="/erp/finance" style={secondaryButtonStyle}>
                Back to Finance
              </Link>
            </div>
          }
        />

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2", color: "#b91c1c" }}>
            {error}
          </div>
        ) : null}

        <section style={cardStyle}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            <div>
              <label style={subtitleStyle}>As of date</label>
              <input
                type="date"
                value={asOfDate}
                style={inputStyle}
                onChange={(event) => setAsOfDate(event.target.value)}
              />
            </div>
            <div>
              <label style={subtitleStyle}>Vendor filter</label>
              <select value={vendorId} style={inputStyle} onChange={(event) => setVendorId(event.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button type="button" style={secondaryButtonStyle} onClick={handleBalancesExport}>
                Export balances CSV
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleAgingExport}>
                Export aging CSV
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Vendor balances</h3>
          {balanceError ? <p style={{ color: "#b91c1c" }}>{balanceError}</p> : null}
          {isBalancesLoading ? <p>Loading balances…</p> : null}
          {!isBalancesLoading && balanceRows.length === 0 ? (
            <p style={subtitleStyle}>No vendor balances found.</p>
          ) : null}
          {balanceRows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Total Bills</th>
                    <th style={tableHeaderCellStyle}>Total Payments</th>
                    <th style={tableHeaderCellStyle}>Total Advances</th>
                    <th style={tableHeaderCellStyle}>Net Payable</th>
                  </tr>
                </thead>
                <tbody>
                  {balanceRows.map((row) => (
                    <tr key={row.vendor_id}>
                      <td style={tableCellStyle}>{row.vendor_name || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.total_bills, "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.total_payments, "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.total_advances, "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.net_payable, "INR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Vendor aging</h3>
          {agingError ? <p style={{ color: "#b91c1c" }}>{agingError}</p> : null}
          {isAgingLoading ? <p>Loading aging…</p> : null}
          {!isAgingLoading && agingRows.length === 0 ? (
            <p style={subtitleStyle}>No aging data available.</p>
          ) : null}
          {agingRows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>0-30</th>
                    <th style={tableHeaderCellStyle}>31-60</th>
                    <th style={tableHeaderCellStyle}>61-90</th>
                    <th style={tableHeaderCellStyle}>90+</th>
                    <th style={tableHeaderCellStyle}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {agingRows.map((row) => (
                    <tr key={row.vendor_id}>
                      <td style={tableCellStyle}>{row.vendor_name || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.bucket_0_30, "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.bucket_31_60, "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.bucket_61_90, "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.bucket_90_plus, "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.outstanding_total, "INR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>

        <section style={cardStyle}>
          <form onSubmit={handleSearch} style={filterGridStyle}>
            <label style={filterLabelStyle}>
              <span>From</span>
              <input
                type="date"
                value={fromDate}
                style={inputStyle}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label style={filterLabelStyle}>
              <span>To</span>
              <input
                type="date"
                value={toDate}
                style={inputStyle}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <label style={filterLabelStyle}>
              <span>Vendor</span>
              <select value={vendorId} style={inputStyle} onChange={(event) => setVendorId(event.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={filterLabelStyle}>
              <span>Search</span>
              <input
                value={queryInput}
                onChange={(event) => setQueryInput(event.target.value)}
                placeholder="Invoice no, vendor, reference..."
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" style={primaryButtonStyle}>
                Search
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleReset}>
                Reset
              </button>
            </div>
          </form>
        </section>

        {toast && (
          <section style={{ ...cardStyle, borderColor: toast.type === "error" ? "#fecaca" : "#bbf7d0" }}>
            <strong>{toast.message}</strong>
          </section>
        )}

        <section style={cardStyle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "space-between" }}>
            <div>
              <strong>Selected Invoice</strong>
              <div style={subtitleStyle}>
                {selectedInvoice
                  ? `${selectedInvoice.invoice_no || "Invoice"} · ${formatAmount(
                      selectedInvoice.outstanding_amount,
                      selectedInvoice.currency
                    )} outstanding`
                  : "None"}
              </div>
            </div>
            <div>
              <strong>Selected Payment</strong>
              <div style={subtitleStyle}>
                {selectedPayment
                  ? `${formatDate(selectedPayment.payment_date)} · ${formatAmount(
                      selectedPayment.unallocated_amount,
                      selectedPayment.currency
                    )} unallocated`
                  : "None"}
              </div>
            </div>
            <button type="button" style={primaryButtonStyle} onClick={openAllocationModal} disabled={!canAllocate}>
              Allocate
            </button>
          </div>
        </section>

        <div style={panelGridStyle}>
          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Outstanding Invoices</h3>
            <p style={subtitleStyle}>Select an invoice to view allocations and assign payments.</p>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Invoice Date</th>
                    <th style={tableHeaderCellStyle}>Invoice No</th>
                    <th style={tableHeaderCellStyle}>Total</th>
                    <th style={tableHeaderCellStyle}>Allocated</th>
                    <th style={tableHeaderCellStyle}>Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingData && (
                    <tr>
                      <td style={tableCellStyle} colSpan={5}>
                        Loading invoices...
                      </td>
                    </tr>
                  )}
                  {!isLoadingData && invoiceRows.length === 0 && (
                    <tr>
                      <td style={tableCellStyle} colSpan={5}>
                        No outstanding invoices found.
                      </td>
                    </tr>
                  )}
                  {invoiceRows.map((row) => {
                    const isSelected = row.invoice_id === selectedInvoiceId;
                    return (
                      <tr
                        key={row.invoice_id}
                        style={{
                          cursor: "pointer",
                          backgroundColor: isSelected ? "#f1f5f9" : undefined,
                          opacity: row.is_void ? 0.6 : 1,
                        }}
                        onClick={() => {
                          setSelectedInvoiceId(row.invoice_id);
                          if (selectedPayment && selectedPayment.vendor_id !== row.vendor_id) {
                            setSelectedPaymentId(null);
                          }
                        }}
                      >
                        <td style={tableCellStyle}>{formatDate(row.invoice_date)}</td>
                        <td style={tableCellStyle}>{row.invoice_no || "—"}</td>
                        <td style={tableCellStyle}>{formatAmount(row.invoice_total, row.currency)}</td>
                        <td style={tableCellStyle}>{formatAmount(row.allocated_total, row.currency)}</td>
                        <td style={tableCellStyle}>{formatAmount(row.outstanding_amount, row.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 20 }}>
              <h4 style={{ marginBottom: 8 }}>Allocations</h4>
              {!selectedInvoice && <p style={subtitleStyle}>Select an invoice to view allocations.</p>}
              {selectedInvoice && isAllocationsLoading && <p style={subtitleStyle}>Loading allocations...</p>}
              {selectedInvoice && !isAllocationsLoading && allocations.length === 0 && (
                <p style={subtitleStyle}>No allocations for this invoice yet.</p>
              )}
              {selectedInvoice && allocations.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={tableHeaderCellStyle}>Payment Date</th>
                        <th style={tableHeaderCellStyle}>Amount</th>
                        <th style={tableHeaderCellStyle}>Note</th>
                        <th style={tableHeaderCellStyle}>Matched</th>
                        <th style={tableHeaderCellStyle}>Status</th>
                        <th style={tableHeaderCellStyle}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allocations.map((allocation) => (
                        <tr key={allocation.allocation_id} style={{ opacity: allocation.is_void ? 0.6 : 1 }}>
                          <td style={tableCellStyle}>{formatDate(allocation.payment_date)}</td>
                          <td style={tableCellStyle}>
                            {formatAmount(allocation.allocated_amount, allocation.payment_currency)}
                          </td>
                          <td style={tableCellStyle}>{allocation.note || "—"}</td>
                          <td style={tableCellStyle}>
                            {allocation.matched ? (
                              <span
                                title={allocation.matched_bank_txn_description || undefined}
                                style={{ ...badgeStyle, backgroundColor: "#dcfce7", color: "#166534" }}
                              >
                                Yes
                              </span>
                            ) : (
                              <span style={{ ...badgeStyle, backgroundColor: "#f3f4f6", color: "#6b7280" }}>
                                No
                              </span>
                            )}
                          </td>
                          <td style={tableCellStyle}>
                            {allocation.is_void ? (
                              <span style={{ ...badgeStyle, backgroundColor: "#fee2e2", color: "#b91c1c" }}>
                                VOID
                              </span>
                            ) : (
                              <span style={{ ...badgeStyle, backgroundColor: "#e0f2fe", color: "#0369a1" }}>
                                Active
                              </span>
                            )}
                          </td>
                          <td style={tableCellStyle}>
                            <button
                              type="button"
                              style={secondaryButtonStyle}
                              onClick={() => handleVoidAllocation(allocation)}
                              disabled={allocation.is_void}
                            >
                              Void
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section style={cardStyle}>
            <h3 style={{ marginTop: 0 }}>Unallocated Payments</h3>
            <p style={subtitleStyle}>Select a payment to allocate against an invoice.</p>
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Payment Date</th>
                    <th style={tableHeaderCellStyle}>Amount</th>
                    <th style={tableHeaderCellStyle}>Allocated</th>
                    <th style={tableHeaderCellStyle}>Unallocated</th>
                    <th style={tableHeaderCellStyle}>Matched</th>
                    <th style={tableHeaderCellStyle}>Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoadingData && (
                    <tr>
                      <td style={tableCellStyle} colSpan={6}>
                        Loading payments...
                      </td>
                    </tr>
                  )}
                  {!isLoadingData && paymentRows.length === 0 && (
                    <tr>
                      <td style={tableCellStyle} colSpan={6}>
                        No unallocated payments found.
                      </td>
                    </tr>
                  )}
                  {paymentRows.map((row) => {
                    const isSelected = row.payment_id === selectedPaymentId;
                    const matchedTooltip = row.matched
                      ? `Matched: ${row.matched_bank_txn_date ?? ""} · ${row.matched_bank_txn_amount ?? ""}`
                      : "";
                    return (
                      <tr
                        key={row.payment_id}
                        style={{
                          cursor: "pointer",
                          backgroundColor: isSelected ? "#f1f5f9" : undefined,
                          opacity: row.is_void ? 0.6 : 1,
                        }}
                        onClick={() => {
                          setSelectedPaymentId(row.payment_id);
                          if (selectedInvoice && selectedInvoice.vendor_id !== row.vendor_id) {
                            setSelectedInvoiceId(null);
                          }
                        }}
                      >
                        <td style={tableCellStyle}>{formatDate(row.payment_date)}</td>
                        <td style={tableCellStyle}>{formatAmount(row.payment_amount, row.currency)}</td>
                        <td style={tableCellStyle}>{formatAmount(row.allocated_total, row.currency)}</td>
                        <td style={tableCellStyle}>{formatAmount(row.unallocated_amount, row.currency)}</td>
                        <td style={tableCellStyle}>
                          {row.matched ? (
                            <span
                              title={matchedTooltip}
                              style={{ ...badgeStyle, backgroundColor: "#dcfce7", color: "#166534" }}
                            >
                              Yes
                            </span>
                          ) : (
                            <span style={{ ...badgeStyle, backgroundColor: "#f3f4f6", color: "#6b7280" }}>
                              No
                            </span>
                          )}
                        </td>
                        <td style={tableCellStyle}>{row.reference_no || row.note || "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {allocationModalOpen && (
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
            <h3 style={{ marginTop: 0 }}>Allocate payment</h3>
            <p style={subtitleStyle}>
              Allocate {selectedPayment?.reference_no || "payment"} to invoice {selectedInvoice?.invoice_no || ""}.
            </p>
            <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Allocated amount</span>
                <input
                  value={allocationAmount}
                  onChange={(event) => setAllocationAmount(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Allocation date</span>
                <input
                  type="date"
                  value={allocationDate}
                  onChange={(event) => setAllocationDate(event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={{ display: "grid", gap: 6 }}>
                <span>Note</span>
                <textarea
                  rows={3}
                  value={allocationNote}
                  onChange={(event) => setAllocationNote(event.target.value)}
                  style={{ ...inputStyle, minHeight: 90 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setAllocationModalOpen(false)}
                disabled={isSavingAllocation}
              >
                Cancel
              </button>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={handleAllocate}
                disabled={!canAllocate || !allocationAmount || !allocationDate || isSavingAllocation}
              >
                {isSavingAllocation ? "Allocating..." : "Confirm Allocation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const filterGridStyle = {
  display: "grid",
  gap: 12,
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  alignItems: "end",
};

const filterLabelStyle = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 6,
  fontSize: 13,
  color: "#4b5563",
};

const panelGridStyle = {
  display: "grid",
  gap: 24,
  gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
};
