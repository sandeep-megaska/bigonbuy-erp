import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";

type OkResp = {
  company_id: string;
  refreshed_at: string;
  snapshot: any;
};

type ErrResp = { error: string; [k: string]: any };

export default async function handler(req: NextApiRequest, res: NextApiResponse<OkResp | ErrResp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const supabase = createServerSupabaseClient({ req, res });

  // Auth guard (cookie/session based, same style as your marketing endpoints)
  const { data: userResp, error: userErr } = await supabase.auth.getUser();
  if (userErr) return res.status(500).json({ error: userErr.message });
  if (!userResp?.user) return res.status(401).json({ error: "Unauthorized" });

  // Company scope via canonical ERP resolver
  const { data: companyId, error: companyErr } = await supabase.rpc("erp_current_company_id");
  if (companyErr) return res.status(500).json({ error: companyErr.message });
  if (!companyId) return res.status(400).json({ error: "Could not resolve company_id" });

  // Read snapshot MV created in migration 0485
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
