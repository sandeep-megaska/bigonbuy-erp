import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../../lib/serverSupabase";
import { requireManager } from "../../../../../lib/erpAuth";

type ListResponse =
  | { ok: true; users: { employee_id: string; last_login_at: string | null; is_active: boolean }[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ListResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: companyId, error: companyError } = await userClient.rpc("erp_current_company_id");

  if (companyError || !companyId) {
    return res.status(400).json({
      ok: false,
      error: companyError?.message || "Failed to determine company",
    });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient
    .from("erp_employee_auth_users")
    .select("employee_id, last_login_at, is_active")
    .eq("company_id", companyId);

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, users: data || [] });
}
