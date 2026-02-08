import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getSupabaseEnv } from "../../../../../../lib/serverSupabase";
import { resolveInternalApiAuth } from "../../../../../../lib/erp/internalApiAuth";

type Resp = { ok: boolean; data?: { reversal_id: string }; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await resolveInternalApiAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const batchId = String(req.query.batchId || "").trim();
  const reason = req.body?.reason == null ? null : String(req.body.reason);
  const clientReverseId = String(req.body?.clientReverseId || "").trim();

  if (!batchId || !clientReverseId) {
    return res.status(400).json({ ok: false, error: "batchId and clientReverseId are required" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, auth.token);
  const { data, error } = await userClient.rpc("erp_mfg_stage_consumption_reverse_v1", {
    p_consumption_batch_id: batchId,
    p_actor_user_id: auth.userId,
    p_reason: reason,
    p_client_reverse_id: clientReverseId,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to reverse consumption" });
  return res.status(200).json({ ok: true, data: { reversal_id: String(data) } });
}
