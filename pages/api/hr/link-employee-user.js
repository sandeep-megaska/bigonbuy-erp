import { createClient } from "@supabase/supabase-js";

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

    const admin = createClient(supabaseUrl, serviceKey);

    const { companyId, employeeId, employeeEmail } = req.body || {};
    if (!companyId || !employeeId || !employeeEmail) {
      return res.status(400).json({ ok: false, error: "companyId, employeeId, employeeEmail are required" });
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

    return res.status(200).json({ ok: true, userId: user.id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
