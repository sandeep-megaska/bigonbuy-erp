import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../lib/serverSupabase";
import { getOrderReconciliationCursor } from "../../../lib/erp/shopifyOrderContinuity";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }
  const expected = process.env.INTERNAL_ADMIN_TOKEN;
  const provided = req.headers["x-internal-token"];
  if (!expected || Array.isArray(provided) || provided !== expected) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const companyId = typeof req.query.company_id === "string" ? req.query.company_id : process.env.ERP_SERVICE_COMPANY_ID;
  if (!companyId) return res.status(400).json({ ok: false, error: "company_id is required" });
  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });

  const db = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data: latest, error } = await db
    .from("erp_shopify_orders")
    .select("shopify_order_id,order_created_at,updated_at,raw_order")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const raw = (latest?.raw_order as Record<string, unknown> | null) || {};
  const shopifyUpdatedAt = typeof raw.updated_at === "string" ? raw.updated_at : null;
  const freshnessBase = shopifyUpdatedAt || latest?.updated_at || null;
  const ageMinutes = freshnessBase ? Math.max(0, Math.round((Date.now() - Date.parse(freshnessBase)) / 60000)) : null;
  const cursor = await getOrderReconciliationCursor(db, companyId);

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    company_id: companyId,
    latest_order_id: latest?.shopify_order_id ?? null,
    latest_order_created_at: latest?.order_created_at ?? null,
    latest_shopify_updated_at: shopifyUpdatedAt,
    mirror_updated_at: latest?.updated_at ?? null,
    freshness_age_minutes: ageMinutes,
    reconciliation_cursor: cursor,
    status: ageMinutes === null ? "EMPTY" : ageMinutes <= 45 ? "HEALTHY" : ageMinutes <= 180 ? "STALE" : "DEGRADED",
  });
}
