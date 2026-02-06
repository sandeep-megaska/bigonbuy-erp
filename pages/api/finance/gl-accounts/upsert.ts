import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null; issues?: string[] };
type SuccessResponse = { ok: true; data: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

const payloadSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  code: z.string().min(1),
  name: z.string().min(1),
  account_type: z.enum(["asset", "liability", "income", "expense", "equity"]),
  is_active: z.boolean().optional(),
});

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

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      ok: false,
      error: "Invalid payload",
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_gl_account_upsert", {
      p_code: parsed.data.code,
      p_name: parsed.data.name,
      p_account_type: parsed.data.account_type,
      p_is_active: parsed.data.is_active ?? true,
      p_id: parsed.data.id ?? null,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to save account",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
