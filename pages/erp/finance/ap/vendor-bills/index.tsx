import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import ErrorBanner from "../../../../../components/erp/ErrorBanner";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { humanizeApiError } from "../../../../../lib/erp/errors";
import { vendorBillList } from "../../../../../lib/erp/vendorBills";
import { supabase } from "../../../../../lib/supabaseClient";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value || 0);

const today = () => new Date().toISOString().slice(0, 10);
const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

type VendorOption = {
  id: string;
  legal_name: string;
};

type VendorBillRow = {
  bill_id: string;
  bill_no: string;
  bill_date: string;
  vendor_id: string;
  vendor_name: string;
  total: number;
  tds_amount: number;
  net_payable: number;
  status: string;
  is_void: boolean;
  posted_doc_no: string | null;
};

export default function VendorBillsListPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [bills, setBills] = useState<VendorBillRow[]>([]);

  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());
  const [selectedVendor, setSelectedVendor] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [query, setQuery] = useState("");

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

  const vendorMap = useMemo(() => new Map(vendors.map((v) => [v.id, v.legal_name])), [vendors]);

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
          context.membershipError || "No active company membership found for this user.",
          "No active company membership found for this user."
        );
        setLoading(false);
        return;
      }

      await Promise.all([loadVendors(context.companyId), loadBills()]);
      if (active) setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadVendors = async (companyId: string) => {
    const { data, error: loadError } = await supabase
      .from("erp_vendors")
      .select("id, legal_name")
      .eq("company_id", companyId)
      .order("legal_name");

    if (loadError) {
      reportError(loadError, "Failed to load vendors.");
      return;
    }

    setVendors((data || []) as VendorOption[]);
  };

  const loadBills = async () => {
    setError(null);
    setErrorDetails(null);
    const { data, error: loadError } = await vendorBillList({
      from: fromDate,
      to: toDate,
      vendorId: selectedVendor || null,
      status: statusFilter || null,
      query: query || null,
      limit: 200,
      offset: 0,
    });

    if (loadError) {
      reportError(loadError, "Failed to load vendor bills.");
      return;
    }

    setBills((data || []) as VendorBillRow[]);
  };

  const handleFilterApply = async () => {
    await loadBills();
  };

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="Vendor Bills"
          description="Capture vendor GST bills, match with PO/GRN, and post to the ledger."
          rightActions={
            <Link href="/erp/finance/ap/vendor-bills/new" style={primaryButtonStyle}>
              New Vendor Bill
            </Link>
          }
        />

        {error ? (
          <ErrorBanner message={error} details={errorDetails} onRetry={loadBills} />
        ) : null}

        <section style={cardStyle}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 6 }}>
              From
              <input style={inputStyle} type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              To
              <input style={inputStyle} type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Vendor
              <select style={inputStyle} value={selectedVendor} onChange={(e) => setSelectedVendor(e.target.value)}>
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Status
              <select style={inputStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="posted">Posted</option>
                <option value="void">Void</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Search
              <input style={inputStyle} value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          <div style={{ marginTop: 12 }}>
            <button type="button" style={secondaryButtonStyle} onClick={handleFilterApply}>
              Apply Filters
            </button>
          </div>
        </section>

        <section style={cardStyle}>
          {loading ? (
            <p>Loading bills...</p>
          ) : bills.length === 0 ? (
            <p>No vendor bills found.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Bill Date</th>
                    <th style={tableHeaderCellStyle}>Vendor</th>
                    <th style={tableHeaderCellStyle}>Bill No</th>
                    <th style={tableHeaderCellStyle}>Total</th>
                    <th style={tableHeaderCellStyle}>TDS</th>
                    <th style={tableHeaderCellStyle}>Net Payable</th>
                    <th style={tableHeaderCellStyle}>Status</th>
                    <th style={tableHeaderCellStyle}>Posted Doc No</th>
                    <th style={tableHeaderCellStyle}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill) => (
                    <tr key={bill.bill_id}>
                      <td style={tableCellStyle}>{bill.bill_date}</td>
                      <td style={tableCellStyle}>{bill.vendor_name || vendorMap.get(bill.vendor_id) || "—"}</td>
                      <td style={tableCellStyle}>{bill.bill_no}</td>
                      <td style={tableCellStyle}>{formatMoney(bill.total)}</td>
                      <td style={tableCellStyle}>{formatMoney(bill.tds_amount)}</td>
                      <td style={tableCellStyle}>{formatMoney(bill.net_payable)}</td>
                      <td style={tableCellStyle}>{bill.status}</td>
                      <td style={tableCellStyle}>{bill.posted_doc_no || "—"}</td>
                      <td style={{ ...tableCellStyle, textAlign: "right" }}>
                        <Link href={`/erp/finance/ap/vendor-bills/${bill.bill_id}`} style={secondaryButtonStyle}>
                          View / Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
