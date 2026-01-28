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
import { getCompanyContext, requireAuthRedirectHome } from "../../../../lib/erpContext";
import { supabase } from "../../../../lib/supabaseClient";

const DEFAULT_MARKETPLACE_ID = "A21TJRUUN4KGV";

const salesBySkuSchema = z.object({
  period: z.string().nullable(),
  sku: z.string().nullable(),
  asin: z.string().nullable(),
  title: z.string().nullable(),
  units: z.number().nullable(),
  sales: z.number().nullable(),
});

const salesByGeoSchema = z.object({
  geo: z.string().nullable(),
  orders: z.number().nullable(),
  units: z.number().nullable(),
  sales: z.number().nullable(),
});

const cohortSchema = z.object({
  cohort_period: z.string().nullable(),
  customers: z.number().nullable(),
  repeat_customers: z.number().nullable(),
  repeat_rate: z.number().nullable(),
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
  const [hasReturns, setHasReturns] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const visibleTabs = useMemo(() => {
    const tabs: Array<typeof activeTab> = ["sku", "geo", "cohorts"];
    if (hasReturns) tabs.push("returns");
    return tabs;
  }, [hasReturns]);

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

  const loadReturnsAvailability = useCallback(async () => {
    const { count, error: countError } = await supabase
      .from("erp_amazon_returns_items")
      .select("id", { count: "exact", head: true })
      .eq("marketplace_id", DEFAULT_MARKETPLACE_ID);

    if (countError) {
      setError(countError.message);
      return;
    }

    setHasReturns((count ?? 0) > 0);
  }, []);

  const handleRefresh = useCallback(async () => {
    setError(null);
    if (activeTab === "sku") {
      await loadSalesBySku();
    } else if (activeTab === "geo") {
      await loadSalesByGeo();
    } else if (activeTab === "cohorts") {
      await loadCohorts();
    }
  }, [activeTab, loadSalesBySku, loadSalesByGeo, loadCohorts]);

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
  }, [loadReturnsAvailability]);

  useEffect(() => {
    if (!visibleTabs.includes(activeTab)) {
      setActiveTab("sku");
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (loading || !fromDate || !toDate) return;
    handleRefresh();
  }, [loading, fromDate, toDate, skuGrain, geoLevel, cohortGrain, activeTab, handleRefresh]);

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
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button type="button" style={secondaryButtonStyle} onClick={handleRefresh}>
              Refresh
            </button>
          </div>
        </header>

        {error ? <p style={errorStyle}>{error}</p> : null}

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
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
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
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Period</th>
                  <th style={tableHeaderCellStyle}>SKU</th>
                  <th style={tableHeaderCellStyle}>ASIN</th>
                  <th style={tableHeaderCellStyle}>Title</th>
                  <th style={tableHeaderCellStyle}>Units</th>
                  <th style={tableHeaderCellStyle}>Sales</th>
                </tr>
              </thead>
              <tbody>
                {salesBySku.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={6}>
                      {isLoadingData ? "Loading sales…" : "No sales data found."}
                    </td>
                  </tr>
                ) : (
                  salesBySku.map((row, index) => (
                    <tr key={`${row.sku ?? "sku"}-${row.period ?? index}`}>
                      <td style={tableCellStyle}>{row.period ?? "—"}</td>
                      <td style={tableCellStyle}>{row.sku ?? "—"}</td>
                      <td style={tableCellStyle}>{row.asin ?? "—"}</td>
                      <td style={tableCellStyle}>{row.title ?? "—"}</td>
                      <td style={tableCellStyle}>{row.units ?? 0}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.sales ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "geo" ? (
          <section style={cardStyle}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
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
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>{geoLevel === "state" ? "State" : "City"}</th>
                  <th style={tableHeaderCellStyle}>Orders</th>
                  <th style={tableHeaderCellStyle}>Units</th>
                  <th style={tableHeaderCellStyle}>Sales</th>
                </tr>
              </thead>
              <tbody>
                {salesByGeo.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={4}>
                      {isLoadingData ? "Loading geo data…" : "No geography data found."}
                    </td>
                  </tr>
                ) : (
                  salesByGeo.map((row, index) => (
                    <tr key={`${row.geo ?? "geo"}-${index}`}>
                      <td style={tableCellStyle}>{row.geo ?? "—"}</td>
                      <td style={tableCellStyle}>{row.orders ?? 0}</td>
                      <td style={tableCellStyle}>{row.units ?? 0}</td>
                      <td style={tableCellStyle}>{formatCurrency(row.sales ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "cohorts" ? (
          <section style={cardStyle}>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
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
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={tableHeaderCellStyle}>Cohort period</th>
                  <th style={tableHeaderCellStyle}>Customers</th>
                  <th style={tableHeaderCellStyle}>Repeat customers</th>
                  <th style={tableHeaderCellStyle}>Repeat rate</th>
                </tr>
              </thead>
              <tbody>
                {cohorts.length === 0 ? (
                  <tr>
                    <td style={tableCellStyle} colSpan={4}>
                      {isLoadingData
                        ? "Loading cohorts…"
                        : "No cohort data found (buyer email may be missing)."}
                    </td>
                  </tr>
                ) : (
                  cohorts.map((row, index) => (
                    <tr key={`${row.cohort_period ?? "cohort"}-${index}`}>
                      <td style={tableCellStyle}>{row.cohort_period ?? "—"}</td>
                      <td style={tableCellStyle}>{row.customers ?? 0}</td>
                      <td style={tableCellStyle}>{row.repeat_customers ?? 0}</td>
                      <td style={tableCellStyle}>{row.repeat_rate ?? 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "returns" ? (
          <section style={cardStyle}>
            <h2 style={{ marginTop: 0 }}>Returns & refunds</h2>
            <p style={{ marginTop: 0, color: "#6b7280" }}>
              Returns ingestion is not configured yet. This panel will populate once returns data is loaded.
            </p>
          </section>
        ) : null}
      </div>
    </ErpShell>
  );
}
