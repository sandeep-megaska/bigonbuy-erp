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

export default async function handleLinkEmployeeUser(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const redirectTo = process.env.ERP_REDIRECT_URL;

  if (!supabaseUrl || !anonKey || !serviceKey || !redirectTo) {
    return res
      .status(500)
      .json({
        ok: false,
        error:
          "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, ERP_REDIRECT_URL",
      });
  }

  const accessToken = getAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { employee_id, employee_email } = req.body || {};
  if (!employee_id || !employee_email) {
    return res
      .status(400)
      .json({ ok: false, error: "employee_id and employee_email are required" });
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

    const normalizedEmail = employee_email.trim().toLowerCase();
    const user = await findOrCreateUser(adminClient, normalizedEmail);

    const { data: companyId, error: companyErr } = await userClient.rpc("erp_get_company");
    if (companyErr || !companyId) {
      return res.status(400).json({
        ok: false,
        error: companyErr?.message || "Unable to resolve company",
        details: companyErr?.details || companyErr?.hint || companyErr?.code,
      });
    }

    const { data: rpcData, error: rpcError } = await userClient.rpc("erp_link_employee_login", {
      p_company_id: companyId,
      p_employee_id: employee_id,
      p_auth_user_id: user.id,
      p_employee_email: normalizedEmail,
    });

    if (rpcError) {
      return res.status(400).json({
        ok: false,
        error: rpcError.message,
        details: rpcError.details || rpcError.hint || rpcError.code,
      });
    }

    const resetClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: resetError } = await resetClient.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo,
    });

    if (resetError) {
      return res.status(200).json({
        ok: true,
        warning: "Linked but failed to send reset email",
        email_error: resetError.message,
        result: rpcData,
      });
    }

    return res.status(200).json({ ok: true, result: rpcData });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
