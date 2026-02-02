import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type PreviewResponse =
  | { ok: true; preview: unknown[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<PreviewResponse>) {
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

  const { leave_type_id, date_from, date_to, start_session, end_session } =
    (req.body ?? {}) as Record<string, unknown>;

  if (!leave_type_id || !date_from || !date_to) {
    return res
      .status(400)
      .json({ ok: false, error: "leave_type_id, date_from, date_to are required" });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await adminClient.rpc("erp_leave_request_preview", {
    p_employee_id: session.employee_id,
    p_leave_type_id: leave_type_id,
    p_date_from: date_from,
    p_date_to: date_to,
    p_start_session: start_session ?? "full",
    p_end_session: end_session ?? "full",
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, preview: data || [] });
}
