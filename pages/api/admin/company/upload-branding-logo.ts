import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

const BUCKET = "employee-documents";
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Resp = { ok: true; path: string; signed_url: string | null } | { ok: false; error: string };

function extFromMime(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<Resp>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");
  if (companyError || !companyId) {
    return res.status(400).json({ ok: false, error: companyError?.message || "Failed to resolve company" });
  }

  const { data: membership, error: membershipError } = await userClient
    .from("erp_company_users")
    .select("role_key")
    .eq("user_id", userData.user.id)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (membershipError) {
    return res.status(500).json({ ok: false, error: membershipError.message || "Authorization check failed" });
  }
  if (!membership || !["owner", "admin"].includes(membership.role_key ?? "")) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  const { file_base64, mime_type } = (req.body ?? {}) as Record<string, unknown>;
  const base64 = typeof file_base64 === "string" ? file_base64.trim() : "";
  const mimeType = typeof mime_type === "string" ? mime_type.trim() : "";

  if (!base64) {
    return res.status(400).json({ ok: false, error: "file_base64 is required" });
  }
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return res.status(400).json({ ok: false, error: "Logo must be a PNG, JPEG, or WebP image." });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const path = `organizations/${companyId}/branding/logo-${Date.now()}.${extFromMime(mimeType)}`;
  const fileBuffer = Buffer.from(base64, "base64");

  const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(path, fileBuffer, {
    upsert: false,
    contentType: mimeType,
  });
  if (uploadError) {
    return res.status(400).json({ ok: false, error: uploadError.message || "Failed to upload logo" });
  }

  const { data: signed } = await adminClient.storage.from(BUCKET).createSignedUrl(path, 3600);
  return res.status(200).json({ ok: true, path, signed_url: signed?.signedUrl ?? null });
}
