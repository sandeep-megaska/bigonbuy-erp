import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../../lib/mfgCookies";
import { generateBoxLabelsPdf, type AsnPrintData } from "../../../../../lib/mfg/asnPrintPdf";

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const asnId = String(Array.isArray(req.query.asnId) ? req.query.asnId[0] : req.query.asnId || "").trim();
  if (!asnId) return res.status(400).json({ ok: false, error: "asnId is required" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_asn_print_data_v1", {
    p_session_token: token,
    p_asn_id: asnId,
  });

  if (error || !data) {
    return res.status(400).json({ ok: false, error: error?.message || "Failed to load print data" });
  }

  const payload = data as AsnPrintData;
  const pdf = await generateBoxLabelsPdf(payload);
  const fileAsn = payload?.asn?.asn_no || payload?.asn?.id || asnId;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="ASN_${fileAsn}_box_labels.pdf"`);
  return res.status(200).send(pdf);
}
