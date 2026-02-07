import type { NextApiRequest, NextApiResponse } from "next";
import { requireManager } from "../../../../lib/erpAuth";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<{ ok: boolean; data?: any; error?: string }>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireManager(req);
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  const { vendor_id } = (req.body ?? {}) as Record<string, unknown>;
  const vendorId = typeof vendor_id === "string" ? vendor_id : "";
  if (!vendorId) return res.status(400).json({ ok: false, error: "vendor_id is required" });

  const { data: companyId, error: companyError } = await auth.userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) return res.status(400).json({ ok: false, error: companyError?.message || "Failed to determine company" });

  const { data, error } = await auth.userClient.rpc("erp_vendor_portal_enable", {
    p_vendor_id: vendorId,
    p_company_id: companyId,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to enable portal" });
  const row = Array.isArray(data) ? data[0] : data;
  return res.status(200).json({ ok: true, data: row });
}
