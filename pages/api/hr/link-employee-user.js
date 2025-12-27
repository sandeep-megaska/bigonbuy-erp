import { createClient } from "@supabase/supabase-js";

async function getAuthenticatedUser(admin, req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { user: null, error: "Unauthorized" };

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return { user: null, error: "Unauthorized" };

  return { user: data.user, error: null };
}

async function requireHrAccess(admin, userId, companyId) {
  const { data, error } = await admin
    .from("erp_company_users")
    .select("company_id, role_key, is_active")
    .eq("user_id", userId)
    .eq("company_id", companyId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return false;

  return ["owner", "admin", "hr"].includes(data.role_key);
}

async function findUserByEmail(admin, email) {
  const target = String(email || "").trim().toLowerCase();
  if (!target) return null;

  // listUsers is paginated. We'll iterate safely.
  let page = 1;
  const perPage = 200; // keep reasonable

  for (let i = 0; i < 20; i++) { // up to 4000 users scan (more than enough for you)
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    const users = data?.users || [];
    const match = users.find((u) => (u.email || "").toLowerCase() === target);
    if (match) return match;

    if (users.length < perPage) break; // last page
    page++;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE URL" });
    }

    const admin = createClient(supabaseUrl, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { companyId, employeeId, employeeEmail } = req.body || {};
    if (!companyId || !employeeId || !employeeEmail) {
      return res.status(400).json({ ok: false, error: "companyId, employeeId, employeeEmail are required" });
    }

    const { user: requester, error: authError } = await getAuthenticatedUser(admin, req);
    if (authError || !requester) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const canAccess = await requireHrAccess(admin, requester.id, companyId);
    if (!canAccess) {
      return res.status(403).json({ ok: false, error: "Forbidden" });
    }

    // 1) Find auth user by email
    let user = await findUserByEmail(admin, employeeEmail);

    // 2) If not found, create
    if (!user) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: employeeEmail,
        email_confirm: true,
      });
      if (createErr) return res.status(500).json({ ok: false, error: createErr.message });
      user = created.user;
    }

    // 3) Upsert mapping
    const { error: upErr } = await admin
      .from("erp_employee_users")
      .upsert(
        { company_id: companyId, employee_id: employeeId, user_id: user.id, is_active: true },
        { onConflict: "company_id,employee_id" }
      );

    if (upErr) return res.status(500).json({ ok: false, error: upErr.message });

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: employeeEmail,
    });

    if (linkErr) return res.status(500).json({ ok: false, error: linkErr.message });

    const recoveryLink = linkData?.properties?.action_link || null;

    return res.status(200).json({ ok: true, userId: user.id, recoveryLink });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
