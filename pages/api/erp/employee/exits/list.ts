import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ListResponse =
  | { ok: true; exits: unknown[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ListResponse>) {
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
  const { data, error } = await adminClient
    .from("erp_hr_employee_exits")
    .select(
      "id, status, initiated_on, last_working_day, notice_period_days, notice_waived, notes, exit_type:exit_type_id(name), exit_reason:exit_reason_id(name)"
    )
    .eq("company_id", session.company_id)
    .eq("employee_id", session.employee_id)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, exits: data || [] });
}
