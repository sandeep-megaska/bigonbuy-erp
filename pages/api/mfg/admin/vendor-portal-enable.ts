// pages/api/mfg/admin/vendor-portal-enable.ts
// pages/api/mfg/admin/vendor-portal-enable.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const supabase = createServerSupabaseClient({ req, res });

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const vendor_id = typeof req.body?.vendor_id === "string" ? req.body.vendor_id : "";
  if (!vendor_id) return res.status(400).json({ ok: false, error: "vendor_id is required" });

  const { data: companyId, error: companyErr } = await supabase.rpc("erp_current_company_id");
  if (companyErr || !companyId) return res.status(400).json({ ok: false, error: companyErr?.message || "No company" });

  // membership check
  const { data: membership, error: memErr } = await supabase
    .from("erp_company_users")
    .select("role_key")
    .eq("company_id", companyId)
    .eq("user_id", userRes.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (memErr) return res.status(500).json({ ok: false, error: memErr.message });
  if (!membership || !["owner", "admin"].includes(membership.role_key || "")) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  const { data, error } = await supabase.rpc("erp_vendor_portal_enable_v2", {
    p_vendor_id: vendor_id,
    p_company_id: companyId,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message, details: error.details || error.hint });

  return res.status(200).json({ ok: true, data });
}
