import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type CancelResponse =
  | { ok: true }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<CancelResponse>) {
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

  const { request_id, note } = (req.body ?? {}) as Record<string, unknown>;
  if (!request_id) {
    return res.status(400).json({ ok: false, error: "request_id is required" });
  }

  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { error } = await adminClient.rpc("erp_employee_leave_request_cancel", {
    p_company_id: session.company_id,
    p_employee_id: session.employee_id,
    p_request_id: request_id,
    p_note: note ?? null,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true });
}
