import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type ExpandCityRow = {
  company_id: string;
  week_start: string;
  city: string;
  demand_score: number;
  confidence_score: number;
  recommended_pct_change: number;
};

type ApiResponse = { rows: ExpandCityRow[] } | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }

  const { data, error } = await context.userClient
    .from("erp_mkt_activation_expand_cities_v1")
    .select("company_id, week_start, city, demand_score, confidence_score, recommended_pct_change")
    .eq("company_id", context.companyId)
    .order("demand_score", { ascending: false })
    .limit(20);

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to load expand cities" });
  }

  return res.status(200).json({ rows: (data ?? []) as ExpandCityRow[] });
}
