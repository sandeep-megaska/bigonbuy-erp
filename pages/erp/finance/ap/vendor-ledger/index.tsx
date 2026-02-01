import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
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
import { downloadCsv, type CsvColumn } from "../../../../../lib/erp/exportCsv";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

const last90Days = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 90);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
};

type VendorOption = { id: string; legal_name: string };

type LedgerRow = {
  txn_date: string | null;
  txn_type: string | null;
  reference_no: string | null;
  doc_no: string | null;
  description: string | null;
  debit_amount: number | null;
  credit_amount: number | null;
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

const formatAmount = (value: number | null) => {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
    value
  );
};

/**
 * Dependency map:
 * UI: /erp/finance/ap/vendor-ledger -> GET /api/finance/ap/vendor-ledger
 * API: vendor-ledger -> RPC: erp_ap_vendor_ledger
 * RPC tables: erp_gst_purchase_invoices, erp_ap_vendor_advances, erp_ap_vendor_payments,
 *             erp_ap_vendor_payment_allocations, erp_ap_vendor_bill_advance_allocations,
 *             erp_fin_journals
 */
export default function VendorLedgerPage() {
  const router = useRouter();
  const { start, end } = useMemo(() => last90Days(), []);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [fromDate, setFromDate] = useState(start);
  const [toDate, setToDate] = useState(end);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const loadLedger = async () => {
    if (!ctx?.session?.access_token || !vendorId) return;
    setIsLoadingLedger(true);
    setError(null);

    const params = new URLSearchParams({ vendorId });
    if (fromDate) params.set("from", fromDate);
    if (toDate) params.set("to", toDate);

    const res = await fetch(`/api/finance/ap/vendor-ledger?${params.toString()}`, {
      headers: { Authorization: `Bearer ${ctx.session.access_token}` },
    });
    const payload = (await res.json()) as { ok: boolean; data?: LedgerRow[]; error?: string };
    if (!res.ok || !payload.ok) {
      setError(payload.error || "Failed to load vendor ledger.");
      setIsLoadingLedger(false);
      return;
    }

    setLedgerRows(payload.data || []);
    setIsLoadingLedger(false);
  };

  const handleExport = () => {
    if (ledgerRows.length === 0) return;
    const columns: CsvColumn<LedgerRow>[] = [
      { header: "Date", accessor: (row) => row.txn_date ?? "" },
      { header: "Type", accessor: (row) => row.txn_type ?? "" },
      { header: "Reference", accessor: (row) => row.reference_no ?? "" },
      { header: "Description", accessor: (row) => row.description ?? "" },
      { header: "Debit", accessor: (row) => `${row.debit_amount ?? 0}` },
      { header: "Credit", accessor: (row) => `${row.credit_amount ?? 0}` },
      { header: "Journal Doc No", accessor: (row) => row.doc_no ?? "" },
    ];
    downloadCsv(`vendor-ledger-${vendorId}-${fromDate}-to-${toDate}.csv`, columns, ledgerRows);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading vendor ledger…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Vendor Ledger"
          description="Review a vendor-level timeline across bills, advances, and payments."
          rightActions={
            <Link href="/erp/finance/ap/outstanding" style={secondaryButtonStyle}>
              Back to AP Outstanding
            </Link>
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
              <label style={subtitleStyle}>Vendor</label>
              <select value={vendorId} style={inputStyle} onChange={(event) => setVendorId(event.target.value)}>
                <option value="">Select vendor</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={subtitleStyle}>From</label>
              <input
                type="date"
                value={fromDate}
                style={inputStyle}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </div>
            <div>
              <label style={subtitleStyle}>To</label>
              <input type="date" value={toDate} style={inputStyle} onChange={(event) => setToDate(event.target.value)} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 12 }}>
              <button type="button" style={primaryButtonStyle} onClick={loadLedger} disabled={!vendorId}>
                {isLoadingLedger ? "Loading…" : "Load ledger"}
              </button>
              <button type="button" style={secondaryButtonStyle} onClick={handleExport} disabled={!ledgerRows.length}>
                Export CSV
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          {isLoadingLedger ? <p>Loading vendor ledger…</p> : null}
          {!isLoadingLedger && ledgerRows.length === 0 ? <p style={subtitleStyle}>No ledger rows found.</p> : null}
          {ledgerRows.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Date</th>
                    <th style={tableHeaderCellStyle}>Type</th>
                    <th style={tableHeaderCellStyle}>Reference</th>
                    <th style={tableHeaderCellStyle}>Description</th>
                    <th style={tableHeaderCellStyle}>Debit</th>
                    <th style={tableHeaderCellStyle}>Credit</th>
                    <th style={tableHeaderCellStyle}>Journal Doc No</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerRows.map((row, idx) => (
                    <tr key={`${row.txn_date}-${row.reference_no}-${idx}`}>
                      <td style={tableCellStyle}>{formatDate(row.txn_date)}</td>
                      <td style={tableCellStyle}>{row.txn_type || "—"}</td>
                      <td style={tableCellStyle}>{row.reference_no || "—"}</td>
                      <td style={tableCellStyle}>{row.description || "—"}</td>
                      <td style={tableCellStyle}>{formatAmount(row.debit_amount)}</td>
                      <td style={tableCellStyle}>{formatAmount(row.credit_amount)}</td>
                      <td style={tableCellStyle}>{row.doc_no || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}
