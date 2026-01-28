import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/router";
import { z } from "zod";
import ErpShell from "../../../../components/erp/ErpShell";
import ErpTooltip from "../../../../components/erp/ErpTooltip";
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

type ChannelAccount = {
  id: string;
  channel_key: string;
  name: string;
  is_active: boolean;
};

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

const shopifyOverviewSchema = z.object({
  gross_sales: z.number().nullable(),
  confirmed_orders_count: z.number().nullable(),
  cancellations_count: z.number().nullable(),
  returns_count: z.number().nullable(),
  discounts: z.number().nullable(),
  net_sales_estimated: z.number().nullable(),
  avg_per_day: z.number().nullable(),
  days_count: z.number().nullable(),
});

const financialOverviewSchema = z.object({
  settlement_gross_sales: z.number().nullable(),
  settlement_refunds_returns: z.number().nullable(),
  settlement_fees: z.number().nullable(),
  settlement_withholdings: z.number().nullable(),
  settlement_net_payout: z.number().nullable(),
  currency: z.string().nullable(),
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

const returnsSummarySchema = z.object({
  returns_orders_count: z.number().nullable(),
  returns_units: z.number().nullable(),
  returns_value_estimated: z.number().nullable(),
});

const returnsRowSchema = z.object({
  id: z.string(),
  return_date: z.string().nullable(),
  source: z.string().nullable(),
  amazon_order_id: z.string().nullable(),
  rma_id: z.string().nullable(),
  asin: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().nullable(),
  reason: z.string().nullable(),
  disposition: z.string().nullable(),
  status: z.string().nullable(),
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

const overviewTooltipText = {
  grossSalesOperational:
    "Gross Sales (Operational) = Sum of item gross for CONFIRMED (non-cancelled) orders.\nSource: Orders Report (Reports API).\nNote: Cancelled orders are excluded at source.",
  confirmedOrders:
    "Confirmed Orders = Orders that were placed and NOT cancelled.\nValue equals Operational Gross Sales.",
  cancellations:
    "Cancellations = Orders cancelled before confirmation.\nShown as COUNT only.\nMoney impact is handled in Finance via settlements.",
  returnsOperational:
    "Returns (Operational) = Returns from returns reports (FBA + MFN).\nReturns Value is ESTIMATED by matching return quantity to original order gross proportionally.\nFinancial truth is in settlements.",
  discounts:
    "Discounts = Promotional reductions applied to confirmed orders.\nSource: Orders report discount/promotion fields.",
  netSalesEstimated:
    "Net Sales (Estimated) = Confirmed Sales − Estimated Returns Value − Discounts.\nCancelled orders are NOT subtracted here (they were never part of confirmed sales).\nThis is operational/estimated, not payout truth.",
  avgPerDay: "Avg per Day = Net Sales (Estimated) ÷ number of days in selected range.",
  refundsSettlement:
    "Refunds/Returns (Settlement) = Actual refunded amounts recorded in Amazon settlements.\nThis is financial truth.",
  amazonFees: "Amazon Fees = Fees/charges recorded in settlements (referral, fulfillment, storage, etc.).",
  withholdings: "Withholdings = Reserves/holds recorded in settlements.",
  netPayout:
    "Net Payout = Amount deposited to bank.\nSource: Settlements.\nThis is the single source of truth for actual net.",
};

function formatDateInput(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatDateLabel(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 10);
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

function formatCurrencyWithCode(value: number | null, currency: string | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (!currency) return formatCurrency(value);
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch (error) {
    return `${currency} ${value.toFixed(2)}`;
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
  const marketplaceId = DEFAULT_MARKETPLACE_ID;
  const [channelAccounts, setChannelAccounts] = useState<ChannelAccount[]>([]);
  const [channelAccountId, setChannelAccountId] = useState<string | null>(null);
  const [isLoadingChannels, setIsLoadingChannels] = useState(true);
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
  const [returnsSummary, setReturnsSummary] = useState<z.infer<typeof returnsSummarySchema> | null>(null);
  const [returnRows, setReturnRows] = useState<z.infer<typeof returnsRowSchema>[]>([]);
  const [returnsPage, setReturnsPage] = useState(0);
  const [overviewKpis, setOverviewKpis] = useState<z.infer<typeof overviewKpiSchema> | null>(null);
  const [overviewKpisV2, setOverviewKpisV2] = useState<z.infer<typeof overviewKpiV2Schema> | null>(null);
  const [financialOverview, setFinancialOverview] = useState<z.infer<typeof financialOverviewSchema> | null>(null);
  const [overviewTopSkus, setOverviewTopSkus] = useState<z.infer<typeof skuSummarySchema>[]>([]);
  const [overviewTopStates, setOverviewTopStates] = useState<z.infer<typeof salesByGeoSchema>[]>([]);
  const [overviewSlowMovers, setOverviewSlowMovers] = useState<z.infer<typeof skuSummarySchema>[]>([]);
  const [overviewMappingGaps, setOverviewMappingGaps] = useState<z.infer<typeof unmappedSkuSchema>[]>([]);
  const [hasReturns, setHasReturns] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isLoadingDrilldown, setIsLoadingDrilldown] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingReturns, setIsSyncingReturns] = useState(false);
  const [lastRun, setLastRun] = useState<z.infer<typeof reportRunSchema> | null>(null);
  const [exportSelection, setExportSelection] = useState<string>("");
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [cohortEmailStats, setCohortEmailStats] =
    useState<z.infer<typeof cohortEmailStatsSchema> | null>(null);
  const [skuPage, setSkuPage] = useState(0);
  const [geoPage, setGeoPage] = useState(0);
  const [cohortPage, setCohortPage] = useState(0);
  const [overviewView, setOverviewView] = useState<"analytics" | "financial" | "side-by-side">("side-by-side");
  const [isNarrowScreen, setIsNarrowScreen] = useState(false);

  const selectedChannelAccount = useMemo(
    () => channelAccounts.find((account) => account.id === channelAccountId) ?? null,
    [channelAccounts, channelAccountId]
  );
  const selectedChannelKey = selectedChannelAccount?.channel_key ?? null;
  const isAmazonChannel = selectedChannelKey === "amazon_in";
  const isShopifyChannel = selectedChannelKey === "shopify";
  const isUnsupportedChannel = Boolean(selectedChannelKey && !isAmazonChannel && !isShopifyChannel);
  const reportChannelKey = isAmazonChannel ? "amazon" : isShopifyChannel ? "shopify" : null;
  const reportMarketplaceId = isAmazonChannel ? marketplaceId : channelAccountId ?? null;
  const exportPrefix = isAmazonChannel ? "amazon" : isShopifyChannel ? "shopify" : "channel";
  const availableTabs = useMemo(() => {
    const tabs = [
      { key: "overview", label: "Overview" },
      { key: "sku", label: "Sales by SKU" },
      { key: "geo", label: "Sales by geography" },
      { key: "customers", label: "Customers" },
    ];
    if (isAmazonChannel) {
      tabs.push({ key: "returns", label: "Returns" });
    }
    return tabs;
  }, [isAmazonChannel]);

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

    return [{ value: "returns_rows", label: "Returns · Return rows" }];
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

  const overviewViewOptions = useMemo(() => {
    if (!isAmazonChannel) {
      return [{ key: "analytics", label: "Analytics (Estimated)" }];
    }

    return isNarrowScreen
      ? [
          { key: "analytics", label: "Analytics (Estimated)" },
          { key: "financial", label: "Financial (Settlement)" },
        ]
      : [
          { key: "analytics", label: "Analytics (Estimated)" },
          { key: "financial", label: "Financial (Settlement)" },
          { key: "side-by-side", label: "Side-by-side" },
        ];
  }, [isAmazonChannel, isNarrowScreen]);

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
    if (!reportChannelKey || !reportMarketplaceId) return;
    const { data, error: rpcError } = await supabase.rpc("erp_channel_report_runs_list", {
      p_channel_key: reportChannelKey,
      p_marketplace_id: reportMarketplaceId,
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
  }, [reportChannelKey, reportMarketplaceId]);

  const loadOverviewKpis = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!isAmazonChannel) {
      setOverviewKpis(null);
      return;
    }
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
  }, [fromDate, toDate, marketplaceId, isAmazonChannel]);

  const loadOverviewKpisV2 = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (isShopifyChannel) {
      if (!channelAccountId) return;
      const { data, error: rpcError } = await supabase.rpc("erp_shopify_analytics_overview_v1", {
        p_from: fromDate,
        p_to: toDate,
        p_channel_account_id: channelAccountId,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const parsed = z.array(shopifyOverviewSchema).safeParse(data ?? []);
      if (!parsed.success) {
        throw new Error("Unable to parse Shopify overview response.");
      }

      const overview = parsed.data[0] ?? null;
      setOverviewKpisV2(
        overview
          ? {
              gross_sales: overview.gross_sales ?? null,
              net_sales_estimated: overview.net_sales_estimated ?? null,
              confirmed_orders_count: overview.confirmed_orders_count ?? null,
              confirmed_orders_value: overview.net_sales_estimated ?? null,
              cancellations_count: overview.cancellations_count ?? 0,
              cancellations_value: 0,
              returns_count: overview.returns_count ?? 0,
              returns_value: 0,
              discount_value: overview.discounts ?? null,
              avg_per_day: overview.avg_per_day ?? null,
              days_count: overview.days_count ?? null,
            }
          : null
      );
      return;
    }

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, toDate]);

  const loadFinancialOverview = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!isAmazonChannel) {
      setFinancialOverview(null);
      return;
    }
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_financial_overview_v1", {
      p_from: fromDate,
      p_to: toDate,
      p_marketplace: marketplaceId,
      p_channel_account_id: null,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(financialOverviewSchema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse financial overview response.");
    }

    setFinancialOverview(parsed.data[0] ?? null);
  }, [fromDate, toDate, marketplaceId, isAmazonChannel]);

  const loadOverviewTopSkus = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (isShopifyChannel) {
      if (!channelAccountId) return;
      const { data, error: rpcError } = await supabase.rpc("erp_shopify_analytics_sku_summary_v1", {
        p_channel_account_id: channelAccountId,
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
        throw new Error("Unable to parse Shopify top SKU response.");
      }

      setOverviewTopSkus(parsed.data);
      return;
    }

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, toDate]);

  const loadOverviewSlowMovers = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (isShopifyChannel) {
      if (!channelAccountId) return;
      const { data, error: rpcError } = await supabase.rpc("erp_shopify_analytics_sku_summary_v1", {
        p_channel_account_id: channelAccountId,
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
        throw new Error("Unable to parse Shopify slow mover response.");
      }

      setOverviewSlowMovers(parsed.data.filter((row) => (row.units ?? 0) > 0));
      return;
    }

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, toDate]);

  const loadOverviewTopStates = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (isShopifyChannel) {
      if (!channelAccountId) return;
      const { data, error: rpcError } = await supabase.rpc("erp_shopify_analytics_sales_by_geo_v1", {
        p_channel_account_id: channelAccountId,
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
        throw new Error("Unable to parse Shopify top state response.");
      }

      setOverviewTopStates(parsed.data);
      return;
    }

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, toDate]);

  const loadOverviewMappingGaps = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!isAmazonChannel) {
      setOverviewMappingGaps([]);
      return;
    }
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
  }, [fromDate, toDate, marketplaceId, isAmazonChannel]);

  const loadOverview = useCallback(async () => {
    setIsLoadingData(true);
    try {
      await Promise.all([
        loadOverviewKpisV2(),
        loadFinancialOverview(),
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
    loadFinancialOverview,
    loadOverviewMappingGaps,
    loadOverviewSlowMovers,
    loadOverviewTopSkus,
    loadOverviewTopStates,
  ]);

  const loadSkuSummary = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    if (isShopifyChannel) {
      if (!channelAccountId) return;
      const { data, error: rpcError } = await supabase.rpc("erp_shopify_analytics_sku_summary_v1", {
        p_channel_account_id: channelAccountId,
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
        setError("Unable to parse Shopify SKU summary response.");
        setIsLoadingData(false);
        return;
      }

      setSkuSummary(parsed.data);
      setIsLoadingData(false);
      return;
    }

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, skuPage, skuQuery, skuSort, toDate]);

  const loadSalesBySku = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    if (isShopifyChannel) {
      if (!channelAccountId) return;
      const { data, error: rpcError } = await supabase.rpc("erp_shopify_analytics_sales_by_sku_v1", {
        p_channel_account_id: channelAccountId,
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
        setError("Unable to parse Shopify sales by SKU response.");
        setIsLoadingData(false);
        return;
      }

      setSalesBySku(parsed.data);
      setIsLoadingData(false);
      return;
    }

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, skuMode, skuPage, toDate]);

  const fetchAllSalesByGeo = useCallback(async () => {
    if (isShopifyChannel && !channelAccountId) return [];
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof salesByGeoSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc(
        isShopifyChannel ? "erp_shopify_analytics_sales_by_geo_v1" : "erp_amazon_analytics_sales_by_geo_v2",
        isShopifyChannel
          ? {
              p_channel_account_id: channelAccountId,
              p_from: fromDate,
              p_to: toDate,
              p_level: geoLevel,
              p_state: geoLevel === "city" ? geoStateFilter : null,
              p_limit: limit,
              p_offset: offset,
            }
          : {
              p_marketplace_id: marketplaceId,
              p_from: fromDate,
              p_to: toDate,
              p_level: geoLevel,
              p_state: geoLevel === "city" ? geoStateFilter : null,
              p_limit: limit,
              p_offset: offset,
            }
      );

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
  }, [channelAccountId, fromDate, geoLevel, geoStateFilter, isShopifyChannel, marketplaceId, toDate]);

  const loadSalesByGeo = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (isShopifyChannel && !channelAccountId) return;
    setIsLoadingData(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        isShopifyChannel ? "erp_shopify_analytics_sales_by_geo_v1" : "erp_amazon_analytics_sales_by_geo_v2",
        isShopifyChannel
          ? {
              p_channel_account_id: channelAccountId,
              p_from: fromDate,
              p_to: toDate,
              p_level: geoLevel,
              p_state: geoLevel === "city" ? geoStateFilter : null,
              p_limit: pageSize,
              p_offset: geoPage * pageSize,
            }
          : {
              p_marketplace_id: marketplaceId,
              p_from: fromDate,
              p_to: toDate,
              p_level: geoLevel,
              p_state: geoLevel === "city" ? geoStateFilter : null,
              p_limit: pageSize,
              p_offset: geoPage * pageSize,
            }
      );

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
  }, [channelAccountId, fromDate, geoLevel, geoPage, geoStateFilter, isShopifyChannel, marketplaceId, toDate]);

  const loadTopSkusByGeo = useCallback(
    async (target: { state: string; city?: string }) => {
      if (!fromDate || !toDate) return;
      if (!isAmazonChannel) return;
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
    [fromDate, toDate, marketplaceId, geoLevel, isAmazonChannel]
  );

  const loadCohorts = useCallback(async () => {
    if (!fromDate || !toDate) return;
    setIsLoadingData(true);
    if (isShopifyChannel) {
      if (!channelAccountId) return;
      const { data, error: rpcError } = await supabase.rpc("erp_shopify_analytics_customers_v1", {
        p_channel_account_id: channelAccountId,
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
        setError("Unable to parse Shopify customer cohort response.");
        setIsLoadingData(false);
        return;
      }

      setCohorts(parsed.data);
      setIsLoadingData(false);
      return;
    }

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
  }, [channelAccountId, cohortGrain, cohortPage, fromDate, isShopifyChannel, marketplaceId, toDate]);

  const loadCohortEmailStats = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!isAmazonChannel) {
      setCohortEmailStats(null);
      return;
    }
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
  }, [fromDate, toDate, marketplaceId, isAmazonChannel]);

  const fetchAllSkuSummary = useCallback(async () => {
    if (isShopifyChannel && !channelAccountId) return [];
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof skuSummarySchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc(
        isShopifyChannel ? "erp_shopify_analytics_sku_summary_v1" : "erp_amazon_analytics_sku_summary",
        isShopifyChannel
          ? {
              p_channel_account_id: channelAccountId,
              p_from: fromDate,
              p_to: toDate,
              p_sort: skuSort,
              p_q: skuQuery.trim() === "" ? null : skuQuery.trim(),
              p_limit: limit,
              p_offset: offset,
            }
          : {
              p_marketplace_id: marketplaceId,
              p_from: fromDate,
              p_to: toDate,
              p_sort: skuSort,
              p_q: skuQuery.trim() === "" ? null : skuQuery.trim(),
              p_limit: limit,
              p_offset: offset,
            }
      );

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, skuQuery, skuSort, toDate]);

  const fetchAllSalesBySku = useCallback(async () => {
    if (isShopifyChannel && !channelAccountId) return [];
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof salesBySkuSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc(
        isShopifyChannel ? "erp_shopify_analytics_sales_by_sku_v1" : "erp_amazon_analytics_sales_by_sku",
        isShopifyChannel
          ? {
              p_channel_account_id: channelAccountId,
              p_from: fromDate,
              p_to: toDate,
              p_grain: skuMode === "weekly" ? "week" : "day",
              p_limit: limit,
              p_offset: offset,
            }
          : {
              p_marketplace_id: marketplaceId,
              p_from: fromDate,
              p_to: toDate,
              p_grain: skuMode === "weekly" ? "week" : "day",
              p_limit: limit,
              p_offset: offset,
            }
      );

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
  }, [channelAccountId, fromDate, isShopifyChannel, marketplaceId, skuMode, toDate]);

  const fetchAllCohorts = useCallback(async () => {
    if (isShopifyChannel && !channelAccountId) return [];
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof cohortSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc(
        isShopifyChannel ? "erp_shopify_analytics_customers_v1" : "erp_amazon_analytics_customer_cohorts_page",
        isShopifyChannel
          ? {
              p_channel_account_id: channelAccountId,
              p_from: fromDate,
              p_to: toDate,
              p_cohort_grain: cohortGrain,
              p_limit: limit,
              p_offset: offset,
            }
          : {
              p_marketplace_id: marketplaceId,
              p_from: fromDate,
              p_to: toDate,
              p_cohort_grain: cohortGrain,
              p_limit: limit,
              p_offset: offset,
            }
      );

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
  }, [channelAccountId, cohortGrain, fromDate, isShopifyChannel, marketplaceId, toDate]);

  const fetchAllReturns = useCallback(async () => {
    if (!fromDate || !toDate) return [];
    if (!isAmazonChannel) return [];
    const limit = 500;
    let offset = 0;
    const rows: z.infer<typeof returnsRowSchema>[] = [];

    while (true) {
      const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_returns_page", {
        p_marketplace: marketplaceId,
        p_from: fromDate,
        p_to: toDate,
        p_limit: limit,
        p_offset: offset,
      });

      if (rpcError) {
        throw new Error(rpcError.message);
      }

      const parsed = z.array(returnsRowSchema).safeParse(data ?? []);
      if (!parsed.success) {
        throw new Error("Unable to parse returns rows response.");
      }

      if (parsed.data.length === 0) break;
      rows.push(...parsed.data);
      offset += limit;
    }

    return rows;
  }, [fromDate, toDate, marketplaceId]);

  const loadReturnsAvailability = useCallback(async () => {
    if (!isAmazonChannel) {
      setHasReturns(false);
      return;
    }
    const { count, error: countError } = await supabase
      .from("erp_amazon_return_facts")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_id", marketplaceId);

    if (countError) {
      setError(countError.message);
      return;
    }

    setHasReturns((count ?? 0) > 0);
  }, [marketplaceId, isAmazonChannel]);

  const loadReturnsSummary = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!isAmazonChannel) {
      setReturnsSummary(null);
      return;
    }
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_returns_summary", {
      p_marketplace: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_channel_account_id: null,
    });

    if (rpcError) {
      throw new Error(rpcError.message);
    }

    const parsed = z.array(returnsSummarySchema).safeParse(data ?? []);
    if (!parsed.success) {
      throw new Error("Unable to parse returns summary response.");
    }

    setReturnsSummary(parsed.data[0] ?? null);
  }, [fromDate, toDate, marketplaceId, isAmazonChannel]);

  const loadReturnsRows = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!isAmazonChannel) {
      setReturnRows([]);
      return;
    }
    setIsLoadingData(true);
    const { data, error: rpcError } = await supabase.rpc("erp_amazon_analytics_returns_page", {
      p_marketplace: marketplaceId,
      p_from: fromDate,
      p_to: toDate,
      p_limit: pageSize,
      p_offset: returnsPage * pageSize,
    });

    if (rpcError) {
      setError(rpcError.message);
      setIsLoadingData(false);
      return;
    }

    const parsed = z.array(returnsRowSchema).safeParse(data ?? []);
    if (!parsed.success) {
      setError("Unable to parse returns response.");
      setIsLoadingData(false);
      return;
    }

    setReturnRows(parsed.data);
    setIsLoadingData(false);
  }, [fromDate, toDate, marketplaceId, returnsPage, isAmazonChannel]);

  const handleRefresh = useCallback(async () => {
    setError(null);
    if (isUnsupportedChannel || !selectedChannelKey) return;
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
      await loadReturnsSummary();
      await loadReturnsRows();
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
    loadReturnsSummary,
    loadReturnsRows,
    skuMode,
    isUnsupportedChannel,
    selectedChannelKey,
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
        triggerDownload(`${exportPrefix}_overview_top_skus_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${overviewTopSkus.length} rows` });
        return;
      }

      if (exportSelection === "overview_top_states") {
        const csv = buildCsv(
          ["State", "Orders", "Customers", "Units", "Gross"],
          overviewTopStates.map((row) => [row.state ?? "", row.orders ?? 0, row.customers ?? 0, row.units ?? 0, row.gross ?? 0])
        );
        triggerDownload(`${exportPrefix}_overview_top_states_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
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
        triggerDownload(`${exportPrefix}_overview_slow_movers_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
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
        triggerDownload(`${exportPrefix}_overview_mapping_gaps_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
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
        triggerDownload(`${exportPrefix}_sku_summary_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
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
          `${exportPrefix}_sales_by_sku_${skuMode === "weekly" ? "week" : "day"}_${fromDate}_${toDate}.csv`,
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
        triggerDownload(`${exportPrefix}_sales_by_geo_${geoLevel}_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${rows.length} rows` });
        return;
      }

      if (exportSelection === "customers_new_repeat") {
        const csv = isShopifyChannel
          ? buildCsv(
              ["Metric", "Value"],
              [
                ["Total customers", repeatSummary.totalCustomers],
                ["Repeat customers", repeatSummary.repeatCustomers],
                ["Repeat rate", repeatSummary.repeatRate],
              ]
            )
          : buildCsv(
              ["Metric", "Known", "Estimated"],
              [
                ["Customers", overviewKpis?.customers_known ?? 0, overviewKpis?.customers_estimated ?? 0],
                ["Repeat rate", overviewKpis?.repeat_rate_known ?? 0, overviewKpis?.repeat_rate_estimated ?? 0],
              ]
            );
        triggerDownload(`${exportPrefix}_customers_summary_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
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
        triggerDownload(`${exportPrefix}_customer_cohorts_${cohortGrain}_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${rows.length} rows` });
        return;
      }

      if (exportSelection === "returns_rows") {
        const rows = await fetchAllReturns();
        const csv = buildCsv(
          ["Return date", "Source", "Order ID", "RMA ID", "SKU", "ASIN", "Quantity", "Reason", "Disposition", "Status"],
          rows.map((row) => [
            formatDateLabel(row.return_date ?? null),
            row.source ?? "",
            row.amazon_order_id ?? "",
            row.rma_id ?? "",
            row.sku ?? "",
            row.asin ?? "",
            row.quantity ?? 0,
            row.reason ?? "",
            row.disposition ?? "",
            row.status ?? "",
          ])
        );
        triggerDownload(`${exportPrefix}_returns_${fromDate}_${toDate}.csv`, createCsvBlob(csv));
        setToast({ type: "success", message: `Exported ${rows.length} rows` });
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
    fetchAllReturns,
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
    geoStateFilter,
  ]);

  const handleSync = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (isUnsupportedChannel || !selectedChannelKey) return;
    setIsSyncing(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setError("No active session found to sync analytics.");
        return;
      }

      const response = await fetch(
        isShopifyChannel
          ? `/api/analytics/shopify/sync-run?start=${fromDate}&end=${toDate}&channel_account_id=${channelAccountId ?? ""}`
          : "/api/integrations/amazon/analytics/reports-sync",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: isShopifyChannel
            ? undefined
            : JSON.stringify({
                marketplaceId,
                from: fromDate,
                to: toDate,
              }),
        }
      );

      const payload = (await response.json()) as AnalyticsSyncResponse;
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
  }, [
    channelAccountId,
    fromDate,
    handleRefresh,
    isShopifyChannel,
    isUnsupportedChannel,
    loadReportRuns,
    marketplaceId,
    selectedChannelKey,
    toDate,
  ]);

  const handleReturnsSync = useCallback(async () => {
    if (!fromDate || !toDate) return;
    if (!isAmazonChannel) return;
    setIsSyncingReturns(true);
    setError(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        setError("No active session found to sync returns.");
        return;
      }

      const response = await fetch("/api/analytics/amazon/returns-sync-run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          marketplaceId,
          start: fromDate,
          end: toDate,
          mode: "all",
        }),
      });

      const payload = (await response.json()) as ReturnsSyncResponse;
      if (!response.ok || !payload.ok) {
        setError(payload.ok ? "Failed to sync returns report." : payload.error);
        return;
      }

      await loadReportRuns();
      await loadReturnsAvailability();
      await handleRefresh();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Failed to sync returns report.");
    } finally {
      setIsSyncingReturns(false);
    }
  }, [fromDate, toDate, marketplaceId, handleRefresh, loadReportRuns, loadReturnsAvailability, isAmazonChannel]);

  useEffect(() => {
    let active = true;

    (async () => {
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const context = await getCompanyContext(session);
      if (!active) return;

      if (!context.companyId) {
        setError(context.membershipError || "No active company membership found.");
        setIsLoadingChannels(false);
        setLoading(false);
        return;
      }

      const { data, error: channelError } = await supabase.rpc("erp_channel_account_list");
      if (!active) return;

      if (channelError) {
        setError(channelError.message);
        setIsLoadingChannels(false);
        setLoading(false);
        return;
      }

      setChannelAccounts((data ?? []) as ChannelAccount[]);
      setIsLoadingChannels(false);
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
    setOverviewKpis(null);
    setOverviewKpisV2(null);
    setFinancialOverview(null);
    setOverviewTopSkus([]);
    setOverviewTopStates([]);
    setOverviewSlowMovers([]);
    setOverviewMappingGaps([]);
    setSalesBySku([]);
    setSkuSummary([]);
    setSalesByGeo([]);
    setCohorts([]);
    setReturnsSummary(null);
    setReturnRows([]);
    setHasReturns(false);
    setLastRun(null);
    setDrilldownTarget(null);
    setDrilldownSkus([]);
  }, [channelAccountId, selectedChannelKey]);

  useEffect(() => {
    if (activeTab === "returns" && !isAmazonChannel) {
      setActiveTab("overview");
    }
  }, [activeTab, isAmazonChannel]);

  useEffect(() => {
    if (!router.isReady || channelAccounts.length === 0) return;
    const queryId = typeof router.query.channel_account_id === "string" ? router.query.channel_account_id : null;
    const fallbackId = channelAccounts.find((account) => account.is_active)?.id ?? channelAccounts[0]?.id ?? null;
    const nextId = queryId && channelAccounts.some((account) => account.id === queryId) ? queryId : fallbackId;
    if (!nextId) return;
    setChannelAccountId((prev) => prev ?? nextId);
    if (queryId !== nextId) {
      void router.replace(
        { pathname: router.pathname, query: { ...router.query, channel_account_id: nextId } },
        undefined,
        { shallow: true }
      );
    }
  }, [channelAccounts, router]);

  useEffect(() => {
    if (!router.isReady || !channelAccountId) return;
    const queryId = typeof router.query.channel_account_id === "string" ? router.query.channel_account_id : null;
    if (queryId === channelAccountId) return;
    void router.replace(
      { pathname: router.pathname, query: { ...router.query, channel_account_id: channelAccountId } },
      undefined,
      { shallow: true }
    );
  }, [channelAccountId, router]);

  useEffect(() => {
    loadReturnsAvailability();
    loadReportRuns();
  }, [loadReportRuns, loadReturnsAvailability]);

  useEffect(() => {
    setSkuPage(0);
  }, [skuMode, skuSort, skuQuery, fromDate, toDate, channelAccountId, selectedChannelKey]);

  useEffect(() => {
    setGeoPage(0);
  }, [geoLevel, fromDate, toDate, channelAccountId, selectedChannelKey]);

  useEffect(() => {
    setGeoPage(0);
  }, [geoStateFilter]);

  useEffect(() => {
    setCohortPage(0);
  }, [cohortGrain, fromDate, toDate, channelAccountId, selectedChannelKey]);

  useEffect(() => {
    setReturnsPage(0);
  }, [fromDate, toDate, channelAccountId, selectedChannelKey]);

  useEffect(() => {
    if (exportOptions.length === 0) return;
    setExportSelection(exportOptions[0]?.value ?? "");
  }, [exportOptions]);

  useEffect(() => {
    setDrilldownTarget(null);
    setDrilldownSkus([]);
  }, [geoLevel, geoStateFilter, fromDate, toDate, channelAccountId, selectedChannelKey]);

  useEffect(() => {
    const handleResize = () => {
      setIsNarrowScreen(window.innerWidth < 1024);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!isAmazonChannel && overviewView !== "analytics") {
      setOverviewView("analytics");
      return;
    }
    if (isNarrowScreen && overviewView === "side-by-side") {
      setOverviewView("analytics");
    }
  }, [isAmazonChannel, isNarrowScreen, overviewView]);

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
    returnsPage,
    channelAccountId,
    selectedChannelKey,
    handleRefresh,
  ]);

  useEffect(() => {
    if (activeTab !== "customers") return;
    loadCohortEmailStats();
  }, [activeTab, loadCohortEmailStats]);

  if (loading || isLoadingChannels) {
    return <div style={pageContainerStyle}>Loading analytics…</div>;
  }

  if (!selectedChannelAccount) {
    return <div style={pageContainerStyle}>No channel accounts available.</div>;
  }

  return (
    <ErpShell>
      <div style={pageContainerStyle}>
        <header style={pageHeaderStyle}>
          <div>
            <p style={eyebrowStyle}>Analytics · {selectedChannelAccount?.name ?? "Channel"}</p>
            <h1 style={h1Style}>Channel Analytics</h1>
            <p style={subtitleStyle}>Sales, geo performance, and repeat customer signals from reports.</p>
          </div>
        </header>

        <section style={stickyFilterStyle}>
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={filtersGridStyle}>
              <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, color: "#4b5563" }}>
                Marketplace
                <select
                  value={channelAccountId ?? ""}
                  onChange={(event) => setChannelAccountId(event.target.value)}
                  style={inputStyle}
                >
                  {channelAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                      {!account.is_active ? " (Inactive)" : ""}
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
                  {activeTab === "returns" && isAmazonChannel ? (
                    <button
                      type="button"
                      style={secondaryButtonStyle}
                      onClick={handleReturnsSync}
                      disabled={isSyncingReturns}
                    >
                      {isSyncingReturns ? "Syncing returns…" : "Sync returns"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    style={primaryButtonStyle}
                    onClick={handleSync}
                    disabled={isSyncing || isUnsupportedChannel}
                    title={isUnsupportedChannel ? "Not connected yet" : undefined}
                  >
                    {isSyncing ? "Syncing analytics…" : "Sync analytics"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {error ? <p style={errorStyle}>{error}</p> : null}
          {toast ? <div style={toastStyle(toast.type)}>{toast.message}</div> : null}

          {isUnsupportedChannel ? <div style={warningBannerStyle}>Not connected yet.</div> : null}
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
            {availableTabs.map((tab) => (
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
              <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Overview</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {overviewViewOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      style={overviewView === option.key ? primaryButtonStyle : secondaryButtonStyle}
                      onClick={() => setOverviewView(option.key as typeof overviewView)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section
              style={{
                display: "grid",
                gridTemplateColumns:
                  overviewView === "side-by-side" && !isNarrowScreen ? "repeat(2, minmax(0, 1fr))" : "1fr",
                gap: 16,
              }}
            >
              {overviewView !== "financial" ? (
                <div style={cardStyle}>
                  <p style={{ margin: 0, fontWeight: 600 }}>Analytics (Estimated)</p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    {[
                      {
                        label: "Gross Sales (Operational)",
                        value: formatCurrency(overviewKpisV2?.gross_sales ?? null),
                        tooltip: overviewTooltipText.grossSalesOperational,
                      },
                      {
                        label: "Confirmed Orders",
                        value: formatCurrency(overviewKpisV2?.confirmed_orders_value ?? null),
                        secondary: `${formatNumber(overviewKpisV2?.confirmed_orders_count ?? null)} orders`,
                        tooltip: overviewTooltipText.confirmedOrders,
                      },
                      {
                        label: "Cancellations",
                        value: formatNumber(overviewKpisV2?.cancellations_count ?? null),
                        tooltip: overviewTooltipText.cancellations,
                      },
                      {
                        label: "Returns (Operational – Estimated)",
                        value: formatCurrency(overviewKpisV2?.returns_value ?? null),
                        secondary: `${formatNumber(overviewKpisV2?.returns_count ?? null)} orders`,
                        tooltip: overviewTooltipText.returnsOperational,
                      },
                      {
                        label: "Discounts",
                        value: formatCurrency(overviewKpisV2?.discount_value ?? null),
                        secondary:
                          overviewKpisV2?.gross_sales &&
                          overviewKpisV2.gross_sales > 0 &&
                          overviewKpisV2.discount_value != null
                            ? `${formatPercent(overviewKpisV2.discount_value / overviewKpisV2.gross_sales)} of gross`
                            : "—",
                        tooltip: overviewTooltipText.discounts,
                      },
                      {
                        label: "Net Sales (Estimated)",
                        value: formatCurrency(overviewKpisV2?.net_sales_estimated ?? null),
                        tooltip: overviewTooltipText.netSalesEstimated,
                      },
                      {
                        label: "Avg per Day",
                        value: formatCurrency(overviewKpisV2?.avg_per_day ?? null),
                        secondary:
                          overviewKpisV2?.days_count !== null && overviewKpisV2?.days_count !== undefined
                            ? `${formatNumber(overviewKpisV2?.days_count ?? null)} days`
                            : "—",
                        tooltip: overviewTooltipText.avgPerDay,
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
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{tile.label}</p>
                          {tile.tooltip ? <ErpTooltip content={tile.tooltip} /> : null}
                        </div>
                        <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{tile.value}</p>
                        {tile.secondary ? (
                          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{tile.secondary}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: "12px 0 0", fontSize: 12, color: "#6b7280" }}>
                    Estimated (Orders/Returns reports). Fees & payouts in Settlements.
                  </p>
                </div>
              ) : null}

              {overviewView !== "analytics" ? (
                <div style={cardStyle}>
                  <p style={{ margin: 0, fontWeight: 600 }}>Financial (Settlement)</p>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 12,
                      marginTop: 12,
                    }}
                  >
                    {[
                      {
                        label: "Gross Sales (Settlement)",
                        value: formatCurrencyWithCode(financialOverview?.settlement_gross_sales ?? 0, financialOverview?.currency ?? null),
                      },
                      {
                        label: "Refunds/Returns (Settlement)",
                        value: formatCurrencyWithCode(
                          financialOverview?.settlement_refunds_returns ?? 0,
                          financialOverview?.currency ?? null
                        ),
                        tooltip: overviewTooltipText.refundsSettlement,
                      },
                      {
                        label: "Amazon Fees",
                        value: formatCurrencyWithCode(financialOverview?.settlement_fees ?? 0, financialOverview?.currency ?? null),
                        tooltip: overviewTooltipText.amazonFees,
                      },
                      {
                        label: "Withholdings",
                        value: formatCurrencyWithCode(
                          financialOverview?.settlement_withholdings ?? 0,
                          financialOverview?.currency ?? null
                        ),
                        tooltip: overviewTooltipText.withholdings,
                      },
                      {
                        label: "Net Payout",
                        value: formatCurrencyWithCode(
                          financialOverview?.settlement_net_payout ?? 0,
                          financialOverview?.currency ?? null
                        ),
                        tooltip: overviewTooltipText.netPayout,
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
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <p style={{ margin: 0, fontSize: 12, color: "#6b7280" }}>{tile.label}</p>
                          {tile.tooltip ? <ErpTooltip content={tile.tooltip} /> : null}
                        </div>
                        <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{tile.value}</p>
                      </div>
                    ))}
                  </div>
                  <p style={{ margin: "12px 0 0", fontSize: 12, color: "#6b7280" }}>
                    Financial truth (Settlement-based).
                  </p>
                  {financialOverview &&
                  (financialOverview.settlement_gross_sales ?? 0) === 0 &&
                  (financialOverview.settlement_refunds_returns ?? 0) === 0 &&
                  (financialOverview.settlement_fees ?? 0) === 0 &&
                  (financialOverview.settlement_withholdings ?? 0) === 0 &&
                  (financialOverview.settlement_net_payout ?? 0) === 0 ? (
                    <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7280" }}>
                      No settlement data in range.
                    </p>
                  ) : null}
                </div>
              ) : null}
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
                          if (!isAmazonChannel) {
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

            {isAmazonChannel && drilldownTarget ? (
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
              {isShopifyChannel ? (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Metric</th>
                      <th style={tableHeaderCellStyle}>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={tableCellStyle}>Total customers</td>
                      <td style={tableCellStyle}>{formatNumber(repeatSummary.totalCustomers)}</td>
                    </tr>
                    <tr>
                      <td style={tableCellStyle}>Repeat customers</td>
                      <td style={tableCellStyle}>{formatNumber(repeatSummary.repeatCustomers)}</td>
                    </tr>
                    <tr>
                      <td style={tableCellStyle}>Repeat rate</td>
                      <td style={tableCellStyle}>{formatPercent(repeatSummary.repeatRate)}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
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
              )}
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
              {isAmazonChannel && cohorts.length === 0 && cohortEmailStats ? (
                <div style={warningBannerStyle}>
                  Cohorts are empty. Buyer email is missing on {formatPercent(cohortEmailStats.missing_email_ratio ?? 0)} of
                  rows, so cohort attribution may be limited.
                </div>
              ) : null}
              {isAmazonChannel &&
              cohortEmailStats &&
              (cohortEmailStats.missing_email_ratio ?? 0) > 0.8 &&
              (cohortEmailStats.total_rows ?? 0) > 0 ? (
                <div style={warningBannerStyle}>
                  Buyer email not available in this report. Cohorts are estimated using shipping postal/state fallback.
                </div>
              ) : null}
              {isAmazonChannel ? <p style={mutedStyle}>Repeat rates depend on buyer email availability.</p> : null}
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
          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <section style={cardStyle}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Returns</p>
                <span style={badgeStyle}>Estimated from orders gross</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {[
                  {
                    label: "Return orders",
                    value: formatNumber(returnsSummary?.returns_orders_count ?? null),
                  },
                  {
                    label: "Return units",
                    value: formatNumber(returnsSummary?.returns_units ?? null),
                  },
                  {
                    label: "Estimated value",
                    value: formatCurrency(returnsSummary?.returns_value_estimated ?? null),
                    caption: "Estimated from orders gross; settlement view in Finance is financial truth.",
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
                    {tile.caption ? <p style={{ margin: 0, fontSize: 11, color: "#6b7280" }}>{tile.caption}</p> : null}
                  </div>
                ))}
              </div>
            </section>

            <section style={cardStyle}>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
                <p style={{ margin: 0, fontWeight: 600 }}>Return rows</p>
                <span style={badgeStyle}>FBA + MFN</span>
              </div>
              {!hasReturns ? (
                <p style={mutedStyle}>No return data yet.</p>
              ) : (
                <table style={tableStyle}>
                  <thead>
                    <tr>
                      <th style={tableHeaderCellStyle}>Return date</th>
                      <th style={tableHeaderCellStyle}>Source</th>
                      <th style={tableHeaderCellStyle}>Order ID</th>
                      <th style={tableHeaderCellStyle}>SKU / ASIN</th>
                      <th style={tableHeaderCellStyle}>Qty</th>
                      <th style={tableHeaderCellStyle}>Reason</th>
                      <th style={tableHeaderCellStyle}>Disposition</th>
                      <th style={tableHeaderCellStyle}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnRows.length === 0 ? (
                      <tr>
                        <td style={tableCellStyle} colSpan={8}>
                          {isLoadingData ? "Loading returns…" : "No return data found."}
                        </td>
                      </tr>
                    ) : (
                      returnRows.map((row) => (
                        <tr key={row.id}>
                          <td style={tableCellStyle}>{formatDateLabel(row.return_date ?? null)}</td>
                          <td style={tableCellStyle}>{row.source?.toUpperCase() ?? "—"}</td>
                          <td style={tableCellStyle}>{row.amazon_order_id ?? row.rma_id ?? "—"}</td>
                          <td style={tableCellStyle}>
                            {[row.sku, row.asin].filter(Boolean).join(" · ") || "—"}
                          </td>
                          <td style={tableCellStyle}>{formatNumber(row.quantity ?? 0)}</td>
                          <td style={tableCellStyle}>{row.reason ?? "—"}</td>
                          <td style={tableCellStyle}>{row.disposition ?? "—"}</td>
                          <td style={tableCellStyle}>{row.status ?? "—"}</td>
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
                  onClick={() => setReturnsPage((prev) => Math.max(prev - 1, 0))}
                  disabled={returnsPage === 0 || isLoadingData}
                >
                  Previous
                </button>
                <button
                  type="button"
                  style={secondaryButtonStyle}
                  onClick={() => setReturnsPage((prev) => prev + 1)}
                  disabled={isLoadingData || returnRows.length < pageSize}
                >
                  Next
                </button>
              </div>
            </section>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}

type AnalyticsSyncResponse =
  | {
      ok: true;
      run_id?: string;
      report_id?: string;
      row_count?: number;
      facts_upserted?: number;
      inserted_rows?: number;
      skipped_rows?: number;
      orders_upserted?: number;
      lines_upserted?: number;
    }
  | { ok: false; error: string; details?: string };

type ReturnsSyncResponse =
  | {
      ok: true;
      runs: Array<{
        run_id: string;
        report_id: string;
        report_type: string;
        row_count: number;
        facts_upserted: number;
        inserted_rows: number;
        skipped_rows: number;
      }>;
      row_count: number;
      facts_upserted: number;
      inserted_rows: number;
      skipped_rows: number;
    }
  | { ok: false; error: string; details?: string };
