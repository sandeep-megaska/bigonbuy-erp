import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";
import { APPLY_COOLDOWN_HOURS, hoursSince } from "../../../../lib/erp/marketing/campaignControlApi";

type ApiResponse =
  | { ok: true; rows: any[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req, res);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  const { data: controls, error: controlError } = await context.serviceClient
    .from("erp_mkt_meta_campaign_control")
    .select(
      "id,campaign_layer,campaign_name,meta_campaign_id,current_budget,last_adjusted_at,status,automation_enabled,min_budget,max_budget,scale_up_pct,scale_down_pct,last_decision,last_decision_reason"
    )
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false });

  if (controlError) {
    return res.status(400).json({ ok: false, error: controlError.message || "Failed to load controls" });
  }

  const campaignIds = Array.from(new Set((controls ?? []).map((c: any) => String(c.meta_campaign_id ?? "")).filter(Boolean)));

  const { data: dailyDecisions, error: dailyError } = campaignIds.length
    ? await context.serviceClient
        .from("erp_mkt_meta_scaling_decisions_daily")
        .select("id,entity_id,decision_date,decision,target_budget_multiplier,decision_reason,confidence_score")
        .eq("company_id", context.companyId)
        .eq("entity_type", "campaign")
        .in("entity_id", campaignIds)
        .order("decision_date", { ascending: false })
    : { data: [], error: null as any };

  const { data: recoDecisions, error: recoError } = campaignIds.length
    ? await context.serviceClient
        .from("erp_mkt_scaling_recommendations")
        .select("id,campaign_id,dt,recommendation,pct_change,reason")
        .eq("company_id", context.companyId)
        .in("campaign_id", campaignIds)
        .order("dt", { ascending: false })
    : { data: [], error: null as any };

  if (dailyError || recoError) {
    return res.status(400).json({ ok: false, error: dailyError?.message || recoError?.message || "Failed to load recommendations" });
  }

  const dailyMap = new Map<string, any>();
  for (const row of dailyDecisions) {
    const key = String(row.entity_id ?? "");
    if (!key || dailyMap.has(key)) continue;
    dailyMap.set(key, row);
  }

  const recoMap = new Map<string, any>();
  for (const row of recoDecisions) {
    const key = String(row.campaign_id ?? "");
    if (!key || recoMap.has(key)) continue;
    recoMap.set(key, row);
  }

  // Mapping order: campaign-scoped daily decision first, then campaign recommendation fallback.
  const rows = (controls ?? []).map((control: any) => {
    const metaCampaignId = String(control.meta_campaign_id ?? "");
    const daily = dailyMap.get(metaCampaignId);
    const reco = recoMap.get(metaCampaignId);
    const multiplier = daily
      ? Number(daily.target_budget_multiplier ?? 0)
      : reco
      ? 1 + Number(reco.pct_change ?? 0)
      : null;
    const currentBudget = control.current_budget == null ? null : Number(control.current_budget);
    const recommendedBudget = currentBudget != null && multiplier != null ? Number((currentBudget * multiplier).toFixed(2)) : null;
    const cooling = hoursSince(control.last_adjusted_at) < APPLY_COOLDOWN_HOURS;

    return {
      control_id: control.id,
      campaign_layer: control.campaign_layer,
      campaign_name: control.campaign_name,
      meta_campaign_id: control.meta_campaign_id,
      current_budget: currentBudget,
      recommended_multiplier: multiplier,
      recommended_new_budget: recommendedBudget,
      confidence_score: daily?.confidence_score == null ? null : Number(daily.confidence_score),
      decision: daily?.decision ?? reco?.recommendation ?? null,
      decision_reason: daily?.decision_reason ?? reco?.reason ?? null,
      decision_id: daily?.id ?? reco?.id ?? null,
      decision_date: daily?.decision_date ?? reco?.dt ?? null,
      decision_source: daily ? "daily" : reco ? "recommendation" : null,
      last_adjusted_at: control.last_adjusted_at,
      status: control.status,
      action_eligibility: {
        can_approve:
          control.status === "active" &&
          control.automation_enabled &&
          currentBudget != null &&
          currentBudget > 0 &&
          multiplier != null &&
          multiplier > 0 &&
          !cooling,
        reason: control.status !== "active"
          ? "inactive"
          : !control.automation_enabled
          ? "automation_disabled"
          : currentBudget == null || currentBudget <= 0
          ? "missing_current_budget"
          : multiplier == null || multiplier <= 0
          ? "invalid_multiplier"
          : cooling
          ? "cooldown_active"
          : "eligible",
      },
    };
  });

  return res.status(200).json({ ok: true, rows });
}
