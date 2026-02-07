import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type Resp = { ok: true; public_url: string | null; path: string | null } | { ok: false; error: string };

const BUCKET = "erp-assets";

function extFromFilenameOrMime(filename: string, mimeType: string): string {
  const fromName = filename.includes(".") ? filename.split(".").pop() : "";
  if (fromName) return fromName.toLowerCase();
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/svg+xml") return "svg";
  return "jpg";
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

  const { file_base64, mime_type, filename, remove } = (req.body ?? {}) as Record<string, unknown>;
  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const { data: company, error: companyLookupError } = await adminClient
    .from("erp_companies")
    .select("id, secondary_logo_path")
    .eq("id", companyId)
    .maybeSingle();

  if (companyLookupError || !company) {
    return res.status(404).json({ ok: false, error: "Company not found" });
  }

  if (Boolean(remove)) {
    if (company.secondary_logo_path) {
      await adminClient.storage.from(BUCKET).remove([company.secondary_logo_path]);
    }

    const { error: updateError } = await adminClient
      .from("erp_companies")
      .update({ secondary_logo_path: null, secondary_logo_updated_at: new Date().toISOString() })
      .eq("id", companyId);

    if (updateError) {
      return res.status(400).json({ ok: false, error: updateError.message || "Failed to clear secondary logo" });
    }

    return res.status(200).json({ ok: true, public_url: null, path: null });
  }

  const base64 = typeof file_base64 === "string" ? file_base64.trim() : "";
  const mimeType = typeof mime_type === "string" ? mime_type.trim() : "image/png";
  const fileName = typeof filename === "string" ? filename.trim() : "secondary-logo.png";

  if (!base64) {
    return res.status(400).json({ ok: false, error: "file_base64 is required" });
  }

  const extension = extFromFilenameOrMime(fileName, mimeType);
  const path = `companies/${companyId}/secondary-logo.${extension}`;
  const fileBuffer = Buffer.from(base64, "base64");

  const { error: uploadError } = await adminClient.storage.from(BUCKET).upload(path, fileBuffer, {
    upsert: true,
    contentType: mimeType || "application/octet-stream",
  });

  if (uploadError) {
    return res.status(400).json({ ok: false, error: uploadError.message || "Failed to upload secondary logo" });
  }

  const { error: updateError } = await adminClient
    .from("erp_companies")
    .update({ secondary_logo_path: path, secondary_logo_updated_at: new Date().toISOString() })
    .eq("id", companyId);

  if (updateError) {
    return res.status(400).json({ ok: false, error: updateError.message || "Failed to save secondary logo path" });
  }

  const { data: publicData } = adminClient.storage.from(BUCKET).getPublicUrl(path);
  return res.status(200).json({ ok: true, public_url: publicData?.publicUrl ?? null, path });
}
