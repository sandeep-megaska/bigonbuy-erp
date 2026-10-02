import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSupabaseEnv } from "../../../lib/serverSupabase";

type ResponseBody =
  | { ok: true; health: unknown; orders: unknown[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ResponseBody>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const expectedToken = process.env.INTERNAL_ADMIN_TOKEN;
  const providedToken = req.headers["x-internal-token"];
  if (!expectedToken || Array.isArray(providedToken) || providedToken !== expectedToken) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const companyId = typeof req.query.company_id === "string"
    ? req.query.company_id
    : process.env.ERP_SERVICE_COMPANY_ID;
  if (!companyId) {
    return res.status(400).json({ ok: false, error: "company_id is required" });
  }

  const daysRaw = typeof req.query.days === "string" ? Number(req.query.days) : 7;
  const days = Number.isFinite(daysRaw) ? Math.max(1, Math.min(Math.floor(daysRaw), 90)) : 7;
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 100;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 100;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  const db = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const [health, orders] = await Promise.all([
    db.rpc("erp_mkt_capi_purchase_health_v1", { p_company_id: companyId, p_since: since }),
    db.rpc("erp_mkt_capi_purchase_reconciliation_v1", {
      p_company_id: companyId,
      p_since: since,
      p_limit: limit,
    }),
  ]);

  if (health.error) return res.status(500).json({ ok: false, error: health.error.message });
  if (orders.error) return res.status(500).json({ ok: false, error: orders.error.message });

  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({
    ok: true,
    health: health.data ?? null,
    orders: Array.isArray(orders.data) ? orders.data : [],
  });
}
