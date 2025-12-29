import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; path: string; uploadUrl: string };
type ApiResponse = ErrorResponse | SuccessResponse;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9.\\-_]/g, "_");
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const { employee_id, file_name, content_type } = (req.body ?? {}) as Record<string, unknown>;
  const employeeId = typeof employee_id === "string" ? employee_id : "new";
  const fileName = typeof file_name === "string" ? sanitizeFileName(file_name) : "id-proof.pdf";
  const contentType = typeof content_type === "string" ? content_type : "application/octet-stream";

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const path = `id-proofs/${employeeId}/${Date.now()}-${fileName}`;
  const { data, error } = await userClient.storage
    .from("erp-employee-private")
    .createSignedUploadUrl(path);

  if (error || !data?.signedUrl) {
    return res.status(500).json({
      ok: false,
      error: error?.message || "Failed to create upload URL",
      details: error?.name || null,
    });
  }

  return res.status(200).json({ ok: true, path, uploadUrl: data.signedUrl });
}
