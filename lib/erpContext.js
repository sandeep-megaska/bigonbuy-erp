import { supabase } from "./supabaseClient";

export async function getSessionOrNull() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data?.session ?? null;
}

export async function getCompanyContext(existingSession) {
  const session = existingSession ?? (await getSessionOrNull());
  if (!session) {
    return {
      session: null,
      email: null,
      userId: null,
      companyId: null,
      roleKey: null,
      membershipError: null,
    };
  }

  const { data: membership, error } = await supabase
    .from("erp_company_users")
    .select("company_id, role_key, is_active")
    .eq("user_id", session.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return {
    session,
    email: session.user.email ?? "",
    userId: session.user.id,
    companyId: membership?.company_id ?? null,
    roleKey: membership?.role_key ?? null,
    membershipError: error ? error.message : null,
  };
}

export async function getEmployeeContext(existingSession) {
  const session = existingSession ?? (await getSessionOrNull());
  if (!session) {
    return {
      session: null,
      email: null,
      userId: null,
      companyId: null,
      employeeId: null,
      membershipError: null,
    };
  }

  const { data: mapping, error } = await supabase
    .from("erp_employee_users")
    .select("company_id, employee_id, is_active")
    .eq("user_id", session.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  return {
    session,
    email: session.user.email ?? "",
    userId: session.user.id,
    companyId: mapping?.company_id ?? null,
    employeeId: mapping?.employee_id ?? null,
    membershipError: error ? error.message : null,
  };
}

export async function requireAuthRedirectHome(router) {
  const session = await getSessionOrNull();
  if (!session) {
    router.replace("/");
    return null;
  }
  return session;
}

export function isAdmin(roleKey) {
  return roleKey === "owner" || roleKey === "admin";
}

export function isInventoryWriter(roleKey) {
  return roleKey === "owner" || roleKey === "admin" || roleKey === "inventory";
}

export function isHr(roleKey) {
  return isManager(roleKey);
}

export function isManager(roleKey) {
  return roleKey === "owner" || roleKey === "admin" || roleKey === "hr";
}
