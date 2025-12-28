import { createClient } from "@supabase/supabase-js";

async function findUserByEmail(adminClient, email) {
  let page = 1;
  const perPage = 100;
  const target = email.toLowerCase();

  // Paginate through users to find by email (getUserByEmail is unavailable in v2)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message || "Unable to list users");

    const match = data?.users?.find((u) => (u.email || "").toLowerCase() === target);
    if (match) return match;

    if (!data?.users || data.users.length < perPage) return null;
    page += 1;
  }
}

async function findOrCreateUser(adminClient, email) {
  const existing = await findUserByEmail(adminClient, email);
  if (existing) return existing;

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    email_confirm: true,
  });

  if (error || !data?.user) {
    throw new Error(error?.message || "Unable to create user");
  }

  return data.user;
}

function getAccessToken(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return req.cookies?.["sb-access-token"] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { email, role_key } = req.body || {};
  const normalizedEmail = (email || "").trim().toLowerCase();
  const normalizedRole = (role_key || "").trim();

  if (!normalizedEmail || !normalizedRole) {
    return res.status(400).json({ ok: false, error: "email and role_key are required" });
  }

  if (!["admin", "hr", "employee"].includes(normalizedRole)) {
    return res.status(400).json({ ok: false, error: "Invalid role" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const redirectTo = process.env.ERP_REDIRECT_URL;

  if (!supabaseUrl || !anonKey || !serviceKey || !redirectTo) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ERP_REDIRECT_URL",
    });
  }

  const accessToken = getAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  try {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sessionUser, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !sessionUser?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const targetUser = await findOrCreateUser(adminClient, normalizedEmail);

    const { data: rpcData, error: rpcError } = await userClient.rpc("erp_invite_company_user", {
      p_target_user_id: targetUser.id,
      p_role_key: normalizedRole,
    });

    if (rpcError) {
      return res.status(400).json({
        ok: false,
        error: rpcError.message,
        details: rpcError.details || rpcError.hint || rpcError.code,
      });
    }

    const { error: linkError } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: { redirectTo },
    });

    if (linkError) {
      return res.status(500).json({
        ok: false,
        error: linkError.message || "Failed to send recovery link",
        details: linkError.details || linkError.hint || linkError.code,
      });
    }

    return res.status(200).json({
      ok: true,
      invite: rpcData,
      recovery_link_sent: true,
      target_user_id: targetUser.id,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
