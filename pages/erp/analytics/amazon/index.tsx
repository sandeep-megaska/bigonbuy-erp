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
const MARKETPLACE_OPTIONS = [{ id: DEFAULT_MARKETPLACE_ID, label: "Amazon India" }];

const overviewKpiSchema = z.object({
  gross: z.number().nullable(),
  net: z.number().nullable(),
  units: z.number().nullable(),
  orders: z.number().nullable(),
  customers_known: z.number().nullable(),
  customers_estimated: z.number().nullable(),
  repeat_rate_known: z.number().nullable(),
  repeat_rate_estimated: z.number().nullable(),
});

const overviewKpiV2Schema = z.object({
  gross_sales: z.number().nullable(),
  net_sales_estimated: z.number().nullable(),
  confirmed_orders_count: z.number().nullable(),
  confirmed_orders_value: z.number().nullable(),
  cancellations_count: z.number().nullable(),
  cancellations_value: z.number().nullable(),
  returns_count: z.number().nullable(),
  returns_value: z.number().nullable(),
  discount_value: z.number().nullable(),
  avg_per_day: z.number().nullable(),
  days_count: z.number().nullable(),
});

const skuSummarySchema = z.object({
  mapped_variant_id: z.string().nullable(),
  erp_sku: z.string().nullable(),
  style_code: z.string().nullable(),
  size: z.string().nullable(),
  color: z.string().nullable(),
  orders: z.number().nullable(),
  customers: z.number().nullable(),
  units: z.number().nullable(),
  gross: z.number().nullable(),
  net: z.number().nullable(),
  asp: z.number().nullable(),
});

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
  gross_share_within_state: z.number().nullable(),
  rank_within_state: z.number().nullable(),
  rank_overall: z.number().nullable(),
});

