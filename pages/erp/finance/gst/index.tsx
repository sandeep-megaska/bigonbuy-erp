import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpPageHeader from "../../../../components/erp/ErpPageHeader";
import {
  cardStyle,
  inputStyle,
  pageContainerStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
} from "../../../../components/erp/uiStyles";
import { createCsvBlob, triggerDownload } from "../../../../components/inventory/csvUtils";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

const today = () => new Date().toISOString().slice(0, 10);
const startOfMonth = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
};

type GenerateResult = {
  inserted_count?: number;
  voided_count?: number;
  missing_sku_count?: number;
  missing_skus?: string[];
  error_count?: number;
};

type MissingMappingRow = {
  style_code: string;
  example_sku: string | null;
  last_seen: string | null;
  title: string | null;
};

type GstInvoiceRow = {
  invoice_number: string | null;
  invoice_no: string | null;
  order_number: string | null;
  order_date: string;
  customer_name: string | null;
  payment_status: string | null;
  payment_gateway: string | null;
  fulfillment_status: string | null;
};

const formatCsvValue = (value: unknown) =>
  `"${String(value ?? "").replace(/"/g, '""')}"`;

const buildCsvFromRows = (rows: unknown[]) => {
  if (rows.length === 0) return "";

  const first = rows[0];
  if (Array.isArray(first)) {
    return rows
      .map((row) =>
        (Array.isArray(row) ? row : [row]).map((cell) => formatCsvValue(cell)).join(",")
      )
      .join("\n");
  }

  if (first && typeof first === "object") {
    const headers = Object.keys(first as Record<string, unknown>);
    const lines = rows.map((row) => {
      const record = (row ?? {}) as Record<string, unknown>;
      return headers.map((header) => formatCsvValue(record[header])).join(",");
    });
    return [headers.join(","), ...lines].join("\n");
  }

  return rows.map((row) => formatCsvValue(row)).join("\n");
};

