import type { NextApiRequest } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmployeeSession } from "./employeeAuth";
import { createServiceRoleClient, getSupabaseEnv } from "../serverSupabase";

type AccessLevel = "finance_reader" | "finance_writer" | "marketplace_writer";

type FinanceAuthSuccess = {
  ok: true;
  client: SupabaseClient;
  actorUserId: string;
  companyId: string;
  roleKey: string;
};

type FinanceAuthFailure = {
  ok: false;
  status: number;
  error: string;
};

const FINANCE_READER_ROLES = new Set(["owner", "admin", "finance"]);
const FINANCE_WRITER_ROLES = new Set(["owner", "admin", "finance"]);
const MARKETPLACE_WRITER_ROLES = new Set(["owner", "admin", "finance", "inventory"]);

const hasAccess = (roleKey: string, accessLevel: AccessLevel) => {
  if (accessLevel === "finance_reader") return FINANCE_READER_ROLES.has(roleKey);
  if (accessLevel === "finance_writer") return FINANCE_WRITER_ROLES.has(roleKey);
  return MARKETPLACE_WRITER_ROLES.has(roleKey);
};

const getAccessDeniedMessage = (accessLevel: AccessLevel) => {
  if (accessLevel === "finance_writer") return "Finance write access required";
  if (accessLevel === "marketplace_writer") return "Marketplace write access required";
  return "Finance access required";
};

export async function requireErpFinanceApiAuth(
  req: NextApiRequest,
  accessLevel: AccessLevel
): Promise<FinanceAuthSuccess | FinanceAuthFailure> {
  const session = await getEmployeeSession(req);
  if (!session) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return {
      ok: false,
      status: 500,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    };
  }

  const client = createServiceRoleClient(supabaseUrl, serviceRoleKey);

  const { data: mapping, error: mappingError } = await client
    .from("erp_employee_users")
    .select("user_id")
    .eq("company_id", session.company_id)
    .eq("employee_id", session.employee_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (mappingError || !mapping?.user_id) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  const { data: membership, error: membershipError } = await client
    .from("erp_company_users")
    .select("company_id, role_key, is_active")
    .eq("user_id", mapping.user_id)
    .eq("company_id", session.company_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError || !membership?.role_key) {
    return { ok: false, status: 403, error: getAccessDeniedMessage(accessLevel) };
  }

  if (!hasAccess(membership.role_key, accessLevel)) {
    return { ok: false, status: 403, error: getAccessDeniedMessage(accessLevel) };
  }

  return {
    ok: true,
    client,
    actorUserId: mapping.user_id,
    companyId: membership.company_id,
    roleKey: membership.role_key,
  };
}
