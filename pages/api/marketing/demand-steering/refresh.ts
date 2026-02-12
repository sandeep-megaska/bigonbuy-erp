import type { NextApiRequest, NextApiResponse } from "next";
import {
  OWNER_ADMIN_ROLE_KEYS,
  parseDateParam,
  resolveMarketingApiContext,
} from "../../../../lib/erp/marketing/intelligenceApi";

type ApiResponse =
  | { ok: true; sku_rows: number; city_rows: number; week_start: string | null }
  | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const context = await resolveMarketingApiContext(req);
  if (!context.ok) {
    return res.status(context.status).json({ ok: false, error: context.error });
  }

  if (!OWNER_ADMIN_ROLE_KEYS.has(context.roleKey)) {
    return res.status(403).json({ ok: false, error: "Only owner/admin can refresh demand steering" });
  }

  const weekStart = parseDateParam(req.body?.week_start as string | undefined);

  const { data, error } = await context.userClient.rpc("erp_mkt_demand_steering_refresh_v1", {
    p_week_start: weekStart,
  });

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Failed to refresh demand steering",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({
    ok: true,
    week_start: data?.week_start ? String(data.week_start) : null,
    sku_rows: Number(data?.sku_rows ?? 0),
    city_rows: Number(data?.city_rows ?? 0),
  });
}
