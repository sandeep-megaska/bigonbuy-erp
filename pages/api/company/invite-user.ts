import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSiteUrl,
  getSupabaseEnv,
} from "../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; invited: unknown };
type ApiResponse = SuccessResponse | ErrorResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey || missing.length > 0) {
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

  const { email, role_key, full_name } = (req.body ?? {}) as Record<string, unknown>;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedRole = typeof role_key === "string" ? role_key.trim() : "";
  const fullName = typeof full_name === "string" ? full_name.trim() : "";

  if (!normalizedEmail || !normalizedRole) {
    return res.status(400).json({ ok: false, error: "email and role_key are required" });
  }

  if (normalizedRole === "owner") {
    return res.status(400).json({ ok: false, error: "Inviting an owner is not allowed" });
  }

  if (!["admin", "hr", "employee"].includes(normalizedRole)) {
    return res.status(400).json({ ok: false, error: "Invalid role" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const inviterId = userData.user.id;
    const { data: isManager, error: managerError } = await userClient.rpc("is_erp_manager", {
      uid: inviterId,
    });
    if (managerError || !isManager) {
      return res
        .status(managerError ? 500 : 403)
        .json({ ok: false, error: managerError?.message || "Not authorized" });
    }

    const siteUrl = getSiteUrl();
    const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

    const { data: inviteData, error: inviteErr } = await serviceClient.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        redirectTo: `${siteUrl}/reset-password`,
        data: fullName ? { full_name: fullName } : undefined,
      }
    );

    if (inviteErr || !inviteData?.user?.id) {
      return res.status(500).json({
        ok: false,
        error: inviteErr?.message || "Failed to send invite email",
        details: inviteErr?.code || null,
      });
    }

    const invitedUserId = inviteData.user.id;
    const { data: rpcResult, error: rpcError } = await userClient.rpc("erp_invite_company_user", {
      p_user_id: invitedUserId,
      p_email: normalizedEmail,
      p_role_key: normalizedRole,
      p_full_name: fullName || null,
    });

    if (rpcError) {
      return res.status(400).json({
        ok: false,
        error: rpcError.message || "Failed to record invitation",
        details: rpcError.details || rpcError.hint || rpcError.code,
      });
    }

    return res.status(200).json({ ok: true, invited: rpcResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
