import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<string | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const context = await resolveMarketingApiContext(req);
  if (!context.ok) return res.status(context.status).json({ error: context.error });

  const { data, error } = await context.userClient
    .from("erp_mkt_activation_expand_cities_v1")
    .select("week_start, city, demand_score, confidence_score, recommended_pct_change")
    .eq("company_id", context.companyId)
    .order("demand_score", { ascending: false })
    .limit(200);

  if (error) return res.status(400).json({ error: error.message || "Failed to export expand cities" });

  const lines = ["week_start,city,demand_score,confidence_score,recommended_pct_change"];
  for (const row of data ?? []) {
    lines.push([row.week_start, row.city, row.demand_score, row.confidence_score, row.recommended_pct_change].map((x) => csvEscape(x)).join(","));
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="activation_expand_cities_${data?.[0]?.week_start ?? "latest"}.csv"`);
  return res.status(200).send(`${lines.join("\n")}\n`);
}
