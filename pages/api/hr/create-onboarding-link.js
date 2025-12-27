import crypto from "crypto";
import { getSupabaseAdminClient, getSupabaseUserClient, getBearerToken } from "../../../lib/supabaseAdmin";
import { isHr } from "../../../lib/erpContext";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  try {
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    const { companyId, employeeId } = req.body || {};
    if (!companyId || !employeeId) {
      return res.status(400).json({ ok: false, error: "companyId and employeeId are required" });
    }

    const admin = getSupabaseAdminClient();
    const supabaseUser = getSupabaseUserClient(accessToken);

    // Validate user and membership
    const { data: userData, error: userErr } = await supabaseUser.auth.getUser(accessToken);
    if (userErr || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Invalid or expired session" });
    }
    const userId = userData.user.id;

    const { data: membership, error: memErr } = await supabaseUser
      .from("erp_company_users")
      .select("role_key, is_active")
      .eq("user_id", userId)
      .eq("company_id", companyId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (memErr) {
      return res.status(403).json({ ok: false, error: memErr.message });
    }

    if (!membership || !isHr(membership.role_key)) {
      return res.status(403).json({ ok: false, error: "Permission denied" });
    }

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin.from("erp_employee_onboarding_tokens").insert({
      company_id: companyId,
      employee_id: employeeId,
      token,
      expires_at: expiresAt,
      used_at: null,
      created_by: userId,
    });

    if (insertErr) {
      return res.status(500).json({ ok: false, error: insertErr.message });
    }

    const baseUrl = process.env.ERP_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!baseUrl) {
      return res.status(500).json({ ok: false, error: "ERP_PUBLIC_BASE_URL is not configured" });
    }

    const link = `${baseUrl.replace(/\\/$/, "")}/join?token=${token}`;

    return res.status(200).json({ ok: true, link, expiresAt });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
