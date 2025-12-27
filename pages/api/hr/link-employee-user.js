import { createClient } from "@supabase/supabase-js";

const AUTHORIZED_ROLES = ["owner", "admin", "hr"];
const DEFAULT_REDIRECT = "https://erp.bigonbuy.com/reset-password";

function jsonError(res, status, message) {
  return res.status(status).json({ ok: false, error: message || "Unexpected error" });
}

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

async function assertRoleForCompany({ supabaseUrl, anonKey, accessToken, companyId }) {
  const supa = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: udata, error: uerr } = await supa.auth.getUser();
  if (uerr || !udata?.user) {
    return { status: 401, error: "Invalid session" };
  }

  const { data: member, error: merr } = await supa
    .from("erp_company_users")
    .select("role_key, is_active, company_id")
    .eq("company_id", companyId)
    .eq("user_id", udata.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (merr) return { status: 403, error: merr.message };
  if (!member) return { status: 403, error: "Not a member of this company" };
  if (!AUTHORIZED_ROLES.includes(member.role_key)) return { status: 403, error: "Not authorized" };

  return { status: 200, userId: udata.user.id };
}

async function findUserByEmail(adminClient, email) {
  let page = 1;
  const perPage = 100;
  const target = email.toLowerCase();

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonError(
      res,
      500,
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return jsonError(res, 401, "Missing Authorization Bearer token");
  }

  const { companyId, employeeId, employeeEmail } = req.body || {};
  if (!companyId || !employeeId || !employeeEmail) {
    return jsonError(res, 400, "companyId, employeeId, and employeeEmail are required");
  }

  try {
    const authz = await assertRoleForCompany({ supabaseUrl, anonKey, accessToken, companyId });
    if (authz.status !== 200) {
      return jsonError(res, authz.status, authz.error);
    }

    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const normalizedEmail = employeeEmail.trim().toLowerCase();
    const user = await findOrCreateUser(adminClient, normalizedEmail);

    const { error: upsertErr } = await adminClient.from("erp_employee_users").upsert(
      {
        company_id: companyId,
        employee_id: employeeId,
        user_id: user.id,
        is_active: true,
      },
      { onConflict: "company_id,employee_id" }
    );

    if (upsertErr) {
      return jsonError(res, 500, upsertErr.message);
    }

    const redirectTo = process.env.ERP_REDIRECT_URL || DEFAULT_REDIRECT;
    const { data: linkData, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: "recovery",
      email: normalizedEmail,
      options: { redirectTo },
    });

    if (linkErr) {
      return jsonError(res, 500, linkErr.message);
    }

    const recoveryLink = linkData?.properties?.action_link || null;

    return res.status(200).json({
      ok: true,
      recoveryLink,
      userId: user.id,
    });
  } catch (e) {
    return jsonError(res, 500, e?.message || "Unknown error");
  }
}
