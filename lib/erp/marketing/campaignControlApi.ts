import type { SupabaseClient } from "@supabase/supabase-js";

export const APPLY_COOLDOWN_HOURS = 24;

export type ControlRow = {
  id: string;
  company_id: string;
  campaign_layer: string | null;
  campaign_name: string | null;
  meta_campaign_id: string | null;
  current_budget: number | null;
  last_adjusted_at: string | null;
  automation_enabled: boolean;
  min_budget: number | null;
  max_budget: number | null;
  scale_up_pct: number | null;
  scale_down_pct: number | null;
  status: string;
  last_decision: string | null;
  last_decision_reason: string | null;
};

export type DecisionCandidate = {
  decisionId: string;
  decisionDate: string | null;
  decision: string | null;
  multiplier: number | null;
  reason: string | null;
  confidenceScore: number | null;
  source: "daily" | "recommendation";
};

export function hoursSince(iso: string | null) {
  if (!iso) return Number.POSITIVE_INFINITY;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (1000 * 60 * 60);
}

export async function insertActionLog(
  client: SupabaseClient,
  payload: Record<string, any>,
) {
  const { error } = await client.from("erp_mkt_meta_campaign_actions_log").insert(payload);
  if (error) {
    throw new Error(error.message || "Failed to insert action log");
  }
}

export function computeBudget(currentBudget: number, multiplier: number, overrideBudget?: number | null) {
  if (overrideBudget != null) return Number(overrideBudget);
  return Number((currentBudget * multiplier).toFixed(2));
}

export function computeDeltaPct(currentBudget: number, newBudget: number) {
  if (!currentBudget) return null;
  return (newBudget - currentBudget) / currentBudget;
}

export async function loadControlRow(client: SupabaseClient, companyId: string, controlId: string) {
  const { data, error } = await client
    .from("erp_mkt_meta_campaign_control")
    .select(
      "id,company_id,campaign_layer,campaign_name,meta_campaign_id,current_budget,last_adjusted_at,automation_enabled,min_budget,max_budget,scale_up_pct,scale_down_pct,status,last_decision,last_decision_reason"
    )
    .eq("company_id", companyId)
    .eq("id", controlId)
    .maybeSingle<ControlRow>();

  if (error) throw new Error(error.message || "Failed to load campaign control");
  if (!data) throw new Error("Campaign control not found");
  return data;
}

export async function resolveDecisionCandidate(
  client: SupabaseClient,
  companyId: string,
  metaCampaignId: string,
  decisionId?: string,
): Promise<DecisionCandidate | null> {
  if (decisionId) {
    const { data: daily } = await client
      .from("erp_mkt_meta_scaling_decisions_daily")
      .select("id,decision_date,decision,target_budget_multiplier,decision_reason,confidence_score,entity_type,entity_id")
      .eq("company_id", companyId)
      .eq("id", decisionId)
      .maybeSingle();

    if (daily && daily.entity_type === "campaign" && String(daily.entity_id ?? "") === metaCampaignId) {
      return {
        decisionId: daily.id,
        decisionDate: daily.decision_date,
        decision: daily.decision,
        multiplier: daily.target_budget_multiplier == null ? null : Number(daily.target_budget_multiplier),
        reason: daily.decision_reason,
        confidenceScore: daily.confidence_score == null ? null : Number(daily.confidence_score),
        source: "daily",
      };
    }

    const { data: reco } = await client
      .from("erp_mkt_scaling_recommendations")
      .select("id,dt,recommendation,pct_change,reason")
      .eq("company_id", companyId)
      .eq("id", decisionId)
      .eq("campaign_id", metaCampaignId)
      .maybeSingle();

    if (reco) {
      return {
        decisionId: reco.id,
        decisionDate: reco.dt,
        decision: reco.recommendation,
        multiplier: 1 + Number(reco.pct_change ?? 0),
        reason: reco.reason,
        confidenceScore: null,
        source: "recommendation",
      };
    }
  }

  const { data: latestDaily } = await client
    .from("erp_mkt_meta_scaling_decisions_daily")
    .select("id,decision_date,decision,target_budget_multiplier,decision_reason,confidence_score")
    .eq("company_id", companyId)
    .eq("entity_type", "campaign")
    .eq("entity_id", metaCampaignId)
    .order("decision_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestDaily) {
    return {
      decisionId: latestDaily.id,
      decisionDate: latestDaily.decision_date,
      decision: latestDaily.decision,
      multiplier: latestDaily.target_budget_multiplier == null ? null : Number(latestDaily.target_budget_multiplier),
      reason: latestDaily.decision_reason,
      confidenceScore: latestDaily.confidence_score == null ? null : Number(latestDaily.confidence_score),
      source: "daily",
    };
  }

  const { data: latestReco } = await client
    .from("erp_mkt_scaling_recommendations")
    .select("id,dt,recommendation,pct_change,reason")
    .eq("company_id", companyId)
    .eq("campaign_id", metaCampaignId)
    .order("dt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestReco) return null;

  return {
    decisionId: latestReco.id,
    decisionDate: latestReco.dt,
    decision: latestReco.recommendation,
    multiplier: 1 + Number(latestReco.pct_change ?? 0),
    reason: latestReco.reason,
    confidenceScore: null,
    source: "recommendation",
  };
}
