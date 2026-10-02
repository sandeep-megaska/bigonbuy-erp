import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../lib/serverSupabase";
import { reconcileShopifyOrders } from "../../../lib/erp/shopifyOrderContinuity";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }

  const cronSecret = process.env.CRON_SECRET;
  const auth = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const companyId = process.env.ERP_SERVICE_COMPANY_ID;
  if (!companyId) return res.status(500).json({ ok: false, error: "Missing ERP_SERVICE_COMPANY_ID" });

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });

  try {
    const db = createServiceRoleClient(supabaseUrl, serviceRoleKey);
    const result = await reconcileShopifyOrders(db, companyId);
    res.setHeader("Cache-Control", "no-store");
    return res.status(result.errors.length ? 207 : 200).json({ ok: result.errors.length === 0, company_id: companyId, reconciled_at: new Date().toISOString(), ...result });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Shopify reconciliation failed" });
  }
}
