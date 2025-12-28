import { getSupabaseAdminClient, findUserByEmail } from "../../../lib/supabaseAdmin";

async function validateToken(admin, token) {
  const { data, error } = await admin
    .from("erp_employee_onboarding_tokens")
    .select("employee_id, company_id, expires_at, used_at")
    .eq("token", token)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Invalid token");

  const now = new Date();
  const expiry = data.expires_at ? new Date(data.expires_at) : null;
  if (!expiry || expiry < now) throw new Error("Token has expired");
  if (data.used_at) throw new Error("Token already used");

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const admin = getSupabaseAdminClient();
    const { token, email, password } = req.body || {};

    if (!token || !email || !password) {
      return res.status(400).json({ ok: false, error: "token, email, and password are required" });
    }

    const tokenRow = await validateToken(admin, token);
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "").trim();

    if (!cleanEmail || !cleanPassword) {
      return res.status(400).json({ ok: false, error: "Email and password are required" });
    }

    // Find or create user
    let user = await findUserByEmail(admin, cleanEmail);
    if (!user) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: cleanEmail,
        password: cleanPassword,
        email_confirm: true,
      });
      if (createErr) return res.status(500).json({ ok: false, error: createErr.message });
      user = created.user;
    } else {
      const { error: updateErr } = await admin.auth.admin.updateUserById(user.id, {
        password: cleanPassword,
      });
      if (updateErr) return res.status(500).json({ ok: false, error: updateErr.message });
    }

    // Upsert mapping
    const { error: upsertErr } = await admin
      .from("erp_employee_users")
      .upsert(
        {
          company_id: tokenRow.company_id,
          employee_id: tokenRow.employee_id,
          user_id: user.id,
          is_active: true,
        },
        { onConflict: "company_id,employee_id" }
      );
    if (upsertErr) return res.status(500).json({ ok: false, error: upsertErr.message });

    // Mark token used
    const { error: useErr } = await admin
      .from("erp_employee_onboarding_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("token", token);
    if (useErr) return res.status(500).json({ ok: false, error: useErr.message });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(400).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
