import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const supabase = createServerSupabaseClient({ req, res });

  // auth (same style as your other marketing endpoints)
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr) return res.status(500).json({ error: userErr.message });
  if (!userResp?.user) return res.status(401).json({ error: "Unauthorized" });

  // company scope (canonical ERP contract)
  const { data: companyId, error: companyErr } = await supabase.rpc("erp_current_company_id");
  if (companyErr) return res.status(500).json({ error: companyErr.message });
  if (!companyId) return res.status(400).json({ error: "Could not resolve company_id" });

  // read snapshot MV (0485)
  const { data, error } = await supabase
    .from("erp_growth_cockpit_snapshot_mv")
    .select("company_id, refreshed_at, snapshot")
    .eq("company_id", companyId)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  if (!data) {
    return res.status(404).json({
      error: "Growth cockpit snapshot not found for company",
      company_id: companyId,
      hint: "Run: select public.erp_growth_cockpit_snapshot_refresh_v1();",
    });
  }

  return res.status(200).json({
    company_id: data.company_id,
    refreshed_at: data.refreshed_at,
    snapshot: data.snapshot,
  });
}
