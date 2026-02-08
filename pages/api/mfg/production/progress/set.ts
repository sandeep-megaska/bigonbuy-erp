import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { getVendorSessionFromRequest } from "../../../../../lib/mfg/vendorSession";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await getVendorSessionFromRequest(req);
  if (!auth.session) return res.status(auth.status).json({ ok: false, error: auth.error || "Not authenticated" });

  const { po_id, po_line_id, checkpoint_id, qty_done, notes } = req.body ?? {};
  if (!po_id || !po_line_id || !checkpoint_id) {
    return res.status(400).json({ ok: false, error: "po_id, po_line_id, checkpoint_id are required" });
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
    p_qty_done: Number(qty_done ?? 0),
    p_notes: notes ?? null,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to save progress" });
  return res.status(200).json({ ok: true, data: data ?? null });
}
