import type { NextApiRequest, NextApiResponse } from "next";
import { requireEmployeeSession } from "../../../../lib/erp/employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ProfileResponse =
  | {
      ok: true;
      profile: {
        id: string;
        employee_code: string | null;
        full_name: string | null;
        department: string | null;
        designation: string | null;
        joining_date: string | null;
        phone: string | null;
        email: string | null;
        employment_status: string | null;
      };
    }
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

  // 1) Load core employee data (erp_employees does NOT have email column)
  const { data: emp, error: empError } = await adminClient
    .from("erp_employees")
    .select("id, employee_code, full_name, department, designation, joining_date, lifecycle_status, status, phone")
    .eq("company_id", session.company_id)
    .eq("id", session.employee_id)
    .maybeSingle();

  if (empError || !emp) {
    return res.status(500).json({ ok: false, error: empError?.message || "Profile not found" });
  }

  // 2) Load primary email from erp_employee_contacts (if present)
  const { data: emailRow, error: emailError } = await adminClient
    .from("erp_employee_contacts")
    .select("email")
    .eq("company_id", session.company_id)
    .eq("employee_id", session.employee_id)
    .in("contact_type", ["email", "work_email"])
    .eq("is_primary", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // If contacts query fails, we still return profile (email just becomes null).
  // This keeps the portal usable even if contacts data is missing.
  if (emailError) {
    // Optional: you can log server-side if you have logging
    // console.error("Failed to load employee email contact:", emailError);
  }

  const lifecycleStatus = typeof emp.lifecycle_status === "string" ? emp.lifecycle_status.trim() : "";
  const employmentStatus = lifecycleStatus !== "" ? lifecycleStatus : emp.status;

  // Keep payload stable and explicit
  return res.status(200).json({
    ok: true,
    profile: {
      id: emp.id,
      employee_code: emp.employee_code ?? null,
      full_name: emp.full_name ?? null,
      department: emp.department ?? null,
      designation: emp.designation ?? null,
      joining_date: emp.joining_date ?? null,
      phone: emp.phone ?? null,
      email: emailRow?.email ?? null,
      employment_status: employmentStatus ?? null,
    },
  });
}
