import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../../lib/mfgCookies";

type Resp = { ok: boolean; data?: { stage_event_id: string }; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const poLineId = String(req.query.poLineId || "").trim();
  const stageCode = String(req.body?.stageCode || "").trim();
  const completedQtyAbs = Number(req.body?.completedQtyAbs);
  const note = req.body?.note == null ? null : String(req.body.note);
  const clientEventId = String(req.body?.clientEventId || "").trim();
  const sessionToken = (getCookieLast(req, "mfg_session") || "").trim();

  if (!sessionToken) return res.status(401).json({ ok: false, error: "Not authenticated" });
  if (!poLineId || !stageCode || Number.isNaN(completedQtyAbs) || !clientEventId) {
    return res.status(400).json({ ok: false, error: "poLineId, stageCode, completedQtyAbs, and clientEventId are required" });
  }

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("erp_mfg_po_line_stage_post_v1", {
    p_session_token: sessionToken,
    p_po_line_id: poLineId,
    p_stage_code: stageCode,
    p_completed_qty_abs: completedQtyAbs,
    p_event_note: note,
    p_client_event_id: clientEventId,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to post stage event" });
  return res.status(200).json({ ok: true, data: { stage_event_id: String(data) } });
}
