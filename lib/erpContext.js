import { supabase } from "./supabaseClient";

/**
 * Returns { ok, user, companyId, roleKey, email }
 * Uses erp_company_users created in Phase 0.
 */
export async function getCompanyContext() {
  const { data: udata, error: uerr } = await supabase.auth.getUser();
  const user = udata?.user;

  if (uerr || !user) {
    return { ok: false, error: uerr || new Error("Not logged in") };
  }

  const { data, error } = await supabase
    .from("erp_company_users")
    .select("company_id, role_key, is_active")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) return { ok: false, error };
  if (!data?.company_id) return { ok: false, error: new Error("No active company membership") };

  return {
    ok: true,
    user,
    email: user.email,
    companyId: data.company_id,
    roleKey: data.role_key,
  };
}

export function isAdmin(roleKey) {
  return roleKey === "owner" || roleKey === "admin";
}

/** simple client-guard */
export async function requireErpAuthOrRedirect() {
  const ctx = await getCompanyContext();
  if (!ctx.ok) {
    window.location.href = "/login";
    return null;
  }
  return ctx;
}
