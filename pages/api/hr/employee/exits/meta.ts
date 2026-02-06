import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type MetaResponse =
  | { ok: true; types: unknown[]; reasons: unknown[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<MetaResponse>) {
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

  const [{ data: types, error: typeError }, { data: reasons, error: reasonError }] =
    await Promise.all([
      adminClient
        .from("erp_hr_employee_exit_types")
        .select("id, name")
        .eq("company_id", session.company_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
      adminClient
        .from("erp_hr_employee_exit_reasons")
        .select("id, name")
        .eq("company_id", session.company_id)
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);

  if (typeError || reasonError) {
    return res
      .status(500)
      .json({ ok: false, error: typeError?.message || reasonError?.message || "Error" });
  }

  return res.status(200).json({ ok: true, types: types || [], reasons: reasons || [] });
}
