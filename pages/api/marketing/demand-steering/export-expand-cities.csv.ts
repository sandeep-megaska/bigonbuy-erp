import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";

type Row = {
  city: string | null;
  week_start: string | null;
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
    "week_start",
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
        row.week_start,
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

function resolveExportDate(rows: Row[]) {
  const weekStart = rows[0]?.week_start;
  if (weekStart && /^\d{4}-\d{2}-\d{2}$/.test(String(weekStart))) return String(weekStart);
  return new Date().toISOString().slice(0, 10);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<string | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const supabase = createServerSupabaseClient({ req, res });
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { data: companyId, error: companyIdError } = await supabase.rpc("erp_current_company_id");
  if (companyIdError || !companyId) {
    return res.status(403).json({ error: "Company membership not found" });
  }

  const limit = parseLimit(req.query.limit);
  const { data, error } = await supabase.rpc("erp_mkt_demand_steering_export_expand_cities_v1", {
    p_company_id: companyId,
    p_limit: limit,
  });

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to export expand cities" });
  }

  const rows = (data ?? []) as Row[];
  const csv = toCsv(rows);
  const exportDate = resolveExportDate(rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="demand_steering_expand_cities_${exportDate}.csv"`);
  return res.status(200).send(csv);
}
