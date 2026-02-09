import type { NextApiRequest, NextApiResponse } from "next";
import { requireManager } from "../../../../../lib/erpAuth";

type Resp = { ok: boolean; data?: any; error?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireManager(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const status = String(Array.isArray(req.query.status) ? req.query.status[0] : req.query.status || "").trim() || null;
  const from = String(Array.isArray(req.query.from) ? req.query.from[0] : req.query.from || "").trim() || null;
  const to = String(Array.isArray(req.query.to) ? req.query.to[0] : req.query.to || "").trim() || null;
  const vendorId = String(Array.isArray(req.query.vendor_id) ? req.query.vendor_id[0] : req.query.vendor_id || "").trim() || null;

  const { data, error } = await auth.userClient.rpc("erp_mfg_erp_asns_list_v1", {
    p_vendor_id: vendorId,
    p_status: status,
    p_from: from,
    p_to: to,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to load ASNs" });
  return res.status(200).json({ ok: true, data: { items: data ?? [] } });
}
