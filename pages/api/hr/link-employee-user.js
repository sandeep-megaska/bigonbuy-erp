import { createClient } from "@supabase/supabase-js";

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

    // 1) Find existing auth user by email
    const { data: usersData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 2000 });
    if (listErr) return res.status(500).json({ ok: false, error: listErr.message });

    const found = (usersData?.users || []).find(
      (u) => (u.email || "").toLowerCase() === String(employeeEmail).toLowerCase()
    );

    let userId = found?.id;

    // 2) If user doesn't exist, create one
    if (!userId) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: employeeEmail,
        email_confirm: true,
      });
      if (createErr) return res.status(500).json({ ok: false, error: createErr.message });
      userId = created.user.id;
    }

    // 3) Create/Upsert mapping in erp_employee_users
    const { error: upErr } = await admin
      .from("erp_employee_users")
      .upsert(
        { company_id: companyId, employee_id: employeeId, user_id: userId, is_active: true },
        { onConflict: "company_id,employee_id" }
      );

    if (upErr) return res.status(500).json({ ok: false, error: upErr.message });

    return res.status(200).json({ ok: true, userId });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
