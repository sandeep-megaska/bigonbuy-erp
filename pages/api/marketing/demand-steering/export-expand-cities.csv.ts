import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type ExpandCityCsvRow = {
  city: string | null;
  orders_30d: number | null;
  revenue_30d: number | null;
  orders_prev_30d: number | null;
  revenue_prev_30d: number | null;
  growth_rate: number | null;
  demand_score: number | null;
  decision: string | null;
  confidence_score: number | null;
  recommended_pct_change: number | null;
  guardrail_tags: string[] | null;
  week_start: string | null;
};

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers: string[], rows: ExpandCityCsvRow[]) {
  const lines = [headers.map((x) => csvEscape(x)).join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.city,
        row.orders_30d,
        row.revenue_30d,
        row.orders_prev_30d,
        row.revenue_prev_30d,
        row.growth_rate,
        row.demand_score,
        row.decision,
        row.confidence_score,
        row.recommended_pct_change,
        (row.guardrail_tags ?? []).join('|'),
        row.week_start,
      ]
        .map((x) => csvEscape(x))
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<string | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }

  const { data, error } = await context.userClient
    .from("erp_mkt_city_demand_latest_v1")
    .select(
      "city, orders_30d, revenue_30d, orders_prev_30d, revenue_prev_30d, growth_rate, demand_score, decision, confidence_score, recommended_pct_change, guardrail_tags, week_start"
    )
    .eq("decision", "EXPAND")
    .order("demand_score", { ascending: false })
    .limit(300);

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to export expand cities" });
  }

  const rows = (data ?? []) as ExpandCityCsvRow[];
  const weekStart = rows[0]?.week_start ?? "latest";
  const filename = `demand_steering_expand_cities_${weekStart}.csv`;

  const csv = toCsv(
    [
      "city",
      "orders_30d",
      "revenue_30d",
      "orders_prev_30d",
      "revenue_prev_30d",
      "growth_rate",
      "demand_score",
      "decision",
      "confidence_score",
      "recommended_pct_change",
      "guardrail_tags",
      "week_start",
    ],
    rows
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(csv);
}
