import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  employee: Record<string, unknown>;
  job: Record<string, unknown> | null;
  contacts: {
    primary_phone: string | null;
    alternate_phone: string | null;
    email: string | null;
  };
  addresses: {
    current: Record<string, unknown>;
    permanent: Record<string, unknown>;
  };
  statutory: Record<string, unknown> | null;
  bank: Record<string, unknown> | null;
  compensation: Record<string, unknown> | null;
  access: {
    role_key: string | null;
    can_manage: boolean;
    can_payroll: boolean;
    can_bank: boolean;
    can_statutory: boolean;
    can_hr: boolean;
  };
};
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const employeeIdParam = req.query.id;
  const employeeId = Array.isArray(employeeIdParam) ? employeeIdParam[0] : employeeIdParam;
  if (!employeeId) {
    return res.status(400).json({ ok: false, error: "employee id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data: membership } = await userClient
      .from("erp_company_users")
      .select("role_key")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const roleKey = membership?.role_key ?? null;
    const canManage = roleKey === "owner" || roleKey === "admin" || roleKey === "hr";
    const canPayroll = roleKey === "owner" || roleKey === "admin" || roleKey === "payroll";
    const canBank = roleKey === "owner" || roleKey === "admin" || roleKey === "payroll";
    const canStatutory = roleKey === "owner" || roleKey === "admin" || roleKey === "hr";

    const { data: employee, error: employeeError } = await userClient
      .from("erp_employees")
      .select("id, full_name, employee_code, lifecycle_status, status, joining_date")
      .eq("id", employeeId)
      .maybeSingle();

    if (employeeError) {
      return res.status(400).json({
        ok: false,
        error: employeeError.message || "Failed to load employee",
        details: employeeError.details || employeeError.hint || employeeError.code,
      });
    }

    if (!employee) {
      return res.status(404).json({ ok: false, error: "Employee not found" });
    }

    const { data: job } = await userClient
      .from("erp_employee_current_jobs")
      .select(
        "id, employee_id, effective_from, manager_employee_id, department_id, designation_id, grade_id, location_id, cost_center_id"
      )
      .eq("employee_id", employeeId)
      .maybeSingle();

    const { data: contactRows, error: contactsError } = await userClient
      .from("erp_employee_contacts")
      .select("contact_type, email, phone")
      .eq("employee_id", employeeId);

    if (contactsError) {
      return res.status(400).json({
        ok: false,
        error: contactsError.message || "Failed to load contacts",
        details: contactsError.details || contactsError.hint || contactsError.code,
      });
    }

    const primaryContact = contactRows?.find((row) => row.contact_type === "primary");
    const alternateContact = contactRows?.find((row) => row.contact_type === "personal");

    const { data: addressRows, error: addressError } = await userClient
      .from("erp_employee_addresses")
      .select("address_type, line1, line2, city, state, postal_code, country")
      .eq("employee_id", employeeId);

    if (addressError) {
      return res.status(400).json({
        ok: false,
        error: addressError.message || "Failed to load addresses",
        details: addressError.details || addressError.hint || addressError.code,
      });
    }

    const currentAddress = addressRows?.find((row) => row.address_type === "current");
    const permanentAddress = addressRows?.find((row) => row.address_type === "permanent");

    let statutory = null;
    if (canStatutory) {
      const { data, error: statutoryError } = await userClient
        .from("erp_employee_statutory")
        .select("pan, uan, pf_number, esic_number, professional_tax_number")
        .eq("employee_id", employeeId)
        .maybeSingle();
      if (!statutoryError) {
        statutory = data ?? null;
      }
    }

    let bank = null;
    if (canBank) {
      const { data, error: bankError } = await userClient
        .from("erp_employee_bank_accounts")
        .select("account_holder_name, account_number, ifsc_code, bank_name")
        .eq("employee_id", employeeId)
        .eq("is_primary", true)
        .maybeSingle();
      if (!bankError) {
        bank = data ?? null;
      }
    }

    let compensation = null;
    if (canPayroll) {
      const { data: compRow, error: compError } = await userClient
        .from("erp_employee_current_compensation")
        .select("salary_structure_id, effective_from, currency, gross_annual")
        .eq("employee_id", employeeId)
        .maybeSingle();
      if (!compError && compRow) {
        let structureName = null;
        if (compRow.salary_structure_id) {
          const { data: structure } = await userClient
            .from("erp_salary_structures")
            .select("name")
            .eq("id", compRow.salary_structure_id)
            .maybeSingle();
          structureName = structure?.name ?? null;
        }
        compensation = {
          ...compRow,
          salary_structure_name: structureName,
        };
      }
    }

    return res.status(200).json({
      ok: true,
      employee: employee as Record<string, unknown>,
      job: (job ?? null) as Record<string, unknown> | null,
      contacts: {
        primary_phone: primaryContact?.phone ?? null,
        alternate_phone: alternateContact?.phone ?? null,
        email: primaryContact?.email ?? null,
      },
      addresses: {
        current: {
          line1: currentAddress?.line1 ?? null,
          line2: currentAddress?.line2 ?? null,
          city: currentAddress?.city ?? null,
          state: currentAddress?.state ?? null,
          postal_code: currentAddress?.postal_code ?? null,
          country: currentAddress?.country ?? null,
        },
        permanent: {
          line1: permanentAddress?.line1 ?? null,
          line2: permanentAddress?.line2 ?? null,
          city: permanentAddress?.city ?? null,
          state: permanentAddress?.state ?? null,
          postal_code: permanentAddress?.postal_code ?? null,
          country: permanentAddress?.country ?? null,
        },
      },
      statutory: (statutory ?? null) as Record<string, unknown> | null,
      bank: canBank
        ? ((bank ?? null) as Record<string, unknown> | null)
        : ({ restricted: true } as Record<string, unknown>),
      compensation: (compensation ?? null) as Record<string, unknown> | null,
      access: {
        role_key: roleKey,
        can_manage: canManage,
        can_payroll: canPayroll,
        can_bank: canBank,
        can_statutory: canStatutory,
        can_hr: roleKey === "hr",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
