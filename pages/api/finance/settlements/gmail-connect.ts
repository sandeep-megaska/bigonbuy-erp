import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import {
  createUserClient,
  getCookieAccessToken,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type GmailConnectResponse = {
  ok: boolean;
  error?: string;
  settings?: {
    gmail_connected: boolean | null;
    gmail_user: string | null;
    gmail_last_synced_at: string | null;
  } | null;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GmailConnectResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
    });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;
  const legacyServiceKey = process.env.SUPABASE_SERVICE_KEY ?? null;
  const serviceKey = serviceRoleKey || legacyServiceKey;
  if (!serviceKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) in Vercel env",
    });
  }

  const accessToken = getCookieAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { error: writerError } = await userClient.rpc("erp_require_finance_writer");
  if (writerError) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  const gmailUserEnv = process.env.GMAIL_USER?.trim() || null;
  if (!gmailUserEnv) {
    return res.status(500).json({
      ok: false,
      error: "Missing GMAIL_USER env var for Gmail connection.",
    });
  }

  const sbAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settings, error: settingsError } = await sbAdmin.rpc("erp_company_settings_get");
  if (settingsError || !settings?.[0]) {
    return res.status(500).json({
      ok: false,
      error: settingsError?.message || "Unable to load company settings",
    });
  }

  const currentSettings = settings[0];
  const { error: connectError } = await sbAdmin.rpc("erp_company_settings_update_gmail", {
    p_gmail_user: gmailUserEnv,
    p_connected: true,
    p_last_synced_at: currentSettings.gmail_last_synced_at ?? null,
  });

  if (connectError) {
    return res.status(500).json({
      ok: false,
      error: connectError.message || "Unable to update Gmail connection status",
    });
  }

  return res.status(200).json({
    ok: true,
    settings: {
      gmail_connected: true,
      gmail_user: gmailUserEnv,
      gmail_last_synced_at: currentSettings.gmail_last_synced_at ?? null,
    },
  });
}
