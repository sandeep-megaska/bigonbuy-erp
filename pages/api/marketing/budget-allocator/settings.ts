import type { NextApiRequest, NextApiResponse } from "next";
import { resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type ApiResponse =
  | {
      ok: true;
      settings: {
        weekly_budget_inr: number;
        min_retargeting_share: number;
        max_prospecting_share: number;
      };
    }
  | { ok: false; error: string };

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  const weekly_budget_inr = Math.max(0, toNumber(req.body?.weekly_budget_inr, 0));
  const min_retargeting_share = Math.min(1, Math.max(0, toNumber(req.body?.min_retargeting_share, 0.2)));
  const max_prospecting_share = Math.min(1, Math.max(0, toNumber(req.body?.max_prospecting_share, 0.6)));

  const { data, error } = await context.userClient
    .from("erp_mkt_budget_allocator_settings")
    .upsert(
      {
        company_id: context.companyId,
        weekly_budget_inr,
        min_retargeting_share,
        max_prospecting_share,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" }
    )
    .select("weekly_budget_inr, min_retargeting_share, max_prospecting_share")
    .single();

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to save settings" });
  }

  return res.status(200).json({
    ok: true,
    settings: {
      weekly_budget_inr: Number(data.weekly_budget_inr ?? 0),
      min_retargeting_share: Number(data.min_retargeting_share ?? 0.2),
      max_prospecting_share: Number(data.max_prospecting_share ?? 0.6),
    },
  });
}
