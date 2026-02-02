import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type AccessResponse =
  | { ok: true; permission_keys: string[]; module_keys: string[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<AccessResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const session = await requireEmployeeSession(req, res);
  if (!session) return;

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient.rpc("erp_employee_permissions_get", {
    p_company_id: session.company_id,
    p_employee_id: session.employee_id,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  const rows = Array.isArray(data) ? data : [];
  const permissionKeys = Array.from(
    new Set(rows.map((row) => String(row.perm_key || "").trim()).filter(Boolean))
  );
  const moduleKeys = Array.from(
    new Set(rows.map((row) => String(row.module_key || "").trim()).filter(Boolean))
  );

  return res.status(200).json({ ok: true, permission_keys: permissionKeys, module_keys: moduleKeys });
}
