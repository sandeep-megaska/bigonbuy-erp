import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../../lib/mfgCookies";

type Resp = { ok: boolean; data?: any; error?: string };
const BUCKET = "mfg-asn-docs";

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return res.status(500).json({ ok: false, error: "Server misconfigured" });

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const asnId = String(Array.isArray(req.query.asnId) ? req.query.asnId[0] : req.query.asnId || "").trim();
  if (!asnId) return res.status(400).json({ ok: false, error: "asnId is required" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data, error } = await anon.rpc("erp_mfg_asn_tracking_detail_v1", {
    p_session_token: token,
    p_asn_id: asnId,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to load ASN tracking" });

  const admin = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const docs = Array.isArray(data?.documents) ? data.documents : [];
  const docsWithUrls = await Promise.all(
    docs.map(async (doc: any) => {
      const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(String(doc.file_path || ""), 60 * 60);
      return { ...doc, signed_url: signed?.signedUrl || null };
    })
  );

  return res.status(200).json({ ok: true, data: { ...(data || {}), documents: docsWithUrls } });
}
