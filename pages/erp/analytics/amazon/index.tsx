import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import {
  badgeStyle,
  cardStyle,
  eyebrowStyle,
  h1Style,
  inputStyle,
  pageContainerStyle,
  pageHeaderStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  subtitleStyle,
  tableCellStyle,
  tableHeaderCellStyle,
  tableStyle,
} from "../../../../components/erp/uiStyles";
import { createCsvBlob, triggerDownload } from "../../../../components/inventory/csvUtils";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";

const salesBySkuSchema = z.object({
  grain_start: z.string().nullable(),
  mapped_variant_id: z.string().nullable(),
  erp_sku: z.string().nullable(),
  style_code: z.string().nullable(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  units: z.number().nullable(),
  gross: z.number().nullable(),
  tax: z.number().nullable(),
  net: z.number().nullable(),
});

const salesByGeoSchema = z.object({
  geo_key: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  orders: z.number().nullable(),
  customers: z.number().nullable(),
  units: z.number().nullable(),
  gross: z.number().nullable(),
});

const cohortSchema = z.object({
  cohort_start: z.string().nullable(),
  period_index: z.number().nullable(),
  customers: z.number().nullable(),
  repeat_customers: z.number().nullable(),
  orders: z.number().nullable(),
  gross: z.number().nullable(),
});

const returnsSchema = z.object({
  mapped_variant_id: z.string().nullable(),
  erp_sku: z.string().nullable(),
  units_sold: z.number().nullable(),
  units_returned: z.number().nullable(),
  return_rate: z.number().nullable(),
});

const reportRunSchema = z.object({
  id: z.string(),
  status: z.string().nullable(),
  requested_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  row_count: z.number().nullable(),
  report_type: z.string().nullable(),
  report_id: z.string().nullable(),
  report_document_id: z.string().nullable(),
  error: z.string().nullable(),
});

const cohortEmailStatsSchema = z.object({
  total_rows: z.number().nullable(),
  missing_email_rows: z.number().nullable(),
  missing_email_ratio: z.number().nullable(),
});

const filtersGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: 12,
  alignItems: "end",
};

const errorStyle: CSSProperties = {
  margin: 0,
  color: "#b91c1c",
  fontSize: 13,
};

const mutedStyle: CSSProperties = {
  margin: 0,
  color: "#6b7280",
  fontSize: 13,
};

const toastStyle = (type: "success" | "error"): CSSProperties => ({
  marginTop: 12,
  padding: "8px 12px",
  borderRadius: 8,
  background: type === "success" ? "#ecfdf5" : "#fef2f2",
  border: `1px solid ${type === "success" ? "#a7f3d0" : "#fecaca"}`,
  color: type === "success" ? "#047857" : "#b91c1c",
  fontSize: 13,
});

const warningBannerStyle: CSSProperties = {
  margin: "0 0 12px",
  padding: "8px 12px",
  borderRadius: 8,
  background: "#fffbeb",
  border: "1px solid #fcd34d",
  color: "#92400e",
  fontSize: 13,
};

function formatDateInput(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
    }).format(value);
  } catch (error) {
    return value.toFixed(2);
  }
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function escapeCsvValue(value: string) {
  if (value.includes("\"") || value.includes(",") || value.includes("\n")) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function buildCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const headerRow = headers.map((header) => escapeCsvValue(header));
  const dataRows = rows.map((row) =>
    row.map((cell) => {
      const value = cell === null || cell === undefined ? "" : String(cell);
      return escapeCsvValue(value);
    })
  );
  return [headerRow, ...dataRows].map((row) => row.join(",")).join("\n");
}

