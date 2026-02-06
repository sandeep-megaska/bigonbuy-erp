import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceRoleClient, getSiteUrl, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { requireManager } from "../../../../lib/erpAuth";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  email: string;
  role_key: string;
  metadata?: Record<string, string>;
};
type ApiResponse = ErrorResponse | SuccessResponse;

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

  const auth = await requireManager(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const { email, role_key, full_name, designation } = (req.body ?? {}) as Record<string, unknown>;
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedRole = typeof role_key === "string" ? role_key.trim() : "";
  const normalizedName = typeof full_name === "string" ? full_name.trim() : "";
  const normalizedDesignation = typeof designation === "string" ? designation.trim() : "";

  if (!normalizedEmail || !normalizedRole) {
    return res.status(400).json({ ok: false, error: "email and role_key are required" });
  }

  if (normalizedRole === "owner") {
    return res.status(400).json({ ok: false, error: "Inviting an owner is not allowed" });
  }

  try {
    const siteUrl = getSiteUrl();
    const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);

    const metadata: Record<string, string> = {};
    if (normalizedName) metadata.full_name = normalizedName;
    if (normalizedDesignation) metadata.designation = normalizedDesignation;

    const { data: inviteData, error: inviteErr } = await serviceClient.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        redirectTo: `${siteUrl}/reset-password`,
        data: Object.keys(metadata).length ? metadata : undefined,
      },
    );

    if (inviteErr || !inviteData?.user?.id) {
      return res.status(500).json({
        ok: false,
        error: inviteErr?.message || "Failed to send invite email",
        details: inviteErr?.code || null,
      });
    }

    const invitedUserId = inviteData.user.id;
    const { data: rpcResult, error: rpcError } = await auth.userClient.rpc("erp_invite_company_user", {
      p_user_id: invitedUserId,
      p_email: normalizedEmail,
      p_role_key: normalizedRole,
      p_full_name: normalizedName || null,
    });

    if (rpcError) {
      return res.status(400).json({
        ok: false,
        error: rpcError.message || "Failed to record invitation",
        details: rpcError.details || rpcError.hint || rpcError.code,
      });
    }

    return res.status(200).json({
      ok: true,
      email: normalizedEmail,
      role_key: normalizedRole,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
