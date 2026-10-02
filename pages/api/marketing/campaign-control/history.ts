import type { NextApiRequest, NextApiResponse } from "next";
import { parseLimitParam, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

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

  const limit = parseLimitParam(req.query.limit, 100);
  const { data, error } = await context.serviceClient
    .from("erp_mkt_meta_campaign_actions_log")
    .select(
      "id,control_id,meta_campaign_id,action_type,action_status,decision_date,decision_id,old_budget,new_budget,budget_multiplier,decision_reason,confidence_score,actor_email,error_message,created_at,applied_at"
    )
    .eq("company_id", context.companyId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load action history" });
  }

  return res.status(200).json({ ok: true, rows: data ?? [] });
}
