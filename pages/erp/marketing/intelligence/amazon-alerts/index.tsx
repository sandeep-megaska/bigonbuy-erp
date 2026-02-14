import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { getCompanyContext, requireAuthRedirectHome } from "../../../../../lib/erpContext";

type SummaryPayload = {
  window: {
    last7_from: string;
    last7_to: string;
    prev7_from: string;
    prev7_to: string;
  };
  kpis: {
    last7_orders: number;
    prev7_orders: number;
    orders_delta: number;
    orders_delta_pct: number;
    last7_revenue: number;
    prev7_revenue: number;
    revenue_delta: number;
    revenue_delta_pct: number;
  };
  daily: Array<{ dt: string; orders_count: number; revenue: number }>;
  latest_alert: {
    dt: string;
    orders: number;
    revenue: number;
    rolling_7d_avg_orders: number;
    one_day_deviation_pct: number;
    one_day_deviation_abs_pct: number;
    trend_status: "UNKNOWN" | "GREEN" | "RED";
    volatility_status: "UNKNOWN" | "GREY" | "AMBER" | "RED";
  } | null;
  dips: Array<{
    asin: string;
    sku: string;
    last7_orders: number;
    prev7_orders: number;
    orders_delta: number;
    orders_delta_pct: number;
    last7_revenue: number;
    prev7_revenue: number;
    revenue_delta: number;
    revenue_delta_pct: number;
  }>;
};

