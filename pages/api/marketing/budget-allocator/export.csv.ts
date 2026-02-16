import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type RecoRow = {
  week_start: string | null;
  scale_share: number | null;
  prospecting_share: number | null;
  retarget_share: number | null;
  scale_budget_inr: number | null;
  prospecting_budget_inr: number | null;
  retarget_budget_inr: number | null;
  drivers: Record<string, unknown> | null;
};

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function formatNotes(drivers: Record<string, unknown> | null) {
  if (!drivers) return "";
  const keys = [
    "count_scale_skus",
    "count_expand_cities",
    "total_scale_rev",
    "total_expand_rev",
    "avg_scale_conf",
    "avg_city_conf",
  ];
  return keys.map((key) => `${key}:${drivers[key] ?? 0}`).join(" | ");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<string | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req, res);
  if (!context.ok) {
    return res.status(context.status).json({ error: context.error });
  }

  const { data, error } = await context.userClient
    .from("erp_mkt_budget_allocator_reco_v1")
    .select(
      "week_start, scale_share, prospecting_share, retarget_share, scale_budget_inr, prospecting_budget_inr, retarget_budget_inr, drivers"
    )
    .eq("company_id", context.companyId)
    .maybeSingle();

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to export budget allocation" });
  }

  const row = (data ?? null) as RecoRow | null;
  const notes = formatNotes(row?.drivers ?? null);
  const csvRows = [
    ["bucket", "share", "budget_inr", "notes"],
    ["Product Push (Scale SKUs)", row?.scale_share ?? 0, row?.scale_budget_inr ?? 0, notes],
    ["Prospecting (Cities Expand)", row?.prospecting_share ?? 0, row?.prospecting_budget_inr ?? 0, notes],
    ["Retargeting", row?.retarget_share ?? 0, row?.retarget_budget_inr ?? 0, notes],
  ];

  const csv = `${csvRows.map((line) => line.map((value) => csvEscape(value)).join(",")).join("\n")}\n`;
  const filename = `budget_allocator_${row?.week_start ?? "latest"}.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.status(200).send(csv);
}
