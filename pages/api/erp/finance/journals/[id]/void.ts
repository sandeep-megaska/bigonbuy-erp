import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

const getIdParam = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

type VoidBody = { reason?: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const journalId = getIdParam(req.query.id);
  if (!journalId) {
    return res.status(400).json({ ok: false, error: "Journal id is required" });
  }

  const { reason } = (req.body || {}) as VoidBody;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ ok: false, error: "Void reason is required" });
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

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_fin_journal_void", {
      p_journal_id: journalId,
      p_reason: reason.trim(),
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to void journal",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, journal: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
