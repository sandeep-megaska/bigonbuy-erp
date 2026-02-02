import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type SubmitResponse =
  | { ok: true; exit_id: string }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<SubmitResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
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

  const {
    exit_type_id,
    exit_reason_id,
    last_working_day,
    notice_period_days,
    notice_waived,
    notes,
  } = (req.body ?? {}) as Record<string, unknown>;

  if (!exit_type_id) {
    return res.status(400).json({ ok: false, error: "exit_type_id is required" });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient.rpc("erp_employee_exit_request_submit", {
    p_company_id: session.company_id,
    p_employee_id: session.employee_id,
    p_exit_type_id: exit_type_id,
    p_exit_reason_id: exit_reason_id ?? null,
    p_last_working_day: last_working_day ?? null,
    p_notice_period_days: notice_period_days ?? null,
    p_notice_waived: notice_waived ?? false,
    p_notes: notes ?? null,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, exit_id: data as string });
}
