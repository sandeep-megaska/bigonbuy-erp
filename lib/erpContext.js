import { supabase } from "./supabaseClient";

/**
 * Strict rule:
 * - If NO session => redirect to /login
 * - If session exists but company lookup fails => DO NOT redirect (show error)
 */
export async function requireErpAuthOrRedirect(router) {
  const { data: sdata, error: serr } = await supabase.auth.getSession();
  const session = sdata?.session;

  if (serr || !session) {
    router.replace("/login");
    return null;
  }

  // Try company context (Phase 0 membership)
  const { data: membership, error: merr } = await supabase
    .from("erp_company_users")
    .select("company_id, role_key, is_active")
    .eq("user_id", session.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  // Return session even if membership fails
  return {
    ok: !merr && !!membership?.company_id,
    session,
    email: session.user.email ?? "",
    userId: session.user.id,
    companyId: membership?.company_id ?? null,
    roleKey: membership?.role_key ?? null,
    membershipError: merr ? merr.message : null,
  };
}

export function isAdmin(roleKey) {
  return roleKey === "owner" || roleKey === "admin";
}
