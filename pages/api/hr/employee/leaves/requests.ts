import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type RequestsResponse =
  | { ok: true; requests: unknown[]; requestDays: Record<string, number> }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<RequestsResponse>) {
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

  const { data: requests, error } = await adminClient
    .from("erp_hr_leave_requests")
    .select(
      "id, leave_type_id, date_from, date_to, reason, status, decision_note, decided_at, start_session, end_session, leave_type:leave_type_id(name)"
    )
    .eq("company_id", session.company_id)
    .eq("employee_id", session.employee_id)
    .order("created_at", { ascending: false });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  const requestIds = (requests || []).map((row) => row.id);
  let requestDays: Record<string, number> = {};

  if (requestIds.length > 0) {
    const { data: days, error: daysError } = await adminClient
      .from("erp_hr_leave_request_days")
      .select("leave_request_id, day_fraction")
      .in("leave_request_id", requestIds);

    if (daysError) {
      return res.status(500).json({ ok: false, error: daysError.message });
    }

    requestDays = (days || []).reduce<Record<string, number>>((acc, row) => {
      const current = acc[row.leave_request_id] ?? 0;
      acc[row.leave_request_id] = current + Number(row.day_fraction || 0);
      return acc;
    }, {});
  }

  return res.status(200).json({ ok: true, requests: requests || [], requestDays });
}
