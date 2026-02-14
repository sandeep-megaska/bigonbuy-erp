import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../../lib/erp/marketing/intelligenceApi";

type SummaryResponse =
  | {
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
      daily: Array<{ dt: string; orders_count: number; revenue: number }>;
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
    }
  | { error: string };

const ALLOWED_ROLE_KEYS = new Set(["owner", "admin", "inventory", "finance"]);

const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<SummaryResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }
  if (!ALLOWED_ROLE_KEYS.has(context.roleKey)) {
    return res.status(403).json({ error: "Not authorized to view Amazon alerts" });
  }

  const { data: roll, error: rollError } = await context.userClient
    .from("erp_mkt_amazon_kpi_rolling_7d_v1")
    .select(
      "last7_from,last7_to,prev7_from,prev7_to,last7_orders,prev7_orders,orders_delta,orders_delta_pct,last7_revenue,prev7_revenue,revenue_delta,revenue_delta_pct"
    )
    .eq("company_id", context.companyId)
    .maybeSingle();

  if (rollError || !roll) {
    return res.status(400).json({ error: rollError?.message || "Failed to load Amazon rolling KPI summary" });
  }

  const { data: latestAlert, error: latestAlertError } = await context.userClient
    .from("erp_mkt_amazon_kpi_alerts_v1")
    .select(
      "dt,orders,revenue,rolling_7d_avg_orders,one_day_deviation_pct,one_day_deviation_abs_pct,trend_status,volatility_status"
    )
    .eq("company_id", context.companyId)
    .order("dt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestAlertError) {
    return res.status(400).json({ error: latestAlertError.message || "Failed to load Amazon latest KPI alert" });
  }

  const { data: dailyRows, error: dailyError } = await context.userClient
    .from("erp_mkt_amazon_kpi_daily_v1")
    .select("dt,orders_count,revenue")
    .eq("company_id", context.companyId)
    .order("dt", { ascending: false })
    .limit(30);

  if (dailyError) {
    return res.status(400).json({ error: dailyError.message || "Failed to load Amazon daily KPI series" });
  }

  const { data: dipsRows, error: dipsError } = await context.userClient
    .from("erp_mkt_amazon_asin_dips_7d_v1")
    .select(
      "asin,sku,last7_orders,prev7_orders,orders_delta,orders_delta_pct,last7_revenue,prev7_revenue,revenue_delta,revenue_delta_pct"
    )
    .eq("company_id", context.companyId)
    .order("revenue_delta", { ascending: true })
    .order("orders_delta", { ascending: true })
    .limit(20);

  if (dipsError) {
    return res.status(400).json({ error: dipsError.message || "Failed to load Amazon ASIN dip rows" });
  }

  return res.status(200).json({
    window: {
      last7_from: String(roll.last7_from),
      last7_to: String(roll.last7_to),
      prev7_from: String(roll.prev7_from),
      prev7_to: String(roll.prev7_to),
    },
    kpis: {
      last7_orders: num(roll.last7_orders),
      prev7_orders: num(roll.prev7_orders),
      orders_delta: num(roll.orders_delta),
      orders_delta_pct: num(roll.orders_delta_pct),
      last7_revenue: num(roll.last7_revenue),
      prev7_revenue: num(roll.prev7_revenue),
      revenue_delta: num(roll.revenue_delta),
      revenue_delta_pct: num(roll.revenue_delta_pct),
    },
    latest_alert: latestAlert
      ? {
          dt: String(latestAlert.dt),
          orders: num(latestAlert.orders),
          revenue: num(latestAlert.revenue),
          rolling_7d_avg_orders: num(latestAlert.rolling_7d_avg_orders),
          one_day_deviation_pct: num(latestAlert.one_day_deviation_pct),
          one_day_deviation_abs_pct: num(latestAlert.one_day_deviation_abs_pct),
          trend_status: (latestAlert.trend_status ?? "UNKNOWN") as "UNKNOWN" | "GREEN" | "RED",
          volatility_status: (latestAlert.volatility_status ?? "UNKNOWN") as "UNKNOWN" | "GREY" | "AMBER" | "RED",
        }
      : null,
    daily: (dailyRows ?? [])
      .map((row) => ({
        dt: String(row.dt),
        orders_count: num(row.orders_count),
        revenue: num(row.revenue),
      }))
      .sort((a, b) => a.dt.localeCompare(b.dt)),
    dips: (dipsRows ?? []).map((row) => ({
      asin: String(row.asin ?? "unknown"),
      sku: String(row.sku ?? "unknown"),
      last7_orders: num(row.last7_orders),
      prev7_orders: num(row.prev7_orders),
      orders_delta: num(row.orders_delta),
      orders_delta_pct: num(row.orders_delta_pct),
      last7_revenue: num(row.last7_revenue),
      prev7_revenue: num(row.prev7_revenue),
      revenue_delta: num(row.revenue_delta),
      revenue_delta_pct: num(row.revenue_delta_pct),
    })),
  });
}
