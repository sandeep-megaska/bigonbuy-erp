import type { NextApiRequest, NextApiResponse } from "next";
import { requireErpUser } from "../../../../lib/erp/requireErpUser";

type AudienceCsvRow = {
  email: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  source: string | null;
  last_event_at: string | null;
};

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (text.includes('"') || text.includes(",") || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: AudienceCsvRow[]) {
  const headers = ["email", "phone", "city", "state", "zip", "country", "source", "last_event_at"];
  const lines = [headers.map((x) => csvEscape(x)).join(",")];
  for (const row of rows) {
    lines.push(
      [row.email, row.phone, row.city, row.state, row.zip, row.country, row.source, row.last_event_at]
        .map((x) => csvEscape(x))
        .join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

function parseLimit(raw: string | string[] | undefined) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 50000;
  return Math.min(parsed, 100000);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<string | { error: string }>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireErpUser(req, res);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  const { data, error } = await auth.supabase.rpc("erp_mkt_audience_export_purchasers_180d_v1", {
    p_limit: parseLimit(req.query.limit),
  });

  if (error) {
    return res.status(400).json({ error: error.message || "Failed to export purchasers audience" });
  }

  const csv = toCsv((data ?? []) as AudienceCsvRow[]);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="meta_audience_purchasers_180d.csv"');
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).send(csv);
}
