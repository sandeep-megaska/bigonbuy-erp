import type { NextApiRequest, NextApiResponse } from "next";
import { getInternalManagerSession } from "../../../../lib/mfg/internalAuth";
import { getVendorSession } from "../../../../lib/mfg/vendorAuth";

type MeResponse =
  | { ok: true; session: { kind: "vendor" | "internal"; vendor_id?: string; vendor_code?: string; company_id?: string; display_name: string; must_reset_password: boolean } }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<MeResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const vendorSession = await getVendorSession(req);
  if (vendorSession) {
    return res.status(200).json({
      ok: true,
      session: {
        kind: "vendor",
        vendor_id: vendorSession.vendor_id,
        vendor_code: vendorSession.vendor_code,
        company_id: vendorSession.company_id,
        display_name: vendorSession.display_name,
        must_reset_password: vendorSession.must_reset_password,
      },
    });
  }

  const internal = await getInternalManagerSession(req);
  if (internal) {
    return res.status(200).json({
      ok: true,
      session: { kind: "internal", display_name: "ERP Admin", must_reset_password: false },
    });
  }

  return res.status(401).json({ ok: false, error: "Not authenticated" });
}
