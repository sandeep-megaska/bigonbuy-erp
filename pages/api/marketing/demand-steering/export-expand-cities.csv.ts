import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";

type Row = {
  city: string | null;
  state: string | null;
  week_start: string | null;
  demand_score: number | null;
  confidence_score: number | null;
  recommended_pct_change: number | null;
  reason: string | null;
};

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function toCsv(rows: Row[]) {
  const headers = ["city", "state", "week_start", "demand_score", "confidence_score", "recommended_pct_change", "reason"];
  const lines = [headers.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(
      [r.city, r.state, r.week_start, r.demand_score, r.confidence_score, r.recommended_pct_change, r.reason]
        .map(csvEscape)
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

function readCookie(req: NextApiRequest, name: string): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const parts = cookie.split(";").map((p) => p.trim());
  const hit = parts.find((p) => p.toLowerCase().startsWith(name.toLowerCase() + "="));
  if (!hit) return null;
  return decodeURIComponent(hit.substring(name.length + 1));
}

function resolveCompanyId(req: NextApiRequest): string | null {
  const h = req.headers["x-erp-company-id"];
  if (typeof h === "string" && h) return h;
  return readCookie(req, "erp_company_id") || readCookie(req, "bb_company_id") || readCookie(req, "company_id") || null;
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

  const supabase = createServerSupabaseClient({ req, res });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.id) return res.status(401).json({ error: "Not authenticated" });

  const companyId = resolveCompanyId(req);
  if (!companyId) return res.status(400).json({ error: "Missing company context" });

  const limit = parseLimit(req.query.limit);

  // NOTE: keep the table/view name exactly as your UI expects.
  // If your actual view is named differently, change ONLY this string.
  const { data, error } = await supabase
    .from("erp_mkt_demand_steering_expand_cities_v1")
    .select("city,state,week_start,demand_score,confidence_score,recommended_pct_change,reason")
    .eq("company_id", companyId)
    .order("demand_score", { ascending: false })
    .limit(limit);

  if (error) return res.status(400).json({ error: error.message || "Failed to export Expand Cities" });

  const csv = toCsv((data ?? []) as Row[]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="demand_steering_expand_cities.csv"');
  return res.status(200).send(csv);
}
