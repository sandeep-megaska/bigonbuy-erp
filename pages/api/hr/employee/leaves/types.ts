import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type TypesResponse =
  | { ok: true; types: unknown[] }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<TypesResponse>) {
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
    .from("erp_hr_leave_types")
    .select(
      "id, key, name, is_paid, is_active, allows_half_day, display_order, counts_weekly_off, counts_holiday"
    )
    .eq("company_id", session.company_id)
    .eq("is_active", true)
    .order("display_order", { ascending: true });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, types: data || [] });
}
