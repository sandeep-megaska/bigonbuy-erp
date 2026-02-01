import type { NextApiRequest, NextApiResponse } from "next";
import { listDesignations, type DesignationRow } from "../../../lib/erp/hr/designationsService";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; rows: DesignationRow[]; designations?: DesignationRow[] };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[DEPRECATED API] /api/hr/designations called; use /api/hr/masters?type=designations"
    );
  }

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

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { rows, error } = await listDesignations(userClient, false);
    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Failed to load designations",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, rows, designations: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