export default function AmazonAnalyticsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"sku" | "geo" | "cohorts" | "returns">("sku");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [skuGrain, setSkuGrain] = useState<"day" | "week">("day");
  const [geoLevel, setGeoLevel] = useState<"state" | "city">("state");
  const [cohortGrain, setCohortGrain] = useState<"month" | "week">("month");
  const [salesBySku, setSalesBySku] = useState<z.infer<typeof salesBySkuSchema>[]>([]);
  const [salesByGeo, setSalesByGeo] = useState<z.infer<typeof salesByGeoSchema>[]>([]);
  const [cohorts, setCohorts] = useState<z.infer<typeof cohortSchema>[]>([]);
  const [topReturns, setTopReturns] = useState<z.infer<typeof returnsSchema>[]>([]);
  const [hasReturns, setHasReturns] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastRun, setLastRun] = useState<z.infer<typeof reportRunSchema> | null>(null);
  const [exportingTab, setExportingTab] = useState<null | "sku" | "geo" | "cohorts">(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [cohortEmailStats, setCohortEmailStats] =
    useState<z.infer<typeof cohortEmailStatsSchema> | null>(null);

  const visibleTabs = useMemo(() => {
    const tabs: Array<typeof activeTab> = ["sku", "geo", "cohorts"];
    if (hasReturns) tabs.push("returns");
    return tabs;
  }, [hasReturns]);

  const repeatSummary = useMemo(() => {
    const totalCustomers = cohorts
      .filter((row) => (row.period_index ?? 0) === 0)
      .reduce((sum, row) => sum + (row.customers ?? 0), 0);
    const repeatCustomers = cohorts
      .filter((row) => (row.period_index ?? 0) > 0)
      .reduce((sum, row) => sum + (row.repeat_customers ?? row.customers ?? 0), 0);
    const repeatRate = totalCustomers > 0 ? repeatCustomers / totalCustomers : 0;
    return { totalCustomers, repeatCustomers, repeatRate };
  }, [cohorts]);

  const loadReportRuns = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("erp_channel_report_runs_list", {
      p_channel_key: "amazon",
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_limit: 1,
      p_offset: 0,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const parsed = z.array(reportRunSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse report run history.");
      return;
    }

    setLastRun(parsed.data[0] ?? null);
  }, []);

  const loadSalesBySku = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_sku", {
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_from: fromDate,
      p_to: toDate,
      p_grain: skuGrain,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsLoadingData(false);
      return;
    }

    const parsed = z.array(salesBySkuSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse sales by SKU response.");
      setIsLoadingData(false);
      return;
    }

    setSalesBySku(parsed.data);
    setIsLoadingData(false);
  }, [fromDate, toDate, skuGrain]);

  const loadSalesByGeo = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_geo", {
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_from: fromDate,
      p_to: toDate,
      p_level: geoLevel,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsLoadingData(false);
      return;
    }

    const parsed = z.array(salesByGeoSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse sales by geo response.");
      setIsLoadingData(false);
      return;
    }

    setSalesByGeo(parsed.data);
    setIsLoadingData(false);
  }, [fromDate, toDate, geoLevel]);

  const loadCohorts = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_customer_cohorts", {
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_from: fromDate,
      p_to: toDate,
      p_cohort_grain: cohortGrain,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsLoadingData(false);
      return;
    }

    const parsed = z.array(cohortSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse customer cohort response.");
      setIsLoadingData(false);
      return;
    }

    setCohorts(parsed.data);
    setIsLoadingData(false);
  }, [fromDate, toDate, cohortGrain]);

  const loadCohortEmailStats = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_customer_cohort_email_stats", {
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_from: fromDate,
      p_to: toDate,
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const parsed = z.array(cohortEmailStatsSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse cohort availability response.");
      return;
    }

    setCohortEmailStats(parsed.data[0] ?? null);
  }, [fromDate, toDate]);

  const fetchAllSalesBySku = useCallback(async () => {
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof salesBySkuSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_sku", {
        p_marketplace_id: DEFAULT_MARKETPLACE_ID,
        p_from: fromDate,
        p_to: toDate,
        p_grain: skuGrain,
        p_limit: limit,
        p_offset: offset,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const parsed = z.array(salesBySkuSchema).safeParse(data ?? []);
      if (!parsed.success) {
        throw new Error("Unable to parse sales by SKU response.");
      }

      if (parsed.data.length === 0) break;
      rows.push(...parsed.data);
      offset += limit;
    }

    return rows;
  }, [fromDate, toDate, skuGrain]);

  const fetchAllSalesByGeo = useCallback(async () => {
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof salesByGeoSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_geo", {
        p_marketplace_id: DEFAULT_MARKETPLACE_ID,
        p_from: fromDate,
        p_to: toDate,
        p_level: geoLevel,
        p_limit: limit,
        p_offset: offset,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const parsed = z.array(salesByGeoSchema).safeParse(data ?? []);
      if (!parsed.success) {
        throw new Error("Unable to parse sales by geo response.");
      }

      if (parsed.data.length === 0) break;
      rows.push(...parsed.data);
      offset += limit;
    }

    return rows;
  }, [fromDate, toDate, geoLevel]);

  const fetchAllCohorts = useCallback(async () => {
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof cohortSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_customer_cohorts_page", {
        p_marketplace_id: DEFAULT_MARKETPLACE_ID,
        p_from: fromDate,
        p_to: toDate,
        p_cohort_grain: cohortGrain,
        p_limit: limit,
        p_offset: offset,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const parsed = z.array(cohortSchema).safeParse(data ?? []);
      if (!parsed.success) {
        throw new Error("Unable to parse customer cohort response.");
      }

      if (parsed.data.length === 0) break;
      rows.push(...parsed.data);
      offset += limit;
    }

    return rows;
  }, [fromDate, toDate, cohortGrain]);

  const loadReturnsAvailability = useCallback(async () => {
    const { count, error: countError } = await supabase
      .from("erp_amazon_return_facts")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_id", DEFAULT_MARKETPLACE_ID);

    if (countError) {
      setError(countError.message);
      return;
    }

    setHasReturns((count ?? 0) > 0);
  }, []);

  const loadTopReturns = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_top_returns", {
      p_marketplace_id: DEFAULT_MARKETPLACE_ID,
      p_from: fromDate,
      p_to: toDate,
      p_limit: 50,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsLoadingData(false);
      return;
    }

    const parsed = z.array(returnsSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse returns response.");
      setIsLoadingData(false);
      return;
    }

    setTopReturns(parsed.data);
    setIsLoadingData(false);
  }, [fromDate, toDate]);

  const handleRefresh = useCallback(async () => {
    setError(null);
    if (activeTab === "sku") {
      await loadSalesBySku();
    } else if (activeTab === "geo") {
      await loadSalesByGeo();
    } else if (activeTab === "cohorts") {
      await loadCohorts();
      await loadCohortEmailStats();
    } else if (activeTab === "returns") {
      await loadTopReturns();
    }
  }, [activeTab, loadSalesBySku, loadSalesByGeo, loadCohorts, loadTopReturns, loadCohortEmailStats]);

  const handleExportSku = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setExportingTab("sku");
    setToast(null);
    try {
      const rows = await fetchAllSalesBySku();
      const csv = buildCsv(
        ["Period", "ERP SKU", "Style", "Size", "Color", "Units", "Gross", "Tax", "Net"],
        rows.map((row) => [
          row.grain_start ?? "",
          row.erp_sku ?? "",
          row.style_code ?? "",
          row.size ?? "",
          row.color ?? "",
          row.units ?? 0,
          row.gross ?? 0,
          row.tax ?? 0,
          row.net ?? 0,
        ])
      );
      const filename = `amazon_sales_by_sku_${skuGrain}_${fromDate}_${toDate}.csv`;
      triggerDownload(filename, createCsvBlob(csv));
      setToast({ type: "success", message: `Exported ${rows.length} rows` });
    } catch (exportError) {
      setToast({
        type: "error",
        message: exportError instanceof Error ? exportError.message : "Failed to export CSV.",
      });
    } finally {
      setExportingTab(null);
    }
  }, [fetchAllSalesBySku, fromDate, skuGrain, toDate]);

  const handleExportGeo = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setExportingTab("geo");
    setToast(null);
    try {
      const rows = await fetchAllSalesByGeo();
      const headers = ["State"];
      if (geoLevel === "city") headers.push("City");
      headers.push("Orders", "Customers", "Units", "Gross");
      const csv = buildCsv(
        headers,
        rows.map((row) => [
          row.state ?? "",
          ...(geoLevel === "city" ? [row.city ?? ""] : []),
          row.orders ?? 0,
          row.customers ?? 0,
          row.units ?? 0,
          row.gross ?? 0,
        ])
      );
      const filename = `amazon_sales_by_geo_${geoLevel}_${fromDate}_${toDate}.csv`;
      triggerDownload(filename, createCsvBlob(csv));
      setToast({ type: "success", message: `Exported ${rows.length} rows` });
    } catch (exportError) {
      setToast({
        type: "error",
        message: exportError instanceof Error ? exportError.message : "Failed to export CSV.",
      });
    } finally {
      setExportingTab(null);
    }
  }, [fetchAllSalesByGeo, fromDate, geoLevel, toDate]);

  const handleExportCohorts = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setExportingTab("cohorts");
    setToast(null);
    try {
      const rows = await fetchAllCohorts();
      const csv = buildCsv(
        ["Cohort start", "Period index", "Customers", "Repeat customers", "Orders", "Gross"],
        rows.map((row) => [
          row.cohort_start ?? "",
          row.period_index ?? 0,
          row.customers ?? 0,
          row.repeat_customers ?? 0,
          row.orders ?? 0,
          row.gross ?? 0,
        ])
      );
      const filename = `amazon_customer_cohorts_${cohortGrain}_${fromDate}_${toDate}.csv`;
      triggerDownload(filename, createCsvBlob(csv));
      setToast({ type: "success", message: `Exported ${rows.length} rows` });
    } catch (exportError) {
      setToast({
        type: "error",
        message: exportError instanceof Error ? exportError.message : "Failed to export CSV.",
      });
    } finally {
      setExportingTab(null);
    }
  }, [fetchAllCohorts, fromDate, cohortGrain, toDate]);

  const handleSync = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsSyncing(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setError("No active session found to sync analytics.");
        return;
      }

      const response = await fetch("/api/integrations/amazon/analytics/reports-sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          marketplaceId: DEFAULT_MARKETPLACE_ID,
          from: fromDate,
          to: toDate,
        }),
      });

      const payload = (await response.json()) as SyncResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? "Failed to sync analytics report." : payload.error);
        return;
      }

      await loadReportRuns();
      await handleRefresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Failed to sync analytics report.");
    } finally {
      setIsSyncing(false);
    }
  }, [fromDate, toDate, handleRefresh, loadReportRuns]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

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
    if (fromDate || toDate) return;
    const now = new Date();
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setFromDate(formatDateInput(start));
    setToDate(formatDateInput(now));
  }, [fromDate, toDate]);

  useEffect(() => {
    loadReturnsAvailability();
    loadReportRuns();
  }, [loadReportRuns, loadReturnsAvailability]);

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("sku");
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (loading || !fromDate || !toDate) return;
    handleRefresh();
  }, [loading, fromDate, toDate, skuGrain, geoLevel, cohortGrain, activeTab, handleRefresh]);

  useEffect(() => {
    if (activeTab !== "cohorts") return;
    loadCohortEmailStats();
  }, [activeTab, loadCohortEmailStats]);

  if (loading) {
    return <div style={pageContainerStyle}>Loading Amazon analytics…</div>;
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Analytics · Amazon</p>
            <h1 style={h1Style}>Amazon Analytics (India)</h1>
            <p style={subtitleStyle}>Sales, geo performance, and repeat customer signals from reports.</p>
            {lastRun ? (
              <p style={mutedStyle}>
                Last sync: {lastRun.status ?? "unknown"} · {lastRun.requested_at ?? "—"} · rows {lastRun.row_count ?? 0}
              </p>
            ) : (
              <p style={mutedStyle}>No report runs yet. Sync to load analytics facts.</p>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={secondaryButtonStyle} onClick={handleRefresh} disabled={isLoadingData}>
              Refresh
            </button>
            <button type="button" style={primaryButtonStyle} onClick={handleSync} disabled={isSyncing}>
              {isSyncing ? "Syncing analytics…" : "Sync analytics (reports)"}
            </button>
          </div>
        </header>

        {error ? <p style={errorStyle}>{error}</p> : null}
        {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={filtersGridStyle}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#4b5563" }}>
              From date
              <input
                type="date"
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#4b5563" }}>
              To date
              <input
                type="date"
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
                style={inputStyle}
              />
            </label>
          </div>
        </section>

        <section style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {visibleTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                style={tab === activeTab ? primaryButtonStyle : secondaryButtonStyle}
                onClick={() => setActiveTab(tab)}
              >
                {tab === "sku" && "Sales by SKU"}
                {tab === "geo" && "Sales by State/City"}
                {tab === "cohorts" && "Customer Cohorts"}
                {tab === "returns" && "Returns/Refunds"}
              </button>
            ))}
          </div>
        </section>

        {activeTab === "sku" ? (
          <section style={cardStyle}>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Sales by SKU</p>
                <span style={badgeStyle}>Grain: {skuGrain}</span>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setSkuGrain(skuGrain === "day" ? "week" : "day")}
                >
                  Toggle grain
                </button>
              </div>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={handleExportSku}
                disabled={exportingTab === "sku" || !fromDate || !toDate}
              >
                {exportingTab === "sku" ? "Exporting…" : "Export CSV"}
              </button>
            </div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Period</th>
                  <th style={tableHeaderCellStyle}>ERP SKU</th>
                  <th style={tableHeaderCellStyle}>Style</th>
                  <th style={tableHeaderCellStyle}>Size</th>
                  <th style={tableHeaderCellStyle}>Color</th>
                  <th style={tableHeaderCellStyle}>Units</th>
                  <th style={tableHeaderCellStyle}>Gross</th>
                  <th style={tableHeaderCellStyle}>Tax</th>
                  <th style={tableHeaderCellStyle}>Net</th>
                </tr>
              </thead>
              <tbody>
                {salesBySku.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={9}>
                      {isLoadingData ? "Loading sales…" : "No sales data found."}
                    </td>
                  </tr>
                ) : (
                  salesBySku.map((row, index) => (
                    <tr key={`${row.erp_sku ?? "sku"}-${row.grain_start ?? index}`}>
                      <td style={tableCellStyle}>{row.grain_start ?? "—"}</td>
                      <td style={tableCellStyle}>{row.erp_sku ?? "Unmapped"}</td>
                      <td style={tableCellStyle}>{row.style_code ?? "—"}</td>
                      <td style={tableCellStyle}>{row.size ?? "—"}</td>
                      <td style={tableCellStyle}>{row.color ?? "—"}</td>
                      <td style={tableCellStyle}>{row.units ?? 0}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.tax ?? 0)}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.net ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "geo" ? (
          <section style={cardStyle}>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Sales by geography</p>
                <span style={badgeStyle}>Level: {geoLevel}</span>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setGeoLevel(geoLevel === "state" ? "city" : "state")}
                >
                  Toggle level
                </button>
              </div>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={handleExportGeo}
                disabled={exportingTab === "geo" || !fromDate || !toDate}
              >
                {exportingTab === "geo" ? "Exporting…" : "Export CSV"}
              </button>
            </div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>State</th>
                  {geoLevel === "city" ? <th style={tableHeaderCellStyle}>City</th> : null}
                  <th style={tableHeaderCellStyle}>Orders</th>
                  <th style={tableHeaderCellStyle}>Customers</th>
                  <th style={tableHeaderCellStyle}>Units</th>
                  <th style={tableHeaderCellStyle}>Gross</th>
                </tr>
              </thead>
              <tbody>
                {salesByGeo.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={geoLevel === "city" ? 6 : 5}>
                      {isLoadingData ? "Loading geo data…" : "No geography data found."}
                    </td>
                  </tr>
                ) : (
                  salesByGeo.map((row, index) => (
                    <tr key={`${row.geo_key ?? "geo"}-${index}`}>
                      <td style={tableCellStyle}>{row.state ?? "—"}</td>
                      {geoLevel === "city" ? <td style={tableCellStyle}>{row.city ?? "—"}</td> : null}
                      <td style={tableCellStyle}>{row.orders ?? 0}</td>
                      <td style={tableCellStyle}>{row.customers ?? 0}</td>
                      <td style={tableCellStyle}>{row.units ?? 0}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "cohorts" ? (
          <section style={cardStyle}>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Customer cohorts</p>
                <span style={badgeStyle}>Cohort: {cohortGrain}</span>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setCohortGrain(cohortGrain === "month" ? "week" : "month")}
                >
                  Toggle cohort grain
                </button>
              </div>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={handleExportCohorts}
                disabled={exportingTab === "cohorts" || !fromDate || !toDate}
              >
                {exportingTab === "cohorts" ? "Exporting…" : "Export CSV"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <span style={badgeStyle}>Total customers: {repeatSummary.totalCustomers}</span>
              <span style={badgeStyle}>Repeat customers: {repeatSummary.repeatCustomers}</span>
              <span style={badgeStyle}>Repeat rate: {formatPercent(repeatSummary.repeatRate)}</span>
            </div>
            {cohortEmailStats &&
            (cohortEmailStats.missing_email_ratio ?? 0) > 0.8 &&
            (cohortEmailStats.total_rows ?? 0) > 0 ? (
              <div style={warningBannerStyle}>
                Buyer email not available in this report. Cohorts are estimated using shipping postal/state fallback.
              </div>
            ) : null}
            <p style={mutedStyle}>Repeat rates depend on buyer email availability.</p>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Cohort start</th>
                  <th style={tableHeaderCellStyle}>Period index</th>
                  <th style={tableHeaderCellStyle}>Customers</th>
                  <th style={tableHeaderCellStyle}>Repeat customers</th>
                  <th style={tableHeaderCellStyle}>Orders</th>
                  <th style={tableHeaderCellStyle}>Gross</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      {isLoadingData
                        ? "Loading cohorts…"
                        : "No cohort data found (buyer email may be missing)."}
                    </td>
                  </tr>
                ) : (
                  cohorts.map((row, index) => (
                    <tr key={`${row.cohort_start ?? "cohort"}-${row.period_index ?? index}`}>
                      <td style={tableCellStyle}>{row.cohort_start ?? "—"}</td>
                      <td style={tableCellStyle}>{row.period_index ?? 0}</td>
                      <td style={tableCellStyle}>{row.customers ?? 0}</td>
                      <td style={tableCellStyle}>{row.repeat_customers ?? 0}</td>
                      <td style={tableCellStyle}>{row.orders ?? 0}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "returns" ? (
          <section style={cardStyle}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>Returns & refunds</p>
              <span style={badgeStyle}>Top returned SKUs</span>
            </div>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>ERP SKU</th>
                  <th style={tableHeaderCellStyle}>Units sold</th>
                  <th style={tableHeaderCellStyle}>Units returned</th>
                  <th style={tableHeaderCellStyle}>Return rate</th>
                </tr>
              </thead>
              <tbody>
                {topReturns.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={4}>
                      {isLoadingData ? "Loading returns…" : "No return data found."}
                    </td>
                  </tr>
                ) : (
                  topReturns.map((row, index) => (
                    <tr key={`${row.erp_sku ?? "return"}-${index}`}>
                      <td style={tableCellStyle}>{row.erp_sku ?? "Unmapped"}</td>
                      <td style={tableCellStyle}>{row.units_sold ?? 0}</td>
                      <td style={tableCellStyle}>{row.units_returned ?? 0}</td>
                      <td style={tableCellStyle}>{formatPercent(row.return_rate ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}

type SyncResponse =
  | {
      ok: true;
      run_id: string;
      report_id: string;
      row_count: number;
      facts_upserted: number;
      inserted_rows: number;
      skipped_rows: number;
    }
  | { ok: false; error: string; details?: string };
