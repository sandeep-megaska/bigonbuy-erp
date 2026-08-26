import type { NextApiRequest, NextApiResponse } from "next";
import { OWNER_ADMIN_ROLE_KEYS, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";
import { insertActionLog, loadControlRow, resolveDecisionCandidate } from "../../../../lib/erp/marketing/campaignControlApi";

type ApiResponse =
  | { ok: true; action: "reject" | "snooze" }
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
    return res.status(403).json({ ok: false, error: "Only owner/admin can perform this action" });
  }

  const controlId = String(req.body?.control_id ?? "").trim();
  const decisionId = String(req.body?.decision_id ?? "").trim() || undefined;
  const action = String(req.body?.action ?? "").trim() as "reject" | "snooze";
  const note = String(req.body?.note ?? "").trim() || null;

  if (!controlId || !["reject", "snooze"].includes(action)) {
    return res.status(400).json({ ok: false, error: "Invalid input" });
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
  const decision = metaCampaignId
    ? await resolveDecisionCandidate(context.serviceClient, context.companyId, metaCampaignId, decisionId)
    : null;

  await insertActionLog(context.serviceClient, {
    company_id: context.companyId,
    control_id: control.id,
    meta_campaign_id: metaCampaignId || "unknown",
    entity_type: "campaign",
    entity_id: metaCampaignId || null,
    action_type: action,
    action_status: action === "reject" ? "rejected" : "snoozed",
    decision_date: decision?.decisionDate ?? null,
    decision_id: decision?.decisionId ?? null,
    old_budget: control.current_budget,
    new_budget: control.current_budget,
    budget_multiplier: decision?.multiplier ?? null,
    decision_reason: note ?? decision?.reason ?? null,
    confidence_score: decision?.confidenceScore ?? null,
    actor_user_id: context.userId,
    actor_email: actorEmail,
    request_payload: {
      control_id: controlId,
      decision_id: decisionId ?? null,
      action,
      note,
    },
    response_payload: {},
    error_message: null,
  });

  return res.status(200).json({ ok: true, action });
}
