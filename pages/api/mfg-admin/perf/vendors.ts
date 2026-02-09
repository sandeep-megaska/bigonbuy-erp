import type { NextApiRequest, NextApiResponse } from "next";
import { requireManager } from "../../../../lib/erpAuth";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireManager(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const days = Math.max(Number(req.query.days || 30), 1);
  const { data, error } = await auth.userClient.rpc("erp_mfg_erp_vendor_scorecard_v1", {
    p_days: days,
  });

  if (error) {
    return res.status(400).json({ ok: false, error: error.message || "Failed to load scorecard" });
  }

  return res.status(200).json({ ok: true, data: { rows: data || [] } });
}
