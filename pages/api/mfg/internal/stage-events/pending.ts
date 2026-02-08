import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { resolveInternalApiAuth } from "../../../../../lib/erp/internalApiAuth";

type Resp = { ok: boolean; data?: { items: any[] }; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await resolveInternalApiAuth(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const userClient = createUserClient(supabaseUrl, anonKey, auth.token);
  const vendorId = String(req.query.vendor_id || "").trim() || null;
  const limit = Number(req.query.limit || 100);

  const { data, error } = await userClient.rpc("erp_mfg_cutting_stage_events_pending_list_v1", {
    p_company_id: auth.companyId,
    p_vendor_id: vendorId,
    p_limit: Number.isNaN(limit) ? 100 : limit,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to load pending stage events" });
  return res.status(200).json({ ok: true, data: { items: Array.isArray(data) ? data : [] } });
}
