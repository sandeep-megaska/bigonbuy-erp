import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { resolveInternalApiAuth } from "../../../../../lib/erp/internalApiAuth";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await resolveInternalApiAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const stageEventId = String(req.query.stageEventId || "").trim();
  const reason = req.body?.reason == null ? null : String(req.body.reason);
  if (!stageEventId) return res.status(400).json({ ok: false, error: "stageEventId is required" });

  const userClient = createUserClient(supabaseUrl, anonKey, auth.token);
  const { data, error } = await userClient.rpc("erp_mfg_stage_consumption_post_v1", {
    p_stage_event_id: stageEventId,
    p_actor_user_id: auth.userId,
    p_reason: reason,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to post consumption" });
  const row = Array.isArray(data) ? data[0] : data;
  return res.status(200).json({ ok: true, data: row ?? null });
}
