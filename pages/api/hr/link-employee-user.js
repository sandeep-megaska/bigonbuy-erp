// pages/api/hr/create-onboarding-link.js
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function getBaseUrl(req) {
  // Prefer env var, fallback to request host
  const envBase = process.env.ERP_PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "https").toString();
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").toString();
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
    }

    const { companyId, employeeId } = req.body || {};
    if (!companyId || !employeeId) {
      return res.status(400).json({ ok: false, error: "companyId and employeeId are required" });
    }

    // IMPORTANT: AuthZ check — requester must be logged in and HR/admin/owner of this company.
    // We do this by reading the bearer token and checking erp_company_users using anon client.
    const authHeader = req.headers.authorization || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!jwt) {
      return res.status(401).json({ ok: false, error: "Missing Authorization Bearer token" });
    }

    // Client with anon key for verifying user + RLS-protected membership query
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) {
      return res.status(500).json({ ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY" });
    }

    const supa = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const { data: udata, error: uerr } = await supa.auth.getUser();
    if (uerr || !udata?.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    // Must be HR/admin/owner for the same company
    const { data: member, error: merr } = await supa
      .from("erp_company_users")
      .select("role_key, is_active, company_id")
      .eq("company_id", companyId)
      .eq("user_id", udata.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (merr) return res.status(403).json({ ok: false, error: merr.message });
    if (!member) return res.status(403).json({ ok: false, error: "Not a member of this company" });

    const role = member.role_key;
    if (!["owner", "admin", "hr"].includes(role)) {
      return res.status(403).json({ ok: false, error: "Not authorized" });
    }

    // Service role client for inserting token
    const admin = createClient(supabaseUrl, serviceKey);

    const token = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: insErr } = await admin.from("erp_employee_onboarding_tokens").insert({
      company_id: companyId,
      employee_id: employeeId,
      token,
      expires_at: expiresAt,
      used_at: null,
      created_by: udata.user.id,
    });

    if (insErr) {
      return res.status(500).json({ ok: false, error: insErr.message });
    }

    const baseUrl = getBaseUrl(req);
    const link = `${baseUrl}/join?token=${token}`;

    return res.status(200).json({ ok: true, link, expiresAt });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}

