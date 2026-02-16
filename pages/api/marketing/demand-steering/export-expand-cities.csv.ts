import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type Row = {
  city: string | null;
  orders_30d: number | null;
  revenue_30d: number | null;
  growth_rate: number | null;
  demand_score: number | null;
  confidence_score: number | null;
  recommended_pct_change: number | null;
  guardrail_tags: string[] | null;
};

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: Row[]) {
  const headers = [
    "city",
    "orders_30d",
    "revenue_30d",
    "growth_rate",
    "demand_score",
    "confidence_score",
    "recommended_pct_change",
    "guardrail_tags",
  ];
  const lines = [headers.map((x) => csvEscape(x)).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.city,
        row.orders_30d,
        row.revenue_30d,
        row.growth_rate,
        row.demand_score,
        row.confidence_score,
        row.recommended_pct_change,
        (row.guardrail_tags ?? []).join("|"),
      ]
        .map((x) => csvEscape(x))
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseLimit(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return 50000;
  return Math.min(n, 100000);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<string | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Intentionally use cookie-session auth so browser CSV downloads work without bearer-token-only flows.
  const supabase = createServerSupabaseClient({ req, res });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const context = await resolveMarketingApiContext(req, res);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }

  const limit = parseLimit(req.query.limit);
  const { data, error } = await context.userClient
    .from("erp_mkt_city_demand_latest_v1")
    .select("city,orders_30d,revenue_30d,growth_rate,demand_score,confidence_score,recommended_pct_change,guardrail_tags")
    .eq("company_id", context.companyId)
    .eq("decision", "EXPAND")
    .order("demand_score", { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to export expand cities" });
  }

  const csv = toCsv((data ?? []) as Row[]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="demand_steering_expand_cities.csv"');
  return res.status(200).send(csv);
}
