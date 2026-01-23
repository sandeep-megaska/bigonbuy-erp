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

type MissingSkuRow = {
  sku: string;
  sample_title: string | null;
  last_seen_at: string | null;
};

export default function GstShopifyPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof getCompanyContext>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState(startOfMonth());
  const [toDate, setToDate] = useState(today());
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [missingSkus, setMissingSkus] = useState<MissingSkuRow[]>([]);
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

      await loadMissingSkus();
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const loadMissingSkus = async () => {
    const { data, error: missingError } = await supabase.rpc("erp_gst_missing_skus_shopify");
    if (missingError) {
      setError(missingError.message);
      return;
    }
    setMissingSkus((data || []) as MissingSkuRow[]);
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
    await loadMissingSkus();
    setIsRunning(false);
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

    const blob = createCsvBlob(rows);
    triggerDownload(blob, filename);
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
          <h3 style={{ marginTop: 0 }}>Missing SKU Mappings</h3>
          {missingSkus.length ? (
            <>
              <p style={{ marginTop: 0, color: "#b91c1c" }}>
                {missingSkus.length} SKU(s) are missing GST master mappings. Please update the SKU master.
              </p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {missingSkus.map((row) => (
                  <li key={row.sku}>
                    <strong>{row.sku}</strong>
                    {row.sample_title ? ` — ${row.sample_title}` : ""}
                    {row.last_seen_at ? ` (last seen ${row.last_seen_at.slice(0, 10)})` : ""}
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 12 }}>
                <Link href="/erp/finance/gst/sku-master" style={secondaryButtonStyle}>
                  Go to SKU Master
                </Link>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "#6b7280" }}>No missing SKU mappings detected.</p>
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
      </div>
    </ErpShell>
  );
}
