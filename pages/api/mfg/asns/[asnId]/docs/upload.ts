import type { NextApiRequest, NextApiResponse } from "next";
import { createAnonClient, createServiceRoleClient, getSupabaseEnv } from "../../../../../../lib/serverSupabase";
import { getCookieLast } from "../../../../../../lib/mfgCookies";

type Resp = { ok: boolean; data?: any; error?: string };
const BUCKET = "mfg-asn-docs";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || `doc_${Date.now()}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const token = (getCookieLast(req, "mfg_session") || "").trim();
  if (!token) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const asnId = String(Array.isArray(req.query.asnId) ? req.query.asnId[0] : req.query.asnId || "").trim();
  if (!asnId) return res.status(400).json({ ok: false, error: "asnId is required" });

  const docType = String(req.body?.doc_type || "OTHER").trim().toUpperCase();
  const base64 = String(req.body?.file_base64 || "").trim();
  const mimeType = String(req.body?.mime_type || "application/octet-stream").trim();
  const filename = sanitizeFileName(String(req.body?.filename || "document.bin").trim());

  if (!base64) return res.status(400).json({ ok: false, error: "file_base64 is required" });

  const anon = createAnonClient(supabaseUrl, anonKey);
  const { data: detail, error: detailError } = await anon.rpc("erp_mfg_asn_tracking_detail_v1", {
    p_session_token: token,
    p_asn_id: asnId,
  });

  if (detailError || !detail?.asn?.company_id || !detail?.asn?.vendor_id) {
    return res.status(400).json({ ok: false, error: detailError?.message || "Failed to load ASN context" });
  }

  const filePath = `${detail.asn.company_id}/${detail.asn.vendor_id}/${asnId}/${Date.now()}_${filename}`;
  const fileBuffer = Buffer.from(base64, "base64");

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(filePath, fileBuffer, {
    upsert: false,
    contentType: mimeType,
  });

  if (uploadError) {
    return res.status(400).json({ ok: false, error: uploadError.message || "Failed to upload document" });
  }

  const { data, error } = await anon.rpc("erp_mfg_asn_document_create_v1", {
    p_session_token: token,
    p_asn_id: asnId,
    p_doc_type: docType,
    p_file_path: filePath,
  });

  if (error) return res.status(400).json({ ok: false, error: error.message || "Failed to save document" });

  const { data: signed } = await adminClient.storage.from(BUCKET).createSignedUrl(filePath, 60 * 60 * 24);
  return res.status(200).json({ ok: true, data: { ...(data || {}), signed_url: signed?.signedUrl || null } });
}
