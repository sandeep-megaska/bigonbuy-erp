import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import ErpPageHeader from "../../../../../components/erp/ErpPageHeader";
import { card, cardTitle } from "../../../../../components/erp/tw";
import { createCsvBlob, triggerDownload } from "../../../../../components/inventory/csvUtils";
import { primaryButtonStyle, secondaryButtonStyle } from "../../../../../components/erp/uiStyles";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";
import { supabase } from "../../../../../lib/supabaseClient";

type ExportItem = {
  key: string;
  title: string;
  description: string;
  filename: string;
  rpcName: string;
  params?: Record<string, unknown>;
  csvTextFromRpc?: boolean;
};

const formatCsvValue = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const buildCsvFromRows = (rows: unknown[]) => {
  if (rows.length === 0) return "";

  const first = rows[0];
  if (Array.isArray(first)) {
    return rows
      .map((row) => (Array.isArray(row) ? row : [row]).map((cell) => formatCsvValue(cell)).join(","))
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

export default function MarketingExportsHubPage() {
  const router = useRouter();
  const [isNavigating, setIsNavigating] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const companyContext = await getCompanyContext(session);
      if (!active) return;
      if (!companyContext.companyId) {
        await router.replace("/erp");
        return;
      }
      setCompanyId(String(companyContext.companyId));
    })();

    return () => {
      active = false;
    };
  }, [router]);

  const demandExports = useMemo<readonly ExportItem[]>(
    () => [
      {
        key: "scale_skus",
        title: "Export Scale SKUs (CSV)",
        description: "Top demand steering SKUs to scale this cycle.",
        filename: "scale-skus.csv",
        rpcName: "erp_mkt_meta_export_scale_skus_csv_v1",
        csvTextFromRpc: true,
      },
      {
        key: "expand_cities",
        title: "Export Expand Cities (CSV)",
        description: "Top demand steering cities to expand this cycle.",
        filename: "demand_steering_expand_cities.csv",
        rpcName: "erp_mkt_demand_steering_export_expand_cities_v1",
        params: companyId ? { p_company_id: companyId, p_limit: 50000 } : undefined,
      },
    ],
    [companyId]
  );

  const audienceExports: readonly ExportItem[] = [
    {
      key: "atc_30d",
      title: "ATC 30D excl Purchasers 180D",
      description:
        "People with AddToCart/InitiateCheckout events in the last 30 days, excluding anyone who purchased in the last 180 days.",
      filename: "meta_audience_atc_30d_no_purchase.csv",
      rpcName: "erp_mkt_audience_export_atc_30d_v1",
      params: { p_limit: 50000 },
    },
    {
      key: "purchasers_180d",
      title: "Purchasers 180D",
      description: "All purchasers from supported channels in the last 180 days.",
      filename: "meta_audience_purchasers_180d.csv",
      rpcName: "erp_mkt_audience_export_purchasers_180d_v1",
      params: { p_limit: 50000 },
    },
    {
      key: "vip_180d",
      title: "VIP 180D",
      description: "Top 20% buyers by blended 180-day revenue for high-value retention and upsell campaigns.",
      filename: "meta_audience_vip_buyers_180d.csv",
      rpcName: "erp_mkt_audience_export_vip_buyers_180d_v1",
      params: { p_limit: 50000 },
    },
  ];

  const handleExportRpcCsv = async (item: ExportItem) => {
    if (!companyId && item.key === "expand_cities") {
      setError("Missing company context for export.");
      return;
    }

    setError(null);
    setIsNavigating(item.key);

    const { data, error: rpcError } = await supabase.rpc(item.rpcName, item.params);

    if (rpcError) {
      setError(rpcError.message || "Export failed.");
      setIsNavigating(null);
      return;
    }

    if (item.csvTextFromRpc && typeof data === "string") {
      triggerDownload(item.filename, createCsvBlob(data));
      setIsNavigating(null);
      return;
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      setError("No rows returned for export.");
      setIsNavigating(null);
      return;
    }

    const csv = buildCsvFromRows(rows);
    triggerDownload(item.filename, createCsvBlob(csv));
    setIsNavigating(null);
  };

  return (
    <div className="space-y-4">
      <ErpPageHeader
        title="Marketing Intelligence · Export Hub"
        description="Download Demand Steering and Audience CSV exports from one place."
      />

      {error ? <div className="text-sm text-red-700">{error}</div> : null}

      <section className={card}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className={cardTitle}>Demand Steering Exports</h2>
            <p className="text-sm text-slate-600">Scale SKUs and Expand Cities actions for activation.</p>
          </div>
          <button type="button" style={secondaryButtonStyle} onClick={() => window.location.reload()}>
            Refresh
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {demandExports.map((item) => (
            <section key={item.key} className={card}>
              <h3 className={cardTitle}>{item.title}</h3>
              <p className="mb-4 text-sm text-slate-600">{item.description}</p>
              <button
                type="button"
                style={isNavigating === item.key ? secondaryButtonStyle : primaryButtonStyle}
                onClick={() => void handleExportRpcCsv(item)}
                disabled={isNavigating !== null}
              >
                {isNavigating === item.key ? "Exporting..." : "Export CSV"}
              </button>
            </section>
          ))}
        </div>
      </section>

      <section className={card}>
        <h2 className={cardTitle}>Audience Exports</h2>
        <p className="text-sm text-slate-600">Download Meta-compatible customer list CSV files.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {audienceExports.map((item) => (
            <section key={item.key} className={card}>
              <h3 className={cardTitle}>{item.title}</h3>
              <p className="mb-4 text-sm text-slate-600">{item.description}</p>
              <button
                type="button"
                style={isNavigating === item.key ? secondaryButtonStyle : primaryButtonStyle}
                onClick={() => void handleExportRpcCsv(item)}
                disabled={isNavigating !== null}
              >
                {isNavigating === item.key ? "Exporting..." : "Export CSV"}
              </button>
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
