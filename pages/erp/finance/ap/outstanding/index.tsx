import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../../components/erp/uiStyles";
import { createCsvBlob, triggerDownload } from "../../../../../components/inventory/csvUtils";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

const today = () => new Date().toISOString().slice(0, 10);

type VendorOption = { id: string; legal_name: string };

type OutstandingRow = {
  vendor_id: string;
  vendor_name: string | null;
  invoice_total: number | null;
  payment_total: number | null;
  outstanding: number | null;
  last_invoice_date: string | null;
  last_payment_date: string | null;
};

type AgingRow = {
  vendor_id: string;
  bucket_0_30: number | null;
  bucket_31_60: number | null;
  bucket_61_90: number | null;
  bucket_90_plus: number | null;
  outstanding_total: number | null;
};

type TabKey = "outstanding" | "aging";

type ExportRow = Record<string, unknown>;

const formatCsvValue = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const buildCsvFromRows = (rows: ExportRow[]) => {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = rows.map((row) => headers.map((header) => formatCsvValue(row[header])).join(","));
  return [headers.join(","), ...lines].join("\n");
};

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-GB") : "—");

const formatCurrency = (formatter: Intl.NumberFormat, value: number | null) =>
  value == null ? "—" : formatter.format(value);

export default function ApOutstandingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [asOfDate, setAsOfDate] = useState(today());
  const [vendorId, setVendorId] = useState<string>("");
  const [activeTab, setActiveTab] = useState<TabKey>("outstanding");
  const [outstandingRows, setOutstandingRows] = useState<OutstandingRow[]>([]);
  const [agingRows, setAgingRows] = useState<AgingRow[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }),
    []
  );

  const vendorLookup = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor.legal_name])),
    [vendors]
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

    async function loadData() {
      if (!ctx?.companyId) return;
      setIsLoadingData(true);
      setError(null);

      const rpcName = activeTab === "outstanding" ? "erp_ap_vendor_outstanding" : "erp_ap_vendor_aging";
      const { data, error: loadError } = await supabase.rpc(rpcName, {
        p_as_of: asOfDate,
        p_vendor_id: vendorId || null,
      });

      if (!active) return;

      if (loadError) {
        setError(loadError.message || "Failed to load AP data.");
        setIsLoadingData(false);
        return;
      }

      if (activeTab === "outstanding") {
        setOutstandingRows((data || []) as OutstandingRow[]);
      } else {
        setAgingRows((data || []) as AgingRow[]);
      }

      setIsLoadingData(false);
    }

    loadData();

    return () => {
      active = false;
    };
  }, [activeTab, asOfDate, ctx?.companyId, vendorId]);

  const handleExport = async () => {
    setError(null);
    const rpcName =
      activeTab === "outstanding" ? "erp_ap_vendor_outstanding_export" : "erp_ap_vendor_aging_export";
    const filename =
      activeTab === "outstanding"
        ? `ap-outstanding-${asOfDate}.csv`
        : `ap-aging-${asOfDate}.csv`;

    const { data, error: exportError } = await supabase.rpc(rpcName, {
      p_as_of: asOfDate,
      p_vendor_id: vendorId || null,
    });

    if (exportError) {
      setError(exportError.message || "Failed to export AP data.");
      return;
    }

    const rows = Array.isArray(data) ? (data as ExportRow[]) : [];
    if (!rows.length) {
      setError("No rows returned for export.");
      return;
    }

    const csv = buildCsvFromRows(rows);
    triggerDownload(filename, createCsvBlob(csv));
  };

  const activeRows = activeTab === "outstanding" ? outstandingRows : agingRows;

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading AP outstanding…</div>
      </ErpShell>
    );
  }

  if (!ctx?.companyId) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>
          <ErpPageHeader
            eyebrow="Finance"
            title="AP Outstanding"
            description="Vendor balances and aging as of a selected date."
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
          title="AP Outstanding"
          description="Monitor vendor balances and aging buckets."
          rightActions={
            <Link href="/erp/finance" style={secondaryButtonStyle}>
              Back to Finance
            </Link>
          }
        />

        {error ? (
          <div style={{ ...cardStyle, borderColor: "#fecaca", backgroundColor: "#fff1f2", color: "#b91c1c" }}>
            {error}
          </div>
        ) : null}

        <section style={cardStyle}>
          <div style={filterGridStyle}>
            <label style={filterLabelStyle}>
              <span>As of date</span>
              <input
                type="date"
                value={asOfDate}
                style={inputStyle}
                onChange={(event) => setAsOfDate(event.target.value)}
              />
            </label>
            <label style={filterLabelStyle}>
              <span>Vendor</span>
              <select
                value={vendorId}
                style={inputStyle}
                onChange={(event) => setVendorId(event.target.value)}
              >
                <option value="">All vendors</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.legal_name}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {tabItems.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  style={tab.key === activeTab ? activeTabStyle : secondaryButtonStyle}
                >
                  {tab.label}
                </button>
              ))}
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={handleExport}
                disabled={!activeRows.length}
              >
                Export CSV
              </button>
            </div>
          </div>
        </section>

        <section style={cardStyle}>
          {isLoadingData ? <p>Loading AP data…</p> : null}
          {!isLoadingData && activeTab === "outstanding" ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {outstandingHeaders.map((header) => (
                      <th key={header} style={tableHeaderCellStyle}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outstandingRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={outstandingHeaders.length}
                        style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}
                      >
                        <span style={subtitleStyle}>No outstanding records for this date.</span>
                      </td>
                    </tr>
                  ) : (
                    outstandingRows.map((row) => (
                      <tr key={row.vendor_id}>
                        <td style={tableCellStyle}>{row.vendor_name ?? "Unknown vendor"}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.invoice_total)}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.payment_total)}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.outstanding)}</td>
                        <td style={tableCellStyle}>{formatDate(row.last_invoice_date)}</td>
                        <td style={tableCellStyle}>{formatDate(row.last_payment_date)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {!isLoadingData && activeTab === "aging" ? (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    {agingHeaders.map((header) => (
                      <th key={header} style={tableHeaderCellStyle}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agingRows.length === 0 ? (
                    <tr>
                      <td colSpan={agingHeaders.length} style={{ ...tableCellStyle, textAlign: "center", color: "#6b7280" }}>
                        <span style={subtitleStyle}>No aging records for this date.</span>
                      </td>
                    </tr>
                  ) : (
                    agingRows.map((row) => (
                      <tr key={row.vendor_id}>
                        <td style={tableCellStyle}>{vendorLookup.get(row.vendor_id) || "Unknown vendor"}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.bucket_0_30)}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.bucket_31_60)}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.bucket_61_90)}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.bucket_90_plus)}</td>
                        <td style={tableCellStyle}>{formatCurrency(currencyFormatter, row.outstanding_total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
      </div>
    </ErpShell>
  );
}

const tabItems: { key: TabKey; label: string }[] = [
  { key: "outstanding", label: "Outstanding" },
  { key: "aging", label: "Aging" },
];

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

const activeTabStyle = {
  ...secondaryButtonStyle,
  backgroundColor: "#111827",
  color: "#fff",
};

const outstandingHeaders = [
  "Vendor",
  "Invoice Total",
  "Payments",
  "Outstanding",
  "Last Invoice Date",
  "Last Payment Date",
];

const agingHeaders = ["Vendor", "0-30", "31-60", "61-90", "90+", "Outstanding Total"];
