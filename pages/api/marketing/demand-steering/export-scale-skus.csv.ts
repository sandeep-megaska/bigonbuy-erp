import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { createUserClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type Row = {
  sku: string | null;
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
    "sku",
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
        row.sku,
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

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const supabase = createServerSupabaseClient({ req, res });
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { data: companyId, error: companyIdError } = await supabase.rpc("erp_current_company_id");
  if (companyIdError || !companyId) {
    return res.status(403).json({ error: "Company membership not found" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, session.access_token);
  const limit = parseLimit(req.query.limit);

  const { data, error } = await userClient
    .from("erp_mkt_sku_demand_latest_v1")
    .select(
      "sku,week_start,orders_30d,revenue_30d,growth_rate,demand_score,confidence_score,recommended_pct_change,guardrail_tags"
    )
    .eq("company_id", String(companyId))
    .eq("decision", "SCALE")
    .order("demand_score", { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to export scale SKUs" });
  }

  const rows = (data ?? []) as Row[];
  const csv = toCsv(rows);
  const exportDate = resolveExportDate(rows);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="demand_steering_scale_skus_${exportDate}.csv"`);
  return res.status(200).send(csv);
}
