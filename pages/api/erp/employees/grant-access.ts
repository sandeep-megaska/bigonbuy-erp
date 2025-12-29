import type { NextApiRequest, NextApiResponse } from "next";
import {
  createServiceRoleClient,
  createUserClient,
  getBearerToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = {
  ok: true;
  employee_id: string;
  employee_code: string;
  user_id: string;
  role_key: string;
  temp_password?: string;
};
type ApiResponse = ErrorResponse | SuccessResponse;

function generateTempPassword(): string {
  const alphabet =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789!@#$%^&*";
  const chars = [];
  for (let i = 0; i < 16; i += 1) {
    const idx = Math.floor(Math.random() * alphabet.length);
    chars.push(alphabet[idx]);
  }
  return chars.join("");
}

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

  const { employee_id, email, role_key } = (req.body ?? {}) as Record<string, unknown>;
  const employeeId = typeof employee_id === "string" ? employee_id : "";
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedRole = typeof role_key === "string" ? role_key.trim() : "";

  if (!employeeId || !normalizedEmail || !normalizedRole) {
    return res.status(400).json({ ok: false, error: "employee_id, email, role_key are required" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  // Service role is only used for Auth user provisioning
  const adminClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data: listData, error: listError } = await adminClient.auth.admin.listUsers({
    page: 1,
    perPage: 50,
  });

  if (listError) {
    return res.status(500).json({
      ok: false,
      error: listError.message || "Failed to lookup user",
      details: listError?.name || null,
    });
  }

  const existingUser = (listData?.users || []).find(
    (u) => u.email?.toLowerCase() === normalizedEmail,
  );

  let authUserId = existingUser?.id ?? null;
  let tempPassword: string | undefined;

  if (!authUserId) {
    tempPassword = generateTempPassword();
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password: tempPassword,
      email_confirm: true,
    });

    if (createError || !created?.user?.id) {
      return res.status(500).json({
        ok: false,
        error: createError?.message || "Failed to create auth user",
        details: createError?.code || null,
      });
    }

    authUserId = created.user.id;
  }

  const { data, error } = await userClient.rpc("erp_grant_employee_access", {
    p_employee_id: employeeId,
    p_email: normalizedEmail,
    p_role_key: normalizedRole,
    p_auth_user_id: authUserId,
  });

  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Failed to grant access",
      details: error.details || error.hint || error.code,
    });
  }

  const payload: SuccessResponse = {
    ok: true,
    employee_id: data?.employee_id ?? employeeId,
    employee_code: data?.employee_code ?? "",
    user_id: data?.user_id ?? authUserId,
    role_key: data?.role_key ?? normalizedRole,
  };

  if (tempPassword) {
    payload.temp_password = tempPassword;
  }

  return res.status(200).json(payload);
}
