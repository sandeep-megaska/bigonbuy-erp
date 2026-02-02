import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ProfileResponse =
  | { ok: true; profile: unknown }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ProfileResponse>) {
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
    .from("erp_employees")
    .select(
      "id, employee_code, full_name, department, designation, joining_date, lifecycle_status, status, phone, email"
    )
    .eq("company_id", session.company_id)
    .eq("id", session.employee_id)
    .maybeSingle();

  if (error || !data) {
    return res.status(500).json({ ok: false, error: error?.message || "Profile not found" });
  }

  const lifecycleStatus = typeof data.lifecycle_status === "string" ? data.lifecycle_status.trim() : "";
  const employmentStatus = lifecycleStatus !== "" ? lifecycleStatus : data.status;
  const { lifecycle_status, status, ...profile } = data;

  return res.status(200).json({
    ok: true,
    profile: {
      ...profile,
      employment_status: employmentStatus ?? null,
    },
  });
}
