import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import ErrorBanner from "../../../../components/erp/ErrorBanner";
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
import { humanizeApiError } from "../../../../lib/erp/errors";
import { supabase } from "../../../../lib/supabaseClient";

const last30Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 30);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

type VendorOption = { id: string; legal_name: string };

type BankUnmatchedRow = {
  bank_txn_id: string;
  txn_date: string | null;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  currency: string | null;
  description: string | null;
  reference_no: string | null;
  account_ref: string | null;
};

type PaymentUnmatchedRow = {
  payment_id: string;
  payment_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number | null;
  currency: string | null;
  mode: string | null;
  reference_no: string | null;
  note: string | null;
  is_void: boolean | null;
  matched: boolean | null;
};

type PaymentUnallocatedRow = {
  payment_id: string;
  payment_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  amount: number | null;
  allocated_total: number | null;
  unallocated_amount: number | null;
  matched: boolean | null;
  matched_bank_txn_id: string | null;
  matched_bank_txn_date: string | null;
  matched_bank_txn_description: string | null;
};

type InvoiceOutstandingRow = {
  invoice_id: string;
  invoice_no: string | null;
  invoice_date: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  invoice_total: number | null;
  allocated_total: number | null;
  outstanding_amount: number | null;
  validation_status: string | null;
};

type ReconCounters = {
  bank_unmatched_count: number;
  payments_unmatched_count: number;
  payments_unallocated_count: number;
  invoices_outstanding_count: number;
  invoices_outstanding_total: number;
  payments_unallocated_total: number;
};

type ReconSummary = {
  counters: ReconCounters;
  bank_unmatched: BankUnmatchedRow[];
  payments_unmatched: PaymentUnmatchedRow[];
  payments_unallocated: PaymentUnallocatedRow[];
  invoices_outstanding: InvoiceOutstandingRow[];
};

type ToastState = { type: "success" | "error"; message: string } | null;

