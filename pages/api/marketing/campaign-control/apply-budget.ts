import type { NextApiRequest, NextApiResponse } from "next";
import { OWNER_ADMIN_ROLE_KEYS, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";
import {
  APPLY_COOLDOWN_HOURS,
  computeBudget,
  computeDeltaPct,
  hoursSince,
  insertActionLog,
  loadControlRow,
  resolveDecisionCandidate,
} from "../../../../lib/erp/marketing/campaignControlApi";
import { updateMetaCampaignBudget } from "../../../../lib/erp/marketing/metaBudgetControl";

type ApiResponse =
  | { ok: true; control_id: string; old_budget: number; new_budget: number; action_log_status: string; meta_response: any }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req, res);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  if (!OWNER_ADMIN_ROLE_KEYS.has(context.roleKey)) {
    return res.status(403).json({ ok: false, error: "Only owner/admin can apply budgets" });
  }

  const controlId = String(req.body?.control_id ?? "").trim();
  const decisionId = String(req.body?.decision_id ?? "").trim() || undefined;
  const action = String(req.body?.action ?? "approve").trim();
  const overrideBudgetRaw = req.body?.override_budget;
  const overrideBudget = overrideBudgetRaw == null || overrideBudgetRaw === "" ? null : Number(overrideBudgetRaw);

  if (!controlId || action !== "approve") {
    return res.status(400).json({ ok: false, error: "Invalid input: control_id and action=approve are required" });
  }

  const actor = await context.userClient.auth.getUser();
  const actorEmail = actor.data.user?.email ?? null;

  let control;
  try {
    control = await loadControlRow(context.serviceClient, context.companyId, controlId);
  } catch (error: any) {
    return res.status(404).json({ ok: false, error: error?.message || "Control not found" });
  }

  const metaCampaignId = String(control.meta_campaign_id ?? "");
  const currentBudget = control.current_budget == null ? null : Number(control.current_budget);
  const requestPayload = {
    action,
    control_id: controlId,
    decision_id: decisionId ?? null,
    override_budget: overrideBudget,
  };

  const fail = async (message: string, decision: any = null) => {
    await insertActionLog(context.serviceClient, {
      company_id: context.companyId,
      control_id: control.id,
      meta_campaign_id: metaCampaignId,
      entity_type: "campaign",
      entity_id: metaCampaignId,
      action_type: "approve",
      action_status: "failed",
      decision_date: decision?.decisionDate ?? null,
      decision_id: decision?.decisionId ?? null,
      old_budget: currentBudget,
      new_budget: null,
      budget_multiplier: decision?.multiplier ?? null,
      decision_reason: decision?.reason ?? null,
      confidence_score: decision?.confidenceScore ?? null,
      actor_user_id: context.userId,
      actor_email: actorEmail,
      request_payload: requestPayload,
      response_payload: {},
      error_message: message,
    });
    return res.status(400).json({ ok: false, error: message });
  };

  if (!metaCampaignId) return fail("Control row has no meta_campaign_id");
  if (control.status !== "active") return fail("Campaign control status is not active");
  if (!control.automation_enabled) return fail("Automation is disabled for this control row");
  if (currentBudget == null || currentBudget <= 0) return fail("Current budget is missing or invalid");
  if (hoursSince(control.last_adjusted_at) < APPLY_COOLDOWN_HOURS) return fail("Budget apply cooldown active (24h)");

  const decision = await resolveDecisionCandidate(context.serviceClient, context.companyId, metaCampaignId, decisionId);
  if (!decision) return fail("No applicable scaling decision found for campaign");
  if (decision.multiplier == null || !Number.isFinite(decision.multiplier) || decision.multiplier <= 0) {
    return fail("Decision multiplier must be > 0", decision);
  }

  if (overrideBudget != null && (!Number.isFinite(overrideBudget) || overrideBudget <= 0)) {
    return fail("override_budget must be > 0", decision);
  }

  const newBudget = computeBudget(currentBudget, decision.multiplier, overrideBudget);
  if (!Number.isFinite(newBudget) || newBudget <= 0) return fail("Computed new budget must be > 0", decision);

  if (control.min_budget != null && newBudget < Number(control.min_budget)) {
    return fail(`Computed budget below min_budget (${control.min_budget})`, decision);
  }
  if (control.max_budget != null && newBudget > Number(control.max_budget)) {
    return fail(`Computed budget above max_budget (${control.max_budget})`, decision);
  }

  const deltaPct = computeDeltaPct(currentBudget, newBudget);
  if (deltaPct != null && control.scale_up_pct != null && deltaPct > Number(control.scale_up_pct)) {
    return fail(`Scale-up delta exceeds configured scale_up_pct (${control.scale_up_pct})`, decision);
  }
  if (deltaPct != null && control.scale_down_pct != null && deltaPct < -Number(control.scale_down_pct)) {
    return fail(`Scale-down delta exceeds configured scale_down_pct (${control.scale_down_pct})`, decision);
  }

  const { data: settings, error: settingsError } = await context.serviceClient
    .from("erp_mkt_settings")
    .select("meta_access_token")
    .eq("company_id", context.companyId)
    .maybeSingle();

  if (settingsError) return fail(settingsError.message || "Failed to load Meta settings", decision);
  const accessToken = settings?.meta_access_token ?? null;
  if (!accessToken) return fail("Meta access token is missing", decision);

  const metaResponse = await updateMetaCampaignBudget({
    metaCampaignId,
    accessToken,
    newBudget,
  });

  const status = metaResponse.ok ? "applied" : "failed";
  const errorMessage = metaResponse.ok ? null : metaResponse.body?.error?.message ?? `Meta API failed (${metaResponse.status})`;

  await insertActionLog(context.serviceClient, {
    company_id: context.companyId,
    control_id: control.id,
    meta_campaign_id: metaCampaignId,
    entity_type: "campaign",
    entity_id: metaCampaignId,
    action_type: "approve",
    action_status: status,
    decision_date: decision.decisionDate,
    decision_id: decision.decisionId,
    old_budget: currentBudget,
    new_budget: newBudget,
    budget_multiplier: decision.multiplier,
    decision_reason: decision.reason,
    confidence_score: decision.confidenceScore,
    actor_user_id: context.userId,
    actor_email: actorEmail,
    request_payload: requestPayload,
    response_payload: metaResponse.body ?? {},
    error_message: errorMessage,
    applied_at: metaResponse.ok ? new Date().toISOString() : null,
  });

  if (!metaResponse.ok) {
    return res.status(400).json({ ok: false, error: errorMessage || "Meta API error" });
  }

  const { error: updateError } = await context.serviceClient
    .from("erp_mkt_meta_campaign_control")
    .update({
      current_budget: newBudget,
      last_adjusted_at: new Date().toISOString(),
      last_decision: decision.decision,
      last_decision_reason: decision.reason,
      last_meta_sync_at: new Date().toISOString(),
    })
    .eq("company_id", context.companyId)
    .eq("id", control.id);

  if (updateError) {
    return res.status(400).json({ ok: false, error: updateError.message || "Meta update succeeded but local state update failed" });
  }

  return res.status(200).json({
    ok: true,
    control_id: control.id,
    old_budget: currentBudget,
    new_budget: newBudget,
    action_log_status: status,
    meta_response: metaResponse.body,
  });
}
