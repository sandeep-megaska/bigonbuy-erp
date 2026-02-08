import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { getVendorSessionFromRequest } from "../../../../lib/mfg/vendorSession";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await getVendorSessionFromRequest(req);
  if (!auth.session) return res.status(auth.status).json({ ok: false, error: auth.error || "Not authenticated" });

  const po_id = String(req.body?.po_id || "").trim();
  const po_line_id = String(req.body?.po_line_id || "").trim();
  const checkpoint_id = String(req.body?.checkpoint_id || "").trim();
  const qty_done = Number(req.body?.qty_done);
  const notes = req.body?.notes == null ? null : String(req.body.notes);

  if (!po_id || !po_line_id || !checkpoint_id || Number.isNaN(qty_done)) {
    return res.status(400).json({ ok: false, error: "po_id, po_line_id, checkpoint_id and qty_done are required" });
  }

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc("erp_mfg_po_line_checkpoint_progress_set_v1", {
    p_company_id: auth.session.company_id,
    p_vendor_id: auth.session.vendor_id,
    p_po_id: po_id,
    p_po_line_id: po_line_id,
    p_checkpoint_id: checkpoint_id,
    p_qty_done: qty_done,
    p_notes: notes,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to save progress" });
  return res.status(200).json({ ok: true, data });
}
