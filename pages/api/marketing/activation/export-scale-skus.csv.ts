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
  const context = await resolveMarketingApiContext(req, res);
  if (!context.ok) return res.status(context.status).json({ error: context.error });

  const { data, error } = await context.userClient
    .from("erp_mkt_activation_scale_skus_v1")
    .select("week_start, sku, demand_score, confidence_score, recommended_pct_change, guardrail_tags")
    .eq("company_id", context.companyId)
    .order("demand_score", { ascending: false })
    .limit(200);

  if (error) return res.status(400).json({ error: error.message || "Failed to export scale SKUs" });

  const lines = ["week_start,sku,demand_score,confidence_score,recommended_pct_change,guardrail_tags"];
  for (const row of data ?? []) {
    lines.push(
      [
        row.week_start,
        row.sku,
        row.demand_score,
        row.confidence_score,
        row.recommended_pct_change,
        (row.guardrail_tags ?? []).join("|"),
      ]
        .map((x) => csvEscape(x))
        .join(",")
    );
  }

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="activation_scale_skus_${data?.[0]?.week_start ?? "latest"}.csv"`);
  return res.status(200).send(`${lines.join("\n")}\n`);
}
