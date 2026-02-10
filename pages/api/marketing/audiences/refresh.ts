import type { NextApiRequest, NextApiResponse } from "next";
import { OWNER_ADMIN_ROLE_KEYS, resolveMarketingApiContext } from "../../../../lib/erp/marketing/intelligenceApi";

type ApiResponse = { ok: true; data: unknown } | { ok: false; error: string; details?: string | null };

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
    return res.status(403).json({ ok: false, error: "Only owner/admin can refresh audiences" });
  }

  const audienceCode =
    typeof req.body?.audienceCode === "string" && req.body.audienceCode.trim().length > 0
      ? req.body.audienceCode.trim()
      : null;

  const { data, error } = await context.userClient.rpc("erp_mkt_audiences_refresh_v1", {
    p_actor_user_id: context.userId,
    p_audience_code: audienceCode,
  });

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Failed to refresh audiences",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({ ok: true, data: data ?? {} });
}