export default function GstShopifyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [missingSkus, setMissingSkus] = useState<MissingMappingRow[]>([]);
  const [gstInvoices, setGstInvoices] = useState<GstInvoiceRow[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const canWrite = useMemo(
    () => Boolean(ctx?.roleKey && ["owner", "admin", "finance"].includes(ctx.roleKey)),
    [ctx]
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

      await loadMissingSkus(fromDate, toDate);
      await loadGstInvoices(fromDate, toDate);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [fromDate, toDate, router]);

  const loadMissingSkus = async (startDate: string, endDate: string) => {
    const { data, error: missingError } = await supabase.rpc("erp_gst_missing_mappings_shopify", {
      p_from: startDate,
      p_to: endDate,
    });
    if (missingError) {
      setError(missingError.message);
      return;
    }
    setMissingSkus((data || []) as MissingMappingRow[]);
  };

  const handleGenerate = async () => {
    if (!fromDate || !toDate) return;
    setIsRunning(true);
    setError(null);
    setResult(null);

    const { data, error: rpcError } = await supabase.rpc("erp_gst_generate_shopify", {
      p_from: fromDate,
      p_to: toDate,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsRunning(false);
      return;
    }

    setResult(data as GenerateResult);
    await loadMissingSkus(fromDate, toDate);
    await loadGstInvoices(fromDate, toDate);
    setIsRunning(false);
  };

  const loadGstInvoices = async (startDate: string, endDate: string) => {
    const { data, error: invoicesError } = await supabase
      .from("erp_gst_sales_register")
      .select(
        "invoice_number, invoice_no, order_number, order_date, customer_name, payment_status, payment_gateway, fulfillment_status"
      )
      .eq("source", "shopify")
      .eq("is_void", false)
      .gte("order_date", startDate)
      .lte("order_date", endDate)
      .order("order_date", { ascending: true });

    if (invoicesError) {
      setError(invoicesError.message);
      return;
    }

    const rows = (data || []) as GstInvoiceRow[];
    const uniqueRows = new Map<string, GstInvoiceRow>();
    rows.forEach((row) => {
      const key =
        row.invoice_number || row.invoice_no || row.order_number || `${row.order_date}-${uniqueRows.size}`;
      if (!uniqueRows.has(key)) uniqueRows.set(key, row);
    });
    setGstInvoices(Array.from(uniqueRows.values()));
  };

  const handleExport = async (rpcName: string, filename: string) => {
    setError(null);
    const { data, error: exportError } = await supabase.rpc(rpcName, {
      p_from: fromDate,
      p_to: toDate,
    });

    if (exportError) {
      setError(exportError.message);
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      setError("No rows returned for export.");
      return;
    }

    const csv = buildCsvFromRows(rows);
    const blob = createCsvBlob(csv);
    triggerDownload(filename, blob);
  };

  if (loading) {
    return (
      <ErpShell activeModule="finance">
        <div style={pageContainerStyle}>Loading GST…</div>
      </ErpShell>
    );
  }

  return (
    <ErpShell activeModule="finance">
      <div style={pageContainerStyle}>
        <ErpPageHeader
          eyebrow="Finance"
          title="GST (Shopify)"
          description="Generate GST register rows from Shopify orders and export CSVs."
          rightActions={
            <Link href="/erp/finance" style={secondaryButtonStyle}>
              Back to Finance
            </Link>
          }
        />

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h2 style={{ margin: 0 }}>Generate GST Register</h2>
          <p style={subtitleStyle}>
            This process voids prior GST rows in the date range and regenerates from Shopify order lines.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span>From</span>
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span>To</span>
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
          <button
            type="button"
            style={primaryButtonStyle}
            onClick={handleGenerate}
            disabled={!canWrite || isRunning}
          >
            {isRunning ? "Generating…" : "Generate GST (Shopify)"}
          </button>
          {!canWrite && (
            <p style={{ color: "#b91c1c", marginTop: 12 }}>
              You need finance/admin/owner access to generate GST rows.
            </p>
          )}
          {error && <p style={{ color: "#b91c1c", marginTop: 12 }}>{error}</p>}
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Latest Generation Summary</h3>
          {result ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>Inserted rows: {result.inserted_count ?? 0}</li>
              <li>Voided rows: {result.voided_count ?? 0}</li>
              <li>Missing SKU count: {result.missing_sku_count ?? 0}</li>
              <li>Error count: {result.error_count ?? 0}</li>
            </ul>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>Run GST generation to see counts.</p>
          )}
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Missing Style Tax Profiles</h3>
          {missingSkus.length ? (
            <>
              <p style={{ marginTop: 0, color: "#b91c1c" }}>
                {missingSkus.length} style(s) are missing tax profiles. Add them to Style Tax Profiles.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {missingSkus.map((row) => (
                  <li key={row.style_code}>
                    <strong>{row.style_code}</strong>
                    {row.title ? ` — ${row.title}` : ""}
                    {row.example_sku ? ` (ex: ${row.example_sku})` : ""}
                    {row.last_seen ? ` (last seen ${row.last_seen.slice(0, 10)})` : ""}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 12 }}>
                <Link href="/erp/finance/gst/sku-master" style={secondaryButtonStyle}>
                  Go to Style Tax Profiles
                </Link>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>No missing style tax profiles detected.</p>
          )}
        </section>

        <section style={cardStyle}>
          <h3 style={{ marginTop: 0 }}>Exports</h3>
          <p style={subtitleStyle}>Download GST exports for the selected date range.</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => handleExport("erp_gst_export_b2c_shopify", `gst-b2c-shopify-${fromDate}-to-${toDate}.csv`)}
            >
              Export B2C
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => handleExport("erp_gst_export_hsn_shopify", `gst-hsn-shopify-${fromDate}-to-${toDate}.csv`)}
            >
              Export HSN Summary
            </button>
            <button
              type="button"
              style={secondaryButtonStyle}
              onClick={() => handleExport("erp_gst_export_summary_shopify", `gst-summary-shopify-${fromDate}-to-${toDate}.csv`)}
            >
              Export Summary
            </button>
          </div>
        </section>

        <section style={{ ...cardStyle, marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>GST Register Invoices</h3>
          {gstInvoices.length ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Invoice Date</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Invoice Number</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Order Number</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Customer</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Payment Status</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Fulfillment Status</th>
                    <th style={{ textAlign: "left", paddingBottom: 8 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {gstInvoices.map((row) => {
                    const invoiceKey =
                      row.invoice_number || row.invoice_no || row.order_number || row.order_date;
                    const invoiceSlug = encodeURIComponent(invoiceKey || "");
                    return (
                      <tr key={`${invoiceKey}-${row.order_date}`}>
                        <td style={{ padding: "6px 0" }}>{row.order_date}</td>
                        <td style={{ padding: "6px 0", fontWeight: 600 }}>
                          {row.invoice_number || row.invoice_no || "—"}
                        </td>
                        <td style={{ padding: "6px 0" }}>{row.order_number || "—"}</td>
                        <td style={{ padding: "6px 0" }}>{row.customer_name || "—"}</td>
                        <td style={{ padding: "6px 0" }}>{row.payment_status || "—"}</td>
                        <td style={{ padding: "6px 0" }}>{row.fulfillment_status || "—"}</td>
                        <td style={{ padding: "6px 0" }}>
                          {invoiceKey ? (
                            <Link href={`/erp/finance/gst/invoices/${invoiceSlug}`} style={secondaryButtonStyle}>
                              Print Invoice
                            </Link>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>No GST invoices found for this date range.</p>
          )}
        </section>
      </div>
    </ErpShell>
  );
}
