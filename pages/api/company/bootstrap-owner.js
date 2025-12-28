import { createClient } from "@supabase/supabase-js";

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
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

    const { data, error } = await userClient.rpc("erp_bootstrap_owner");
    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to bootstrap owner",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, result: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
