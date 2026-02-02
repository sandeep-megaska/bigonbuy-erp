import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  data: {
    pendingApprovals: number;
  };
};

type ApiResponse = ErrorResponse | SuccessResponse;

const parseOptionalString = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const companyId = parseOptionalString(req.query.companyId);
  if (!companyId) {
    return res.status(400).json({ ok: false, error: "companyId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { count, error } = await userClient
      .from("erp_fin_pending_approvals_v")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId);

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load pending approvals",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({
      ok: true,
      data: {
        pendingApprovals: count ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
