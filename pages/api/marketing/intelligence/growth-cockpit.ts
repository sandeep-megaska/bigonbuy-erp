import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type ApiResponse =
  | { company_id: string; refreshed_at: string | null; snapshot: unknown }
  | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }

  const { data, error } = await context.userClient
    .from("erp_growth_cockpit_snapshot_mv")
    .select("company_id, refreshed_at, snapshot")
    .eq("company_id", context.companyId)
    .maybeSingle();

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to load growth cockpit snapshot" });
  }

  if (!data) {
    return res.status(404).json({ error: "Growth cockpit snapshot not found for company" });
  }

  return res.status(200).json({
    company_id: String(data.company_id),
    refreshed_at: data.refreshed_at ?? null,
    snapshot: data.snapshot ?? {},
  });
}
