import type { NextApiRequest, NextApiResponse } from "next";
import { parseDateParam, parseLimitParam, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type RecommendationRow = {
  campaign_id: string;
  campaign_name: string | null;
  recommendation: "SCALE_UP" | "SCALE_DOWN" | "HOLD";
  pct_change: number;
  reason: string;
  blended_roas_7d: number | null;
  blended_roas_3d: number | null;
  spend_3d: number | null;
  spend_7d: number | null;
  volatility_7d: number | null;
};

type ApiResponse =
  | {
      ok: true;
      dt: string | null;
      target_roas: number;
      rows: RecommendationRow[];
    }
  | { ok: false; error: string };

const TARGET_ROAS = 3.0;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  const limit = parseLimitParam(req.query.limit, 20);
  const dtParam = parseDateParam(req.query.dt);

  let dt = dtParam;
  if (!dt) {
    const { data: latestDtRow, error: latestDtError } = await context.serviceClient
      .from("erp_mkt_scaling_recommendations")
      .select("dt")
      .eq("company_id", context.companyId)
      .order("dt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestDtError) {
      return res.status(400).json({ ok: false, error: latestDtError.message || "Failed to resolve recommendations date" });
    }

    dt = latestDtRow?.dt ?? null;
  }

  if (!dt) {
    return res.status(200).json({ ok: true, dt: null, target_roas: TARGET_ROAS, rows: [] });
  }

  const { data, error } = await context.serviceClient
    .from("erp_mkt_scaling_recommendations")
    .select("campaign_id,recommendation,pct_change,reason,context")
    .eq("company_id", context.companyId)
    .eq("dt", dt)
    .order("pct_change", { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load scaling recommendations" });
  }

  const campaignIds = Array.from(new Set((data ?? []).map((row: any) => String(row.campaign_id ?? "")).filter(Boolean)));

  const campaignLookup = campaignIds.length
    ? await context.serviceClient
        .from("erp_mkt_meta_campaigns")
        .select("meta_campaign_id,campaign_name")
        .eq("company_id", context.companyId)
        .in("meta_campaign_id", campaignIds)
    : { data: [] as Array<{ meta_campaign_id: string; campaign_name: string | null }>, error: null };

  if (campaignLookup.error) {
    return res.status(400).json({ ok: false, error: campaignLookup.error.message || "Failed to load campaign metadata" });
  }

  const campaignNameMap = new Map(
    (campaignLookup.data ?? []).map((campaign) => [String(campaign.meta_campaign_id), campaign.campaign_name ?? null])
  );

  const rows: RecommendationRow[] = (data ?? []).map((row: any) => ({
    campaign_id: String(row.campaign_id ?? ""),
    campaign_name: campaignNameMap.get(String(row.campaign_id ?? "")) ?? null,
    recommendation: row.recommendation,
    pct_change: Number(row.pct_change ?? 0),
    reason: String(row.reason ?? ""),
    blended_roas_7d: row.context?.blended_roas_7d == null ? null : Number(row.context.blended_roas_7d),
    blended_roas_3d: row.context?.blended_roas_3d == null ? null : Number(row.context.blended_roas_3d),
    spend_3d: row.context?.spend_3d == null ? null : Number(row.context.spend_3d),
    spend_7d: row.context?.spend_7d == null ? null : Number(row.context.spend_7d),
    volatility_7d: row.context?.volatility_7d == null ? null : Number(row.context.volatility_7d),
  }));

  return res.status(200).json({
    ok: true,
    dt,
    target_roas: TARGET_ROAS,
    rows,
  });
}
