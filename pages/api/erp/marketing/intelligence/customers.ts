import type { NextApiRequest, NextApiResponse } from "next";
import { parseLimitParam, resolveMarketingApiContext } from "../../../../../lib/erp/marketing/intelligenceApi";

type ApiResponse = { ok: true; data: unknown } | { ok: false; error: string; details?: string | null };

const ALLOWED_SORTS = new Set([
  "ltv",
  "orders_count",
  "aov",
  "last_order_at",
  "days_since_last_order",
  "repeat_probability",
  "churn_risk",
  "updated_at",
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  const rawSort = typeof req.query.sort === "string" ? req.query.sort : "ltv";
  const sort = ALLOWED_SORTS.has(rawSort) ? rawSort : "ltv";
  const limit = parseLimitParam(req.query.limit, 100);

  const { data, error } = await context.userClient
    .from("erp_mkt_customer_scores")
    .select("*")
    .eq("company_id", context.companyId)
    .order(sort, { ascending: false, nullsFirst: false })
    .limit(limit);

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load customer intelligence" });
  }

  return res.status(200).json({ ok: true, data: data ?? [] });
}