const formatNumber = (value: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value);
const formatCurrency = (value: number) => `₹ ${formatNumber(value)}`;
const formatPct = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function AmazonAlertsPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SummaryPayload | null>(null);

  const load = async (overrideToken?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const authToken = overrideToken ?? token;
      const resp = await fetch("/api/marketing/intelligence/amazon-alerts/summary", {
        method: "GET",
        headers: {
          Authorization: authToken ? `Bearer ${authToken}` : "",
          "Content-Type": "application/json",
        },
      });
      const json = (await resp.json().catch(() => null)) as SummaryPayload | { error?: string } | null;
      if (!resp.ok) {
        setData(null);
        setError(json && "error" in json ? json.error ?? `Request failed (${resp.status})` : `Request failed (${resp.status})`);
        setLoading(false);
        return;
      }
      setData(json as SummaryPayload);
      setLoading(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Network error";
      setData(null);
      setError(message);
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      if (!router.isReady) return;
      const session = await requireAuthRedirectHome(router);
      if (!session || !active) return;

      const companyContext = await getCompanyContext(session);
      if (!active) return;
      if (!companyContext.companyId) {
        setError(companyContext.membershipError || "No active company membership found.");
        setLoading(false);
        return;
      }

      const sessionToken = session.access_token ?? null;
      setToken(sessionToken);
      await load(sessionToken);
    })();

    return () => {
      active = false;
    };
  }, [router.isReady]);

  const trend = useMemo(() => {
    const d = data?.kpis.orders_delta ?? 0;
    const p = data?.kpis.orders_delta_pct ?? 0;
    if (p <= -0.25 && d <= -30) {
      return { label: "RED", color: "#b42318", bg: "#fee4e2", note: "Sharp decline detected. Investigate immediately." };
    }
    if (p <= -0.15 && d <= -15) {
      return { label: "AMBER", color: "#b54708", bg: "#fef0c7", note: "Moderate dip. Watch campaigns and inventory." };
    }
    return { label: "GREEN", color: "#027a48", bg: "#d1fadf", note: "No major order dip in current 7-day window." };
  }, [data?.kpis.orders_delta, data?.kpis.orders_delta_pct]);


  const volatility = useMemo(() => {
    const status = data?.latest_alert?.volatility_status ?? "UNKNOWN";
    const deviation = data?.latest_alert?.one_day_deviation_abs_pct ?? 0;
    if (status === "RED") return { label: "RED", color: "#b42318", bg: "#fee4e2", text: `Volatility: RED (${deviation.toFixed(2)}%)` };
    if (status === "AMBER") return { label: "AMBER", color: "#b54708", bg: "#fef0c7", text: `Volatility: AMBER (${deviation.toFixed(2)}%)` };
    if (status === "GREY") return { label: "GREY", color: "#475467", bg: "#eaecf0", text: `Volatility: GREY (${deviation.toFixed(2)}%)` };
    return { label: "UNKNOWN", color: "#667085", bg: "#f2f4f7", text: "Volatility: UNKNOWN" };
  }, [data?.latest_alert?.one_day_deviation_abs_pct, data?.latest_alert?.volatility_status]);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Amazon Alerts</h1>
          <p style={{ margin: "6px 0 0", opacity: 0.7 }}>Early warning panel (7d trend + top ASIN/SKU dips)</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} style={{ padding: "8px 12px", cursor: "pointer" }}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {data ? (
        <div style={{ marginTop: 8, fontSize: 12, opacity: 0.75 }}>
          Window: {data.window.last7_from} → {data.window.last7_to} (prev: {data.window.prev7_from} → {data.window.prev7_to})
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #f5c2c7", background: "#f8d7da" }}>
          <b>Error:</b> {error}
        </div>
      ) : null}

      <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Orders (last 7d)</div>
          <div style={{ marginTop: 6, fontSize: 24, fontWeight: 700 }}>{formatNumber(data?.kpis.last7_orders ?? 0)}</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
            Δ {formatNumber(data?.kpis.orders_delta ?? 0)} ({formatPct(data?.kpis.orders_delta_pct ?? 0)}) vs prev7
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Revenue (last 7d)</div>
          <div style={{ marginTop: 6, fontSize: 24, fontWeight: 700 }}>{formatCurrency(data?.kpis.last7_revenue ?? 0)}</div>
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
            Δ {formatCurrency(data?.kpis.revenue_delta ?? 0)} ({formatPct(data?.kpis.revenue_delta_pct ?? 0)}) vs prev7
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, borderRadius: 10, padding: 12, background: trend.bg, color: trend.color, border: `1px solid ${trend.color}` }}>
        <b>Trend: {trend.label}</b> · {trend.note}
      </div>

      <div
        style={{
          marginTop: 8,
          borderRadius: 10,
          padding: 12,
          background: volatility.bg,
          color: volatility.color,
          border: `1px solid ${volatility.color}`,
        }}
      >
        <b>{volatility.text}</b>
      </div>

      <div style={{ marginTop: 18, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Daily KPI (last 30 days)</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.7 }}>
              <th style={{ padding: "6px 0" }}>Date</th>
              <th style={{ padding: "6px 0" }}>Orders</th>
              <th style={{ padding: "6px 0" }}>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {(data?.daily ?? []).length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: "10px 0", opacity: 0.7 }}>
                  No daily rows yet.
                </td>
              </tr>
            ) : (
              (data?.daily ?? []).map((row) => (
                <tr key={row.dt} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "8px 0" }}>{row.dt}</td>
                  <td style={{ padding: "8px 0" }}>{formatNumber(row.orders_count)}</td>
                  <td style={{ padding: "8px 0" }}>{formatCurrency(row.revenue)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 18, border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
        <h3 style={{ marginTop: 0 }}>Top ASIN/SKU dips (7d vs prev7d)</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", fontSize: 12, opacity: 0.7 }}>
              <th style={{ padding: "6px 0" }}>ASIN</th>
              <th style={{ padding: "6px 0" }}>SKU</th>
              <th style={{ padding: "6px 0" }}>Orders Δ</th>
              <th style={{ padding: "6px 0" }}>Orders Δ%</th>
              <th style={{ padding: "6px 0" }}>Revenue Δ</th>
              <th style={{ padding: "6px 0" }}>Revenue Δ%</th>
            </tr>
          </thead>
          <tbody>
            {(data?.dips ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: "10px 0", opacity: 0.7 }}>
                  No dip rows in selected window.
                </td>
              </tr>
            ) : (
              (data?.dips ?? []).map((row, idx) => (
                <tr key={`${row.asin}-${row.sku}-${idx}`} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ padding: "8px 0" }}>{row.asin}</td>
                  <td style={{ padding: "8px 0" }}>{row.sku}</td>
                  <td style={{ padding: "8px 0" }}>{formatNumber(row.orders_delta)}</td>
                  <td style={{ padding: "8px 0" }}>{formatPct(row.orders_delta_pct)}</td>
                  <td style={{ padding: "8px 0" }}>{formatCurrency(row.revenue_delta)}</td>
                  <td style={{ padding: "8px 0" }}>{formatPct(row.revenue_delta_pct)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