const defaultSummary: ReconSummary = {
  counters: {
    bank_unmatched_count: 0,
    payments_unmatched_count: 0,
    payments_unallocated_count: 0,
    invoices_outstanding_count: 0,
    invoices_outstanding_total: 0,
    payments_unallocated_total: 0,
  },
  bank_unmatched: [],
  payments_unmatched: [],
  payments_unallocated: [],
  invoices_outstanding: [],
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

const formatAmount = (value: number | null, currency = "INR") => {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (error) {
    return `${currency} ${value.toLocaleString("en-IN")}`;
  }
};

export default function FinanceReconDashboardPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => last30Days(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [fromDate, setFromDate] = useState(start);
  const [toDate, setToDate] = useState(end);
  const [vendorId, setVendorId] = useState("");
  const [query, setQuery] = useState("");
  const [summary, setSummary] = useState<ReconSummary>(defaultSummary);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const reportError = (err: unknown, fallback: string) => {
    setError(humanizeApiError(err) || fallback);
    if (err instanceof Error) {
      setErrorDetails(err.message);
    } else if (typeof err === "string") {
      setErrorDetails(err);
    } else {
      setErrorDetails(null);
    }
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
        reportError(
          context.membershipError || "No active company membership found.",
          "No active company membership found."
        );
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
        reportError(loadError, "Failed to load vendors.");
        return;
      }

      setVendors((data || []) as VendorOption[]);
    }

    loadVendors();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const loadSummary = async (overrides?: {
    fromDate?: string;
    toDate?: string;
    vendorId?: string;
    query?: string;
  }) => {
    if (!ctx?.companyId) return;
    setIsLoadingData(true);
    setError(null);
    setErrorDetails(null);
    setToast(null);

    const effectiveFrom = overrides?.fromDate ?? fromDate;
    const effectiveTo = overrides?.toDate ?? toDate;
    const effectiveVendor = overrides?.vendorId ?? vendorId;
    const effectiveQuery = overrides?.query ?? query;

    const { data, error: loadError } = await supabase.rpc("erp_finance_recon_summary", {
      p_from: effectiveFrom || null,
      p_to: effectiveTo || null,
      p_vendor_id: effectiveVendor || null,
      p_q: effectiveQuery.trim() || null,
      p_limit: 50,
      p_offset: 0,
    });

    if (loadError) {
      reportError(loadError, "Failed to load reconciliation summary.");
      setIsLoadingData(false);
      return;
    }

    setSummary((data as ReconSummary) || defaultSummary);
    setIsLoadingData(false);
  };

  useEffect(() => {
    let active = true;

    (async () => {
      if (!active || !ctx?.companyId) return;
      await loadSummary();
    })();

    return () => {
      active = false;
    };
  }, [ctx?.companyId]);

  const handleRefresh = async (event: React.FormEvent) => {
    event.preventDefault();
    await loadSummary();
  };

  const handleReset = async () => {
    const nextFrom = start;
    const nextTo = end;
    setFromDate(nextFrom);
    setToDate(nextTo);
    setVendorId("");
    setQuery("");
    setToast(null);
    await loadSummary({ fromDate: nextFrom, toDate: nextTo, vendorId: "", query: "" });
  };

  const handleRowNavigate = (href: string) => {
    router.push(href);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading reconciliation dashboard…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="Recon Dashboard"
            description="Trace bank, payment, allocation, and invoice status."
          />
          <p style={{ color: "#b91c1c" }}>{error || "Unable to load company context."}</p>
        </div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Recon Dashboard"
          description="Monitor unmatched bank debits, vendor payments, allocations, and AP aging."
          rightActions={
            <Link href="/erp/finance" style={secondaryButtonStyle}>
              Back to Finance
            </Link>
          }
        />

        {error ? (
          <ErrorBanner message={error} details={errorDetails} onRetry={loadSummary} />
        ) : null}

        <section style={cardStyle}>
          <form onSubmit={handleRefresh} style={filterGridStyle}>
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
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Reference, vendor, memo…"
                style={inputStyle}
              />
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button type="submit" style={primaryButtonStyle}>
                Refresh
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

        <section style={summaryGridStyle}>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Bank Unmatched</div>
            <div style={summaryValueStyle}>{summary.counters.bank_unmatched_count}</div>
            <div style={summaryHintStyle}>Debits waiting for payment match</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Payments Unmatched</div>
            <div style={summaryValueStyle}>{summary.counters.payments_unmatched_count}</div>
            <div style={summaryHintStyle}>Payments without a bank match</div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Payments Unallocated</div>
            <div style={summaryValueStyle}>{summary.counters.payments_unallocated_count}</div>
            <div style={summaryHintStyle}>
              {formatAmount(summary.counters.payments_unallocated_total)} remaining to allocate
            </div>
          </div>
          <div style={summaryCardStyle}>
            <div style={summaryLabelStyle}>Invoices Outstanding</div>
            <div style={summaryValueStyle}>{summary.counters.invoices_outstanding_count}</div>
            <div style={summaryHintStyle}>
              {formatAmount(summary.counters.invoices_outstanding_total)} outstanding
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Bank Unmatched</h2>
              <p style={subtitleStyle}>Debits that have not been matched to vendor payments.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.bank_unmatched_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Description</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Debit</th>
                  <th style={tableHeaderCellStyle}>Credit</th>
                  <th style={tableHeaderCellStyle}>Account</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      Loading bank transactions…
                    </td>
                  </tr>
                ) : summary.bank_unmatched.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No unmatched bank transactions found.
                    </td>
                  </tr>
                ) : (
                  summary.bank_unmatched.map((row) => (
                    <tr
                      key={row.bank_txn_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRowNavigate("/erp/finance/bank/import")}
                    >
                      <td style={tableCellStyle}>{formatDate(row.txn_date)}</td>
                      <td style={tableCellStyle}>{row.description || "—"}</td>
                      <td style={tableCellStyle}>{row.reference_no || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.debit, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>{formatAmount(row.credit, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>{row.account_ref || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Payments Unmatched</h2>
              <p style={subtitleStyle}>Vendor payments missing a bank match.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.payments_unmatched_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Mode</th>
                  <th style={tableHeaderCellStyle}>Reference</th>
                  <th style={tableHeaderCellStyle}>Note</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      Loading unmatched payments…
                    </td>
                  </tr>
                ) : summary.payments_unmatched.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      No unmatched vendor payments.
                    </td>
                  </tr>
                ) : (
                  summary.payments_unmatched.map((row) => (
                    <tr
                      key={row.payment_id}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                    >
                      <td style={tableCellStyle}>{formatDate(row.payment_date)}</td>
                      <td style={tableCellStyle}>{row.vendor_name || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.amount, row.currency || "INR")}</td>
                      <td style={tableCellStyle}>{row.mode || "—"}</td>
                      <td style={tableCellStyle}>{row.reference_no || "—"}</td>
                      <td style={tableCellStyle}>{row.note || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Payments Unallocated</h2>
              <p style={subtitleStyle}>Matched payments that still need invoice allocations.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.payments_unallocated_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Amount</th>
                  <th style={tableHeaderCellStyle}>Allocated</th>
                  <th style={tableHeaderCellStyle}>Unallocated</th>
                  <th style={tableHeaderCellStyle}>Bank Match</th>
                  <th style={tableHeaderCellStyle}>Action</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      Loading unallocated payments…
                    </td>
                  </tr>
                ) : summary.payments_unallocated.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={7}>
                      No unallocated payments.
                    </td>
                  </tr>
                ) : (
                  summary.payments_unallocated.map((row) => (
                    <tr key={row.payment_id} style={{ cursor: "pointer" }}>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatDate(row.payment_date)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {row.vendor_name || "—"}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatAmount(row.amount)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatAmount(row.allocated_total)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        {formatAmount(row.unallocated_amount)}
                      </td>
                      <td
                        style={tableCellStyle}
                        onClick={() => handleRowNavigate(`/erp/finance/vendor-payments/${row.payment_id}`)}
                      >
                        <span
                          style={{
                            ...badgeStyle,
                            backgroundColor: row.matched ? "#dcfce7" : "#fee2e2",
                            color: row.matched ? "#166534" : "#991b1b",
                          }}
                        >
                          {row.matched ? "Matched" : "Unmatched"}
                        </span>
                      </td>
                      <td style={tableCellStyle}>
                        <button
                          type="button"
                          style={secondaryButtonStyle}
                          onClick={(event) => {
                            event.stopPropagation();
                            router.push({
                              pathname: "/erp/finance/ap/outstanding",
                              query: {
                                vendorId: row.vendor_id || undefined,
                                q: row.vendor_name || undefined,
                              },
                            });
                          }}
                        >
                          Allocate
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section style={cardStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Invoices Outstanding</h2>
              <p style={subtitleStyle}>Open purchase invoices still awaiting allocations.</p>
            </div>
            <span style={badgeStyle}>{summary.counters.invoices_outstanding_count} items</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Invoice</th>
                  <th style={tableHeaderCellStyle}>Vendor</th>
                  <th style={tableHeaderCellStyle}>Date</th>
                  <th style={tableHeaderCellStyle}>Outstanding</th>
                  <th style={tableHeaderCellStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {isLoadingData ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={5}>
                      Loading outstanding invoices…
                    </td>
                  </tr>
                ) : summary.invoices_outstanding.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={5}>
                      No outstanding invoices.
                    </td>
                  </tr>
                ) : (
                  summary.invoices_outstanding.map((row) => (
                    <tr
                      key={row.invoice_id}
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        handleRowNavigate(
                          `/erp/finance/ap/outstanding?vendorId=${row.vendor_id || ""}&q=${encodeURIComponent(
                            row.invoice_no || ""
                          )}`
                        )
                      }
                    >
                      <td style={tableCellStyle}>{row.invoice_no || "Invoice"}</td>
                      <td style={tableCellStyle}>{row.vendor_name || "—"}</td>
                      <td style={tableCellStyle}>{formatDate(row.invoice_date)}</td>
                      <td style={tableCellStyle}>{formatAmount(row.outstanding_amount)}</td>
                      <td style={tableCellStyle}>{row.validation_status || "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </ErpShell>
  );
}

const filterGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 16,
};

const filterLabelStyle = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#334155",
};

const summaryGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 16,
};

const summaryCardStyle = {
  ...cardStyle,
  display: "grid",
  gap: 6,
};

const summaryLabelStyle = {
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: "0.08em",
  color: "#64748b",
};

const summaryValueStyle = {
  fontSize: 28,
  fontWeight: 700,
  color: "#0f172a",
};

const summaryHintStyle = {
  fontSize: 13,
  color: "#475569",
};

const sectionHeaderStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
  flexWrap: "wrap" as const,
};

const sectionTitleStyle = {
  margin: 0,
  fontSize: 18,
  color: "#0f172a",
};
