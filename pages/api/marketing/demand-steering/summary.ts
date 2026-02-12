import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type DemandRow = {
  sku?: string;
  city?: string;
  orders_30d: number;
  revenue_30d: number;
  orders_prev_30d: number;
  revenue_prev_30d: number;
  growth_rate: number;
  demand_score: number;
  decision: string;
};

type ApiResponse =
  | {
      week_start: string | null;
      refreshed_at: string | null;
      playbook: {
        scale_skus: DemandRow[];
        reduce_skus: DemandRow[];
        expand_cities: DemandRow[];
        reduce_cities: DemandRow[];
      };
      tables: {
        scale_skus: DemandRow[];
        reduce_skus: DemandRow[];
        expand_cities: DemandRow[];
        reduce_cities: DemandRow[];
      };
    }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }

  const [
    scaleSkusTop5Resp,
    reduceSkusTop5Resp,
    expandCitiesTop5Resp,
    reduceCitiesTop5Resp,
    scaleSkusTop20Resp,
    reduceSkusTop20Resp,
    expandCitiesTop20Resp,
    reduceCitiesTop20Resp,
    skuMetaResp,
    cityMetaResp,
  ] = await Promise.all([
    context.userClient
      .from("erp_mkt_sku_demand_latest_v1")
      .select("sku, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "SCALE")
      .order("demand_score", { ascending: false })
      .limit(5),
    context.userClient
      .from("erp_mkt_sku_demand_latest_v1")
      .select("sku, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "REDUCE")
      .order("demand_score", { ascending: true })
      .limit(5),
    context.userClient
      .from("erp_mkt_city_demand_latest_v1")
      .select("city, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "EXPAND")
      .order("demand_score", { ascending: false })
      .limit(5),
    context.userClient
      .from("erp_mkt_city_demand_latest_v1")
      .select("city, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "REDUCE")
      .order("demand_score", { ascending: true })
      .limit(5),
    context.userClient
      .from("erp_mkt_sku_demand_latest_v1")
      .select("sku, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "SCALE")
      .order("demand_score", { ascending: false })
      .limit(20),
    context.userClient
      .from("erp_mkt_sku_demand_latest_v1")
      .select("sku, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "REDUCE")
      .order("demand_score", { ascending: true })
      .limit(20),
    context.userClient
      .from("erp_mkt_city_demand_latest_v1")
      .select("city, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "EXPAND")
      .order("demand_score", { ascending: false })
      .limit(20),
    context.userClient
      .from("erp_mkt_city_demand_latest_v1")
      .select("city, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision")
      .eq("decision", "REDUCE")
      .order("demand_score", { ascending: true })
      .limit(20),
    context.userClient
      .from("erp_mkt_sku_demand_latest_v1")
      .select("week_start, created_at")
      .order("week_start", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    context.userClient
      .from("erp_mkt_city_demand_latest_v1")
      .select("week_start, created_at")
      .order("week_start", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const firstError =
    scaleSkusTop5Resp.error ||
    reduceSkusTop5Resp.error ||
    expandCitiesTop5Resp.error ||
    reduceCitiesTop5Resp.error ||
    scaleSkusTop20Resp.error ||
    reduceSkusTop20Resp.error ||
    expandCitiesTop20Resp.error ||
    reduceCitiesTop20Resp.error ||
    skuMetaResp.error ||
    cityMetaResp.error;

  if (firstError) {
    return res.status(400).json({ error: firstError.message || "Failed to load demand steering summary" });
  }

  const weekStart = skuMetaResp.data?.week_start ?? cityMetaResp.data?.week_start ?? null;
  const refreshedAtCandidates = [skuMetaResp.data?.created_at, cityMetaResp.data?.created_at]
    .filter(Boolean)
    .map((x) => new Date(String(x)).getTime())
    .filter((x) => Number.isFinite(x));
  const refreshedAt =
    refreshedAtCandidates.length > 0
      ? new Date(Math.max(...refreshedAtCandidates)).toISOString()
      : null;

  return res.status(200).json({
    week_start: weekStart ? String(weekStart) : null,
    refreshed_at: refreshedAt,
    playbook: {
      scale_skus: scaleSkusTop5Resp.data ?? [],
      reduce_skus: reduceSkusTop5Resp.data ?? [],
      expand_cities: expandCitiesTop5Resp.data ?? [],
      reduce_cities: reduceCitiesTop5Resp.data ?? [],
    },
    tables: {
      scale_skus: scaleSkusTop20Resp.data ?? [],
      reduce_skus: reduceSkusTop20Resp.data ?? [],
      expand_cities: expandCitiesTop20Resp.data ?? [],
      reduce_cities: reduceCitiesTop20Resp.data ?? [],
    },
  });
}
