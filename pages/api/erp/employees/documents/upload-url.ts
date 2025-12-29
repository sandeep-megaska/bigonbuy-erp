import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; path: string; uploadUrl: string };
type ApiResponse = ErrorResponse | SuccessResponse;

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9\\.\\-_]/g, "_");
}

async function assertHr(userClient: ReturnType<typeof createUserClient>) {
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) {
    const err = new Error("Not authenticated");
    err.name = "UNAUTHORIZED";
    throw err;
  }

  const { data: isHr, error: hrError } = await userClient.rpc("erp_is_hr_admin", {
    uid: data.user.id,
  });
  if (hrError || !isHr) {
    const err = new Error("Not authorized");
    err.name = "FORBIDDEN";
    throw err;
  }
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

  const { employee_id, file_name } = (req.body ?? {}) as Record<string, unknown>;
  const employeeId = typeof employee_id === "string" ? employee_id : "unknown";
  const fileName = typeof file_name === "string" ? sanitizeFileName(file_name) : "document.bin";

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    await assertHr(userClient);

    const path = `documents/${employeeId}/${Date.now()}-${fileName}`;
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
  } catch (err) {
    if (err instanceof Error && err.name === "UNAUTHORIZED") {
      return res.status(401).json({ ok: false, error: err.message });
    }
    if (err instanceof Error && err.name === "FORBIDDEN") {
      return res.status(403).json({ ok: false, error: err.message });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