const unmappedSkuSchema = z.object({
  external_sku: z.string().nullable(),
  asin: z.string().nullable(),
  fnsku: z.string().nullable(),
  units: z.number().nullable(),
  net: z.number().nullable(),
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

const stickyFilterStyle: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 5,
  background: "#fff",
  paddingBottom: 12,
  borderBottom: "1px solid #e5e7eb",
  marginBottom: 16,
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

const statusBannerStyle: CSSProperties = {
  marginTop: 12,
  padding: "8px 12px",
  borderRadius: 8,
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  color: "#374151",
  fontSize: 13,
};

const pageSize = 50;

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

function formatNumber(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatSharePercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(2)}%`;
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
  const [activeTab, setActiveTab] = useState<"overview" | "sku" | "geo" | "customers" | "returns">("overview");
  const [marketplaceId, setMarketplaceId] = useState(DEFAULT_MARKETPLACE_ID);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [skuMode, setSkuMode] = useState<"summary" | "daily" | "weekly">("summary");
  const [skuSort, setSkuSort] = useState<"units_desc" | "net_desc" | "units_asc" | "net_asc">("units_desc");
  const [skuQuery, setSkuQuery] = useState("");
  const [geoLevel, setGeoLevel] = useState<"state" | "city">("state");
  const [geoStateFilter, setGeoStateFilter] = useState<string | null>(null);
  const [cohortGrain, setCohortGrain] = useState<"month" | "week">("month");
  const [salesBySku, setSalesBySku] = useState<z.infer<typeof salesBySkuSchema>[]>([]);
  const [skuSummary, setSkuSummary] = useState<z.infer<typeof skuSummarySchema>[]>([]);
  const [salesByGeo, setSalesByGeo] = useState<z.infer<typeof salesByGeoSchema>[]>([]);
  const [geoTotalCount, setGeoTotalCount] = useState<number | null>(null);
  const [drilldownTarget, setDrilldownTarget] = useState<{ state: string; city?: string } | null>(null);
  const [drilldownSkus, setDrilldownSkus] = useState<z.infer<typeof skuSummarySchema>[]>([]);
  const [cohorts, setCohorts] = useState<z.infer<typeof cohortSchema>[]>([]);
  const [topReturns, setTopReturns] = useState<z.infer<typeof returnsSchema>[]>([]);
  const [overviewKpis, setOverviewKpis] = useState<z.infer<typeof overviewKpiSchema> | null>(null);
  const [overviewKpisV2, setOverviewKpisV2] = useState<z.infer<typeof overviewKpiV2Schema> | null>(null);
  const [overviewTopSkus, setOverviewTopSkus] = useState<z.infer<typeof skuSummarySchema>[]>([]);
  const [overviewTopStates, setOverviewTopStates] = useState<z.infer<typeof salesByGeoSchema>[]>([]);
  const [overviewSlowMovers, setOverviewSlowMovers] = useState<z.infer<typeof skuSummarySchema>[]>([]);
  const [overviewMappingGaps, setOverviewMappingGaps] = useState<z.infer<typeof unmappedSkuSchema>[]>([]);
  const [hasReturns, setHasReturns] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isLoadingDrilldown, setIsLoadingDrilldown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastRun, setLastRun] = useState<z.infer<typeof reportRunSchema> | null>(null);
  const [exportSelection, setExportSelection] = useState<string>("");
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [cohortEmailStats, setCohortEmailStats] =
    useState<z.infer<typeof cohortEmailStatsSchema> | null>(null);
  const [skuPage, setSkuPage] = useState(0);
  const [geoPage, setGeoPage] = useState(0);
  const [cohortPage, setCohortPage] = useState(0);

  const exportOptions = useMemo(() => {
    if (activeTab === "overview") {
      return [
        { value: "overview_top_skus", label: "Overview · Top SKUs" },
        { value: "overview_top_states", label: "Overview · Top states" },
        { value: "overview_slow_movers", label: "Overview · Slow movers" },
        { value: "overview_mapping_gaps", label: "Overview · Mapping gaps" },
      ];
    }

    if (activeTab === "sku") {
      return [
        {
          value: "sku_current",
          label: `Sales by SKU · ${skuMode === "summary" ? "Summary" : skuMode === "daily" ? "Daily" : "Weekly"}`,
        },
      ];
    }

    if (activeTab === "geo") {
      return [{ value: "geo_current", label: `Sales by geography · ${geoLevel}` }];
    }

    if (activeTab === "customers") {
      return [
        { value: "customers_new_repeat", label: "Customers · New vs repeat" },
        { value: "customers_cohorts", label: "Customers · Cohorts" },
      ];
    }

    return [{ value: "returns_top", label: "Returns · Top returned SKUs" }];
  }, [activeTab, geoLevel, skuMode]);

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

  const filteredSkuRows = useMemo(() => {
    if (!skuQuery.trim() || skuMode === "summary") return salesBySku;
    const q = skuQuery.trim().toLowerCase();
    return salesBySku.filter((row) =>
      [row.erp_sku, row.style_code, row.size, row.color]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(q))
    );
  }, [salesBySku, skuMode, skuQuery]);

  const pagedSkuSummary = useMemo(() => skuSummary, [skuSummary]);
  const geoHasNextPage = useMemo(() => {
    if (geoTotalCount === null) return salesByGeo.length >= pageSize;
    return (geoPage + 1) * pageSize < geoTotalCount;
  }, [geoTotalCount, salesByGeo.length, geoPage]);

  const loadReportRuns = useCallback(async () => {
    const { data, error: rpcError } = await supabase.rpc("erp_channel_report_runs_list", {
      p_channel_key: "amazon",
      p_marketplace_id: marketplaceId,
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
  }, [marketplaceId]);

  const loadOverviewKpis = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_overview_kpis", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(overviewKpiSchema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse overview KPI response.");
    }

    setOverviewKpis(parsed.data[0] ?? null);
  }, [fromDate, toDate, marketplaceId]);

  const loadOverviewKpisV2 = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_overview_v2", {
      p_from: fromDate,
      p_to: toDate,
      p_marketplace: marketplaceId,
      p_channel_account_id: null,
      p_fulfillment_mode: null,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(overviewKpiV2Schema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse overview KPI response.");
    }

    setOverviewKpisV2(parsed.data[0] ?? null);
  }, [fromDate, toDate, marketplaceId]);

  const loadOverviewTopSkus = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sku_summary", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_sort: "units_desc",
      p_limit: 20,
      p_offset: 0,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(skuSummarySchema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse top SKU summary response.");
    }

    setOverviewTopSkus(parsed.data);
  }, [fromDate, toDate, marketplaceId]);

  const loadOverviewSlowMovers = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sku_summary", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_sort: "units_asc",
      p_limit: 20,
      p_offset: 0,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(skuSummarySchema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse slow mover summary response.");
    }

    setOverviewSlowMovers(parsed.data.filter((row) => (row.units ?? 0) > 0));
  }, [fromDate, toDate, marketplaceId]);

  const loadOverviewTopStates = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_geo_v2", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_level: "state",
      p_state: null,
      p_limit: 20,
      p_offset: 0,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(salesByGeoSchema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse top state response.");
    }

    setOverviewTopStates(parsed.data);
  }, [fromDate, toDate, marketplaceId]);

  const loadOverviewMappingGaps = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_unmapped_skus", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_limit: 20,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(unmappedSkuSchema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse unmapped SKU response.");
    }

    setOverviewMappingGaps(parsed.data);
  }, [fromDate, toDate, marketplaceId]);

  const loadOverview = useCallback(async () => {
    setIsLoadingData(true);
    try {
      await Promise.all([
        loadOverviewKpisV2(),
        loadOverviewTopSkus(),
        loadOverviewTopStates(),
        loadOverviewSlowMovers(),
        loadOverviewMappingGaps(),
      ]);
    } catch (overviewError) {
      setError(overviewError instanceof Error ? overviewError.message : "Failed to load overview data.");
    } finally {
      setIsLoadingData(false);
    }
  }, [
    loadOverviewKpisV2,
    loadOverviewMappingGaps,
    loadOverviewSlowMovers,
    loadOverviewTopSkus,
    loadOverviewTopStates,
  ]);

  const loadSkuSummary = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sku_summary", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_sort: skuSort,
      p_q: skuQuery.trim() === "" ? null : skuQuery.trim(),
      p_limit: pageSize,
      p_offset: skuPage * pageSize,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsLoadingData(false);
      return;
    }

    const parsed = z.array(skuSummarySchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse SKU summary response.");
      setIsLoadingData(false);
      return;
    }

    setSkuSummary(parsed.data);
    setIsLoadingData(false);
  }, [fromDate, toDate, skuSort, skuQuery, marketplaceId, skuPage]);

  const loadSalesBySku = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_sku", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_grain: skuMode === "weekly" ? "week" : "day",
      p_limit: pageSize,
      p_offset: skuPage * pageSize,
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
  }, [fromDate, toDate, skuMode, marketplaceId, skuPage]);

  const fetchAllSalesByGeo = useCallback(async () => {
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof salesByGeoSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_geo_v2", {
        p_marketplace_id: marketplaceId,
        p_from: fromDate,
        p_to: toDate,
        p_level: geoLevel,
        p_state: geoLevel === "city" ? geoStateFilter : null,
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
  }, [fromDate, toDate, geoLevel, geoStateFilter, marketplaceId]);

  const loadSalesByGeo = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    try {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_geo_v2", {
        p_marketplace_id: marketplaceId,
        p_from: fromDate,
        p_to: toDate,
        p_level: geoLevel,
        p_state: geoLevel === "city" ? geoStateFilter : null,
        p_limit: pageSize,
        p_offset: geoPage * pageSize,
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
      setGeoTotalCount(null);
      setIsLoadingData(false);
    } catch (geoError) {
      setError(geoError instanceof Error ? geoError.message : "Unable to load sales by geo data.");
      setIsLoadingData(false);
    }
  }, [fromDate, toDate, geoLevel, geoPage, geoStateFilter, marketplaceId]);

  const loadTopSkusByGeo = useCallback(
    async (target: { state: string; city?: string }) => {
      if (!fromDate || !toDate) return;
      setIsLoadingDrilldown(true);
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_top_skus_by_geo", {
        p_marketplace_id: marketplaceId,
        p_from: fromDate,
        p_to: toDate,
        p_level: geoLevel,
        p_state: target.state,
        p_city: target.city ?? null,
        p_limit: 100,
      });

      if (rpcError) {
        setError(rpcError.message);
        setIsLoadingDrilldown(false);
        return;
      }

      const parsed = z.array(skuSummarySchema).safeParse(data ?? []);
      if (!parsed.success) {
        setError("Unable to parse geo drilldown response.");
        setIsLoadingDrilldown(false);
        return;
      }

      setDrilldownSkus(parsed.data);
      setIsLoadingDrilldown(false);
    },
    [fromDate, toDate, marketplaceId, geoLevel]
  );

  const loadCohorts = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_customer_cohorts_page", {
      p_marketplace_id: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_cohort_grain: cohortGrain,
      p_limit: pageSize,
      p_offset: cohortPage * pageSize,
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
  }, [fromDate, toDate, cohortGrain, marketplaceId, cohortPage]);

  const loadCohortEmailStats = useCallback(async () => {
    if (!fromDate || !toDate) return;
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_customer_cohort_email_stats", {
      p_marketplace_id: marketplaceId,
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
  }, [fromDate, toDate, marketplaceId]);

  const fetchAllSkuSummary = useCallback(async () => {
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof skuSummarySchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sku_summary", {
        p_marketplace_id: marketplaceId,
        p_from: fromDate,
        p_to: toDate,
        p_sort: skuSort,
        p_q: skuQuery.trim() === "" ? null : skuQuery.trim(),
        p_limit: limit,
        p_offset: offset,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const parsed = z.array(skuSummarySchema).safeParse(data ?? []);
      if (!parsed.success) {
        throw new Error("Unable to parse SKU summary response.");
      }

      if (parsed.data.length === 0) break;
      rows.push(...parsed.data);
      offset += limit;
    }

    return rows;
  }, [fromDate, toDate, skuSort, skuQuery, marketplaceId]);

  const fetchAllSalesBySku = useCallback(async () => {
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof salesBySkuSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_sales_by_sku", {
        p_marketplace_id: marketplaceId,
        p_from: fromDate,
        p_to: toDate,
        p_grain: skuMode === "weekly" ? "week" : "day",
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
  }, [fromDate, toDate, skuMode, marketplaceId]);

  const fetchAllCohorts = useCallback(async () => {
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof cohortSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_customer_cohorts_page", {
        p_marketplace_id: marketplaceId,
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
  }, [fromDate, toDate, cohortGrain, marketplaceId]);

  const loadReturnsAvailability = useCallback(async () => {
    const { count, error: countError } = await supabase
      .from("erp_amazon_return_facts")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_id", marketplaceId);

    if (countError) {
      setError(countError.message);
      return;
    }

    setHasReturns((count ?? 0) > 0);
  }, [marketplaceId]);

  const loadTopReturns = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_top_returns", {
      p_marketplace_id: marketplaceId,
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
  }, [fromDate, toDate, marketplaceId]);

  const handleRefresh = useCallback(async () => {
    setError(null);
    if (activeTab === "overview") {
      await loadOverview();
    } else if (activeTab === "sku") {
      if (skuMode === "summary") {
        await loadSkuSummary();
      } else {
        await loadSalesBySku();
      }
    } else if (activeTab === "geo") {
      await loadSalesByGeo();
    } else if (activeTab === "customers") {
      await loadOverviewKpis();
      await loadCohorts();
      await loadCohortEmailStats();
    } else if (activeTab === "returns") {
      await loadTopReturns();
    }
  }, [
    activeTab,
    loadOverview,
    loadSkuSummary,
    loadSalesBySku,
    loadSalesByGeo,
    loadOverviewKpis,
    loadCohorts,
    loadCohortEmailStats,
    loadTopReturns,
    skuMode,
  ]);

  const handleExport = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!exportSelection) return;
    setExportingKey(exportSelection);
    setToast(null);
    try {
      if (exportSelection === "overview_top_skus") {
        const csv = buildCsv(
          ["ERP SKU", "Style", "Size", "Color", "Orders", "Customers", "Units", "Gross", "Net", "ASP"],
          overviewTopSkus.map((row) => [
            row.erp_sku ?? "",
            row.style_code ?? "",
            row.size ?? "",
            row.color ?? "",
            row.orders ?? 0,
            row.customers ?? 0,
            row.units ?? 0,
            row.gross ?? 0,
            row.net ?? 0,
            row.asp ?? 0,
          ])
        );
        triggerDownload(`amazon_overview_top_skus_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${overviewTopSkus.length} rows` });
        return;
      }

      if (exportSelection === "overview_top_states") {
        const csv = buildCsv(
          ["State", "Orders", "Customers", "Units", "Gross"],
          overviewTopStates.map((row) => [row.state ?? "", row.orders ?? 0, row.customers ?? 0, row.units ?? 0, row.gross ?? 0])
        );
        triggerDownload(`amazon_overview_top_states_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${overviewTopStates.length} rows` });
        return;
      }

      if (exportSelection === "overview_slow_movers") {
        const csv = buildCsv(
          ["ERP SKU", "Style", "Size", "Color", "Orders", "Customers", "Units", "Gross", "Net", "ASP"],
          overviewSlowMovers.map((row) => [
            row.erp_sku ?? "",
            row.style_code ?? "",
            row.size ?? "",
            row.color ?? "",
            row.orders ?? 0,
            row.customers ?? 0,
            row.units ?? 0,
            row.gross ?? 0,
            row.net ?? 0,
            row.asp ?? 0,
          ])
        );
        triggerDownload(`amazon_overview_slow_movers_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${overviewSlowMovers.length} rows` });
        return;
      }

      if (exportSelection === "overview_mapping_gaps") {
        const csv = buildCsv(
          ["External SKU", "ASIN", "FNSKU", "Units", "Net"],
          overviewMappingGaps.map((row) => [
            row.external_sku ?? "",
            row.asin ?? "",
            row.fnsku ?? "",
            row.units ?? 0,
            row.net ?? 0,
          ])
        );
        triggerDownload(`amazon_overview_mapping_gaps_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${overviewMappingGaps.length} rows` });
        return;
      }

      if (exportSelection === "sku_current") {
        if (skuMode === "summary") {
          const rows = await fetchAllSkuSummary();
          const csv = buildCsv(
            ["ERP SKU", "Style", "Size", "Color", "Orders", "Customers", "Units", "Gross", "Net", "ASP"],
            rows.map((row) => [
              row.erp_sku ?? "",
              row.style_code ?? "",
              row.size ?? "",
              row.color ?? "",
              row.orders ?? 0,
              row.customers ?? 0,
              row.units ?? 0,
              row.gross ?? 0,
              row.net ?? 0,
              row.asp ?? 0,
            ])
          );
          triggerDownload(`amazon_sku_summary_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
          setToast({ type: "success", message: `Exported ${rows.length} rows` });
          return;
        }

        const rows = await fetchAllSalesBySku();
        const filtered = skuQuery.trim()
          ? rows.filter((row) =>
              [row.erp_sku, row.style_code, row.size, row.color]
                .filter(Boolean)
                .some((value) => value?.toLowerCase().includes(skuQuery.trim().toLowerCase()))
            )
          : rows;
        const sorted = [...filtered].sort((a, b) => {
          if (skuSort === "units_asc") return (a.units ?? 0) - (b.units ?? 0);
          if (skuSort === "units_desc") return (b.units ?? 0) - (a.units ?? 0);
          if (skuSort === "net_asc") return (a.net ?? 0) - (b.net ?? 0);
          if (skuSort === "net_desc") return (b.net ?? 0) - (a.net ?? 0);
          return 0;
        });
        const csv = buildCsv(
          ["Period", "ERP SKU", "Style", "Size", "Color", "Units", "Gross", "Tax", "Net"],
          sorted.map((row) => [
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
        triggerDownload(
          `amazon_sales_by_sku_${skuMode === "weekly" ? "week" : "day"}_${fromDate}_${toDate}.csv`,
          createCsvBlob(csv)
        );
        setToast({ type: "success", message: `Exported ${sorted.length} rows` });
        return;
      }

      if (exportSelection === "geo_current") {
        const rows = await fetchAllSalesByGeo();
        const headers = ["State"];
        if (geoLevel === "city") headers.push("City");
        headers.push("Orders", "Customers", "Units", "Gross");
        if (geoLevel === "city") {
          headers.push("Share %", "Rank in state", "Rank overall");
        } else {
          headers.push("Rank overall");
        }
        const csv = buildCsv(
          headers,
          rows.map((row) => [
            row.state ?? "",
            ...(geoLevel === "city" ? [row.city ?? ""] : []),
            row.orders ?? 0,
            row.customers ?? 0,
            row.units ?? 0,
            row.gross ?? 0,
            ...(geoLevel === "city"
              ? [
                  row.gross_share_within_state === null || row.gross_share_within_state === undefined
                    ? ""
                    : row.gross_share_within_state.toFixed(2),
                  row.rank_within_state ?? "",
                  row.rank_overall ?? "",
                ]
              : [row.rank_overall ?? ""]),
          ])
        );
        triggerDownload(`amazon_sales_by_geo_${geoLevel}_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${rows.length} rows` });
        return;
      }

      if (exportSelection === "customers_new_repeat") {
        const csv = buildCsv(
          ["Metric", "Known", "Estimated"],
          [
            ["Customers", overviewKpis?.customers_known ?? 0, overviewKpis?.customers_estimated ?? 0],
            ["Repeat rate", overviewKpis?.repeat_rate_known ?? 0, overviewKpis?.repeat_rate_estimated ?? 0],
          ]
        );
        triggerDownload(`amazon_customers_summary_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: "Exported 2 rows" });
        return;
      }

      if (exportSelection === "customers_cohorts") {
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
        triggerDownload(`amazon_customer_cohorts_${cohortGrain}_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${rows.length} rows` });
        return;
      }

      if (exportSelection === "returns_top") {
        const csv = buildCsv(
          ["ERP SKU", "Units sold", "Units returned", "Return rate"],
          topReturns.map((row) => [
            row.erp_sku ?? "",
            row.units_sold ?? 0,
            row.units_returned ?? 0,
            row.return_rate ?? 0,
          ])
        );
        triggerDownload(`amazon_returns_top_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${topReturns.length} rows` });
      }
    } catch (exportError) {
      setToast({
        type: "error",
        message: exportError instanceof Error ? exportError.message : "Failed to export CSV.",
      });
    } finally {
      setExportingKey(null);
    }
  }, [
    cohortGrain,
    exportSelection,
    fetchAllCohorts,
    fetchAllSalesByGeo,
    fetchAllSalesBySku,
    fetchAllSkuSummary,
    fromDate,
    geoLevel,
    overviewKpis,
    overviewMappingGaps,
    overviewSlowMovers,
    overviewTopSkus,
    overviewTopStates,
    skuMode,
    skuQuery,
    skuSort,
    toDate,
    topReturns,
    geoStateFilter,
  ]);

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
          marketplaceId,
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
  }, [fromDate, toDate, marketplaceId, handleRefresh, loadReportRuns]);

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
    setSkuPage(0);
  }, [skuMode, skuSort, skuQuery, fromDate, toDate, marketplaceId]);

  useEffect(() => {
    setGeoPage(0);
  }, [geoLevel, fromDate, toDate, marketplaceId]);

  useEffect(() => {
    setGeoPage(0);
  }, [geoStateFilter]);

  useEffect(() => {
    setCohortPage(0);
  }, [cohortGrain, fromDate, toDate, marketplaceId]);

  useEffect(() => {
    if (exportOptions.length === 0) return;
    setExportSelection(exportOptions[0]?.value ?? "");
  }, [exportOptions]);

  useEffect(() => {
    setDrilldownTarget(null);
    setDrilldownSkus([]);
  }, [geoLevel, geoStateFilter, fromDate, toDate, marketplaceId]);

  useEffect(() => {
    if (loading || !fromDate || !toDate) return;
    handleRefresh();
  }, [
    loading,
    fromDate,
    toDate,
    skuMode,
    skuSort,
    skuQuery,
    geoLevel,
    cohortGrain,
    activeTab,
    skuPage,
    geoPage,
    geoStateFilter,
    cohortPage,
    marketplaceId,
    handleRefresh,
  ]);

  useEffect(() => {
    if (activeTab !== "customers") return;
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
          </div>
        </header>

        <section style={stickyFilterStyle}>
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={filtersGridStyle}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#4b5563" }}>
                Marketplace
                <select
                  value={marketplaceId}
                  onChange={(event) => setMarketplaceId(event.target.value)}
                  style={inputStyle}
                >
                  {MARKETPLACE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
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
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 12, color: "#4b5563" }}>Export</span>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <select
                    value={exportSelection}
                    onChange={(event) => setExportSelection(event.target.value)}
                    style={inputStyle}
                  >
                    {exportOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={secondaryButtonStyle}
                    onClick={handleExport}
                    disabled={exportingKey !== null || !fromDate || !toDate}
                  >
                    {exportingKey ? "Exporting…" : "Export CSV"}
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                <span style={{ fontSize: 12, color: "#4b5563" }}>Actions</span>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <button type="button" style={secondaryButtonStyle} onClick={handleRefresh} disabled={isLoadingData}>
                    Refresh
                  </button>
                  <button type="button" style={primaryButtonStyle} onClick={handleSync} disabled={isSyncing}>
                    {isSyncing ? "Syncing analytics…" : "Sync analytics"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error ? <p style={errorStyle}>{error}</p> : null}
          {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

          <div style={statusBannerStyle}>
            {isLoadingData ? "Loading analytics… " : null}
            {lastRun ? (
              <span>
                Last sync: {lastRun.status ?? "unknown"} · {lastRun.requested_at ?? "—"} · rows {lastRun.row_count ?? 0}
              </span>
            ) : (
              <span>No report runs yet. Sync to load analytics facts.</span>
            )}
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              { key: "overview", label: "Overview" },
              { key: "sku", label: "Sales by SKU" },
              { key: "geo", label: "Sales by geography" },
              { key: "customers", label: "Customers" },
              { key: "returns", label: "Returns" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                style={activeTab === tab.key ? primaryButtonStyle : secondaryButtonStyle}
                onClick={() => setActiveTab(tab.key as typeof activeTab)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {activeTab === "overview" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <section style={cardStyle}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {[
                  {
                    label: "Gross sales",
                    value: formatCurrency(overviewKpisV2?.gross_sales ?? null),
                  },
                  {
                    label: "Net sales (estimated)",
                    value: formatCurrency(overviewKpisV2?.net_sales_estimated ?? null),
                    caption: "Estimated (Orders/Returns reports). Fees & payouts in Finance → Settlements.",
                  },
                  {
                    label: "Confirmed orders",
                    value: formatCurrency(overviewKpisV2?.confirmed_orders_value ?? null),
                    secondary: `${formatNumber(overviewKpisV2?.confirmed_orders_count ?? null)} orders`,
                  },
                  {
                    label: "Cancellations",
                    value: formatCurrency(overviewKpisV2?.cancellations_value ?? null),
                    secondary: `${formatNumber(overviewKpisV2?.cancellations_count ?? null)} orders`,
                  },
                  {
                    label: "Returns",
                    value: formatCurrency(overviewKpisV2?.returns_value ?? null),
                    secondary: `${formatNumber(overviewKpisV2?.returns_count ?? null)} orders`,
                  },
                  {
                    label: "Discount",
                    value: formatCurrency(overviewKpisV2?.discount_value ?? null),
                    secondary:
                      overviewKpisV2?.gross_sales &&
                      overviewKpisV2.gross_sales > 0 &&
                      overviewKpisV2.discount_value != null
                        ? `${formatPercent(overviewKpisV2.discount_value / overviewKpisV2.gross_sales)} of gross`
                        : "—",
                  },
                  {
                    label: "Avg per day",
                    value: formatCurrency(overviewKpisV2?.avg_per_day ?? null),
                    secondary:
                      overviewKpisV2?.days_count !== null && overviewKpisV2?.days_count !== undefined
                        ? `${formatNumber(overviewKpisV2?.days_count ?? null)} days`
                        : "—",
                  },
                ].map((tile) => (
                  <div
                    key={tile.label}
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 8,
                      padding: 12,
                      background: "#f9fafb",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{tile.label}</p>
                    <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{tile.value}</p>
                    {tile.secondary ? <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{tile.secondary}</p> : null}
                    {tile.caption ? <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>{tile.caption}</p> : null}
                  </div>
                ))}
              </div>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={cardStyle}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <p style={{ margin: 0, fontWeight: 600 }}>Top SKUs</p>
                  <button type="button" style={secondaryButtonStyle} onClick={() => setActiveTab("sku")}>View all</button>
                </div>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>ERP SKU</th>
                      <th style={tableHeaderCellStyle}>Units</th>
                      <th style={tableHeaderCellStyle}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewTopSkus.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={3}>
                          {isLoadingData ? "Loading top SKUs…" : "No SKU summary data found."}
                        </td>
                      </tr>
                    ) : (
                      overviewTopSkus.map((row, index) => (
                        <tr key={`${row.erp_sku ?? "sku"}-${index}`}>
                          <td style={tableCellStyle}>{row.erp_sku ?? "Unmapped"}</td>
                          <td style={tableCellStyle}>{formatNumber(row.units ?? 0)}</td>
                          <td style={tableCellStyle}>{formatCurrency(row.net ?? 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div style={cardStyle}>
                <p style={{ margin: "0 0 12px", fontWeight: 600 }}>Top states</p>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>State</th>
                      <th style={tableHeaderCellStyle}>Orders</th>
                      <th style={tableHeaderCellStyle}>Gross</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewTopStates.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={3}>
                          {isLoadingData ? "Loading state performance…" : "No geography data found."}
                        </td>
                      </tr>
                    ) : (
                      overviewTopStates.map((row, index) => (
                        <tr key={`${row.geo_key ?? "state"}-${index}`}>
                          <td style={tableCellStyle}>{row.state ?? "Unknown"}</td>
                          <td style={tableCellStyle}>{formatNumber(row.orders ?? 0)}</td>
                          <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
              <div style={cardStyle}>
                <p style={{ margin: "0 0 12px", fontWeight: 600 }}>Watchlist · Slow movers</p>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>ERP SKU</th>
                      <th style={tableHeaderCellStyle}>Units</th>
                      <th style={tableHeaderCellStyle}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewSlowMovers.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={3}>
                          {isLoadingData ? "Loading slow movers…" : "No slow movers found."}
                        </td>
                      </tr>
                    ) : (
                      overviewSlowMovers.map((row, index) => (
                        <tr key={`${row.erp_sku ?? "slow"}-${index}`}>
                          <td style={tableCellStyle}>{row.erp_sku ?? "Unmapped"}</td>
                          <td style={tableCellStyle}>{formatNumber(row.units ?? 0)}</td>
                          <td style={tableCellStyle}>{formatCurrency(row.net ?? 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <div style={cardStyle}>
                <p style={{ margin: "0 0 12px", fontWeight: 600 }}>Watchlist · Mapping gaps</p>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>External SKU</th>
                      <th style={tableHeaderCellStyle}>Units</th>
                      <th style={tableHeaderCellStyle}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overviewMappingGaps.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={3}>
                          {isLoadingData ? "Loading mapping gaps…" : "No mapping gaps found."}
                        </td>
                      </tr>
                    ) : (
                      overviewMappingGaps.map((row, index) => (
                        <tr key={`${row.external_sku ?? "gap"}-${index}`}>
                          <td style={tableCellStyle}>{row.external_sku ?? "Unknown"}</td>
                          <td style={tableCellStyle}>{formatNumber(row.units ?? 0)}</td>
                          <td style={tableCellStyle}>{formatCurrency(row.net ?? 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </section>
        ) : null}

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
                <span style={badgeStyle}>View: {skuMode}</span>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() =>
                    setSkuMode(skuMode === "summary" ? "daily" : skuMode === "daily" ? "weekly" : "summary")
                  }
                >
                  Toggle view
                </button>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#4b5563" }}>
                Sort
                <select
                  value={skuSort}
                  onChange={(event) => setSkuSort(event.target.value as typeof skuSort)}
                  style={inputStyle}
                >
                  <option value="units_desc">Units (high → low)</option>
                  <option value="net_desc">Net (high → low)</option>
                  <option value="units_asc">Units (low → high)</option>
                  <option value="net_asc">Net (low → high)</option>
                </select>
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#4b5563" }}>
                Search
                <input
                  type="text"
                  value={skuQuery}
                  onChange={(event) => setSkuQuery(event.target.value)}
                  placeholder="SKU / style / external"
                  style={inputStyle}
                />
              </label>
            </div>

            {skuMode === "summary" ? (
              <table style={{ ...tableStyle, marginTop: 12 }}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>ERP SKU</th>
                    <th style={tableHeaderCellStyle}>Style</th>
                    <th style={tableHeaderCellStyle}>Size</th>
                    <th style={tableHeaderCellStyle}>Color</th>
                    <th style={tableHeaderCellStyle}>Orders</th>
                    <th style={tableHeaderCellStyle}>Customers</th>
                    <th style={tableHeaderCellStyle}>Units</th>
                    <th style={tableHeaderCellStyle}>Gross</th>
                    <th style={tableHeaderCellStyle}>Net</th>
                    <th style={tableHeaderCellStyle}>ASP</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSkuSummary.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={10}>
                        {isLoadingData ? "Loading summary…" : "No SKU summary data found."}
                      </td>
                    </tr>
                  ) : (
                    pagedSkuSummary.map((row, index) => (
                      <tr key={`${row.erp_sku ?? "sku"}-${index}`}>
                        <td style={tableCellStyle}>{row.erp_sku ?? "Unmapped"}</td>
                        <td style={tableCellStyle}>{row.style_code ?? "—"}</td>
                        <td style={tableCellStyle}>{row.size ?? "—"}</td>
                        <td style={tableCellStyle}>{row.color ?? "—"}</td>
                        <td style={tableCellStyle}>{formatNumber(row.orders ?? 0)}</td>
                        <td style={tableCellStyle}>{formatNumber(row.customers ?? 0)}</td>
                        <td style={tableCellStyle}>{formatNumber(row.units ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.net ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.asp ?? 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            ) : (
              <table style={{ ...tableStyle, marginTop: 12 }}>
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
                  {filteredSkuRows.length === 0 ? (
                    <tr>
                      <td style={tableCellStyle} colSpan={9}>
                        {isLoadingData ? "Loading sales…" : "No sales data found."}
                      </td>
                    </tr>
                  ) : (
                    filteredSkuRows.map((row, index) => (
                      <tr key={`${row.erp_sku ?? "sku"}-${row.grain_start ?? index}`}>
                        <td style={tableCellStyle}>{row.grain_start ?? "—"}</td>
                        <td style={tableCellStyle}>{row.erp_sku ?? "Unmapped"}</td>
                        <td style={tableCellStyle}>{row.style_code ?? "—"}</td>
                        <td style={tableCellStyle}>{row.size ?? "—"}</td>
                        <td style={tableCellStyle}>{row.color ?? "—"}</td>
                        <td style={tableCellStyle}>{formatNumber(row.units ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.tax ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.net ?? 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setSkuPage((prev) => Math.max(prev - 1, 0))}
                disabled={skuPage === 0 || isLoadingData}
              >
                Previous
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setSkuPage((prev) => prev + 1)}
                disabled={
                  isLoadingData ||
                  (skuMode === "summary" ? pagedSkuSummary.length < pageSize : filteredSkuRows.length < pageSize)
                }
              >
                Next
              </button>
            </div>
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
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    style={geoLevel === "state" ? primaryButtonStyle : secondaryButtonStyle}
                    onClick={() => {
                      setGeoLevel("state");
                      setGeoStateFilter(null);
                    }}
                  >
                    State
                  </button>
                  <button
                    type="button"
                    style={geoLevel === "city" ? primaryButtonStyle : secondaryButtonStyle}
                    onClick={() => {
                      setGeoLevel("city");
                    }}
                  >
                    City
                  </button>
                </div>
              </div>
            </div>
            {geoLevel === "city" && geoStateFilter ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>India &gt; {geoStateFilter}</p>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => {
                    setGeoLevel("state");
                    setGeoStateFilter(null);
                  }}
                >
                  Back to States
                </button>
              </div>
            ) : null}
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>State</th>
                  {geoLevel === "city" ? <th style={tableHeaderCellStyle}>City</th> : null}
                  <th style={tableHeaderCellStyle}>Orders</th>
                  <th style={tableHeaderCellStyle}>Customers</th>
                  <th style={tableHeaderCellStyle}>Units</th>
                  <th style={tableHeaderCellStyle}>Gross</th>
                  {geoLevel === "city" ? (
                    <>
                      <th style={tableHeaderCellStyle}>Share %</th>
                      <th style={tableHeaderCellStyle}>Rank in state</th>
                      <th style={tableHeaderCellStyle}>Rank overall</th>
                    </>
                  ) : (
                    <th style={tableHeaderCellStyle}>Rank overall</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {salesByGeo.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={geoLevel === "city" ? 9 : 6}>
                      {isLoadingData ? "Loading geo data…" : "No geography data found."}
                    </td>
                  </tr>
                ) : (
                  salesByGeo.map((row, index) => {
                    const state = row.state ?? "Unknown";
                    const city = row.city ?? "Unknown";
                    const isSelected =
                      drilldownTarget &&
                      drilldownTarget.state === state &&
                      (geoLevel === "state" || drilldownTarget.city === city);
                    return (
                      <tr
                        key={`${row.geo_key ?? "geo"}-${index}`}
                        onClick={() => {
                          if (geoLevel === "state") {
                            setGeoLevel("city");
                            setGeoStateFilter(state);
                            setGeoPage(0);
                            return;
                          }
                          const target = { state, city: geoLevel === "city" ? city : undefined };
                          setDrilldownTarget(target);
                          loadTopSkusByGeo(target);
                        }}
                        style={{
                          cursor: "pointer",
                          background: isSelected ? "#f1f5f9" : undefined,
                        }}
                      >
                        <td style={tableCellStyle}>{state}</td>
                        {geoLevel === "city" ? <td style={tableCellStyle}>{city}</td> : null}
                        <td style={tableCellStyle}>{formatNumber(row.orders ?? 0)}</td>
                        <td style={tableCellStyle}>{formatNumber(row.customers ?? 0)}</td>
                        <td style={tableCellStyle}>{formatNumber(row.units ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                        {geoLevel === "city" ? (
                          <>
                            <td style={tableCellStyle}>{formatSharePercent(row.gross_share_within_state ?? null)}</td>
                            <td style={tableCellStyle}>{formatNumber(row.rank_within_state ?? null)}</td>
                            <td style={tableCellStyle}>{formatNumber(row.rank_overall ?? null)}</td>
                          </>
                        ) : (
                          <td style={tableCellStyle}>{formatNumber(row.rank_overall ?? null)}</td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setGeoPage((prev) => Math.max(prev - 1, 0))}
                disabled={geoPage === 0 || isLoadingData}
              >
                Previous
              </button>
              <button
                type="button"
                style={secondaryButtonStyle}
                onClick={() => setGeoPage((prev) => prev + 1)}
                disabled={isLoadingData || !geoHasNextPage}
              >
                Next
              </button>
            </div>

            {drilldownTarget ? (
              <div style={{ marginTop: 16 }}>
                <p style={{ margin: "0 0 8px", fontWeight: 600 }}>
                  Top SKUs in {drilldownTarget.state}
                  {drilldownTarget.city ? ` / ${drilldownTarget.city}` : ""}
                </p>
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>ERP SKU</th>
                      <th style={tableHeaderCellStyle}>Orders</th>
                      <th style={tableHeaderCellStyle}>Customers</th>
                      <th style={tableHeaderCellStyle}>Units</th>
                      <th style={tableHeaderCellStyle}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drilldownSkus.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={5}>
                          {isLoadingDrilldown ? "Loading drilldown…" : "No SKU drilldown data found."}
                        </td>
                      </tr>
                    ) : (
                      drilldownSkus.map((row, index) => (
                        <tr key={`${row.erp_sku ?? "drill"}-${index}`}>
                          <td style={tableCellStyle}>{row.erp_sku ?? "Unmapped"}</td>
                          <td style={tableCellStyle}>{formatNumber(row.orders ?? 0)}</td>
                          <td style={tableCellStyle}>{formatNumber(row.customers ?? 0)}</td>
                          <td style={tableCellStyle}>{formatNumber(row.units ?? 0)}</td>
                          <td style={tableCellStyle}>{formatCurrency(row.net ?? 0)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}

        {activeTab === "customers" ? (
          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <section style={cardStyle}>
              <p style={{ margin: "0 0 12px", fontWeight: 600 }}>New vs repeat customers</p>
              <table style={tableStyle}>
                <thead>
                  <tr>
                    <th style={tableHeaderCellStyle}>Metric</th>
                    <th style={tableHeaderCellStyle}>Known</th>
                    <th style={tableHeaderCellStyle}>Estimated</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={tableCellStyle}>Customers</td>
                    <td style={tableCellStyle}>{formatNumber(overviewKpis?.customers_known ?? null)}</td>
                    <td style={tableCellStyle}>{formatNumber(overviewKpis?.customers_estimated ?? null)}</td>
                  </tr>
                  <tr>
                    <td style={tableCellStyle}>Repeat rate</td>
                    <td style={tableCellStyle}>{formatPercent(overviewKpis?.repeat_rate_known ?? null)}</td>
                    <td style={tableCellStyle}>{formatPercent(overviewKpis?.repeat_rate_estimated ?? null)}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section style={cardStyle}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
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
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
                <span style={badgeStyle}>Total customers: {repeatSummary.totalCustomers}</span>
                <span style={badgeStyle}>Repeat customers: {repeatSummary.repeatCustomers}</span>
                <span style={badgeStyle}>Repeat rate: {formatPercent(repeatSummary.repeatRate)}</span>
              </div>
              {cohorts.length === 0 && cohortEmailStats ? (
                <div style={warningBannerStyle}>
                  Cohorts are empty. Buyer email is missing on {formatPercent(cohortEmailStats.missing_email_ratio ?? 0)} of
                  rows, so cohort attribution may be limited.
                </div>
              ) : null}
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
                        {isLoadingData ? "Loading cohorts…" : "No cohort data found (buyer email may be missing)."}
                      </td>
                    </tr>
                  ) : (
                    cohorts.map((row, index) => (
                      <tr key={`${row.cohort_start ?? "cohort"}-${row.period_index ?? index}`}>
                        <td style={tableCellStyle}>{row.cohort_start ?? "—"}</td>
                        <td style={tableCellStyle}>{row.period_index ?? 0}</td>
                        <td style={tableCellStyle}>{formatNumber(row.customers ?? 0)}</td>
                        <td style={tableCellStyle}>{formatNumber(row.repeat_customers ?? 0)}</td>
                        <td style={tableCellStyle}>{formatNumber(row.orders ?? 0)}</td>
                        <td style={tableCellStyle}>{formatCurrency(row.gross ?? 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setCohortPage((prev) => Math.max(prev - 1, 0))}
                  disabled={cohortPage === 0 || isLoadingData}
                >
                  Previous
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setCohortPage((prev) => prev + 1)}
                  disabled={isLoadingData || cohorts.length < pageSize}
                >
                  Next
                </button>
              </div>
            </section>
          </section>
        ) : null}

        {activeTab === "returns" ? (
          <section style={cardStyle}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>Returns & refunds</p>
              <span style={badgeStyle}>Top returned SKUs</span>
            </div>
            {!hasReturns ? (
              <p style={mutedStyle}>No return data yet.</p>
            ) : (
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
                        <td style={tableCellStyle}>{formatNumber(row.units_sold ?? 0)}</td>
                        <td style={tableCellStyle}>{formatNumber(row.units_returned ?? 0)}</td>
                        <td style={tableCellStyle}>{formatPercent(row.return_rate ?? 0)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
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
