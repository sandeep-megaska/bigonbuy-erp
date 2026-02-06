import type { NextApiRequest, NextApiResponse } from "next";
import bcrypt from "bcryptjs";
import { requireManager } from "../../../../lib/erpAuth";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type UpsertResponse =
  | { ok: true; user_id: string }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<UpsertResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireManager(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
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

  const { employee_id, password } = (req.body ?? {}) as Record<string, unknown>;
  const employeeId = typeof employee_id === "string" ? employee_id : "";
  const passwordRaw = typeof password === "string" ? password : "";

  if (!employeeId || !passwordRaw) {
    return res.status(400).json({ ok: false, error: "employee_id and password are required" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");

  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
    });
  }

  const passwordHash = await bcrypt.hash(passwordRaw, 10);
  const { data, error } = await auth.userClient.rpc("erp_employee_auth_user_upsert", {
    p_company_id: companyId,
    p_employee_id: employeeId,
    p_password_hash: passwordHash,
    p_actor_user_id: auth.user.id,
  });

  if (error || !data) {
    return res.status(500).json({ ok: false, error: error?.message || "Failed to save" });
  }

  return res.status(200).json({ ok: true, user_id: data as string });
}
