import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type TopScaleSku = {
  sku: string;
  demand_score: number;
  confidence_score: number;
  recommended_pct_change: number;
  revenue_30d: number;
  orders_30d: number;
  guardrail_tags?: string[];
};

type TopExpandCity = {
  city: string;
  demand_score: number;
  confidence_score: number;
  recommended_pct_change: number;
  revenue_30d: number;
  orders_30d: number;
};

type SummaryResponse =
  | {
      week_start: string | null;
      settings: {
        weekly_budget_inr: number;
        min_retargeting_share: number;
        max_prospecting_share: number;
      };
      recommendation: {
        scale_share: number;
        prospecting_share: number;
        retarget_share: number;
        scale_budget_inr: number;
        prospecting_budget_inr: number;
        retarget_budget_inr: number;
      };
      drivers: Record<string, unknown>;
      top: {
        scale_skus: TopScaleSku[];
        expand_cities: TopExpandCity[];
      };
    }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<SummaryResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }

  const [settingsResp, recoResp, scaleResp, cityResp] = await Promise.all([
    context.userClient
      .from("erp_mkt_budget_allocator_settings")
      .select("weekly_budget_inr, min_retargeting_share, max_prospecting_share")
      .eq("company_id", context.companyId)
      .maybeSingle(),
    context.userClient
      .from("erp_mkt_budget_allocator_reco_v1")
      .select(
        "week_start, weekly_budget_inr, scale_share, prospecting_share, retarget_share, scale_budget_inr, prospecting_budget_inr, retarget_budget_inr, drivers"
      )
      .eq("company_id", context.companyId)
      .maybeSingle(),
    context.userClient
      .from("erp_mkt_sku_demand_latest_v1")
      .select("sku, demand_score, confidence_score, recommended_pct_change, revenue_30d, orders_30d, guardrail_tags")
      .eq("decision", "SCALE")
      .gte("confidence_score", 0.5)
      .not("guardrail_tags", "cs", "{LOW_INVENTORY}")
      .order("demand_score", { ascending: false })
      .limit(10),
    context.userClient
      .from("erp_mkt_city_demand_latest_v1")
      .select("city, demand_score, confidence_score, recommended_pct_change, revenue_30d, orders_30d")
      .eq("decision", "EXPAND")
      .gte("confidence_score", 0.5)
      .order("demand_score", { ascending: false })
      .limit(10),
  ]);

  const firstError = settingsResp.error || recoResp.error || scaleResp.error || cityResp.error;
  if (firstError) {
    return res.status(400).json({ error: firstError.message || "Failed to load budget allocator summary" });
  }

  const settings = {
    weekly_budget_inr: Number(settingsResp.data?.weekly_budget_inr ?? recoResp.data?.weekly_budget_inr ?? 0),
    min_retargeting_share: Number(settingsResp.data?.min_retargeting_share ?? 0.2),
    max_prospecting_share: Number(settingsResp.data?.max_prospecting_share ?? 0.6),
  };

  return res.status(200).json({
    week_start: recoResp.data?.week_start ? String(recoResp.data.week_start) : null,
    settings,
    recommendation: {
      scale_share: Number(recoResp.data?.scale_share ?? 0),
      prospecting_share: Number(recoResp.data?.prospecting_share ?? 0),
      retarget_share: Number(recoResp.data?.retarget_share ?? settings.min_retargeting_share),
      scale_budget_inr: Number(recoResp.data?.scale_budget_inr ?? 0),
      prospecting_budget_inr: Number(recoResp.data?.prospecting_budget_inr ?? 0),
      retarget_budget_inr: Number(recoResp.data?.retarget_budget_inr ?? 0),
    },
    drivers: (recoResp.data?.drivers as Record<string, unknown> | null) ?? {},
    top: {
      scale_skus: (scaleResp.data ?? []) as TopScaleSku[],
      expand_cities: (cityResp.data ?? []) as TopExpandCity[],
    },
  });
}
