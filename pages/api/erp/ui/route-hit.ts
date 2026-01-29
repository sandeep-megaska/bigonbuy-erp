import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type RouteHitBody = {
  route?: string;
  kind?: string;
  referrer?: string | null;
  meta?: Record<string, unknown> | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const body: RouteHitBody =
    typeof req.body === "string" ? (JSON.parse(req.body) as RouteHitBody) : req.body ?? {};
  const route = typeof body?.route === "string" ? body.route.trim() : "";
  const kind = typeof body?.kind === "string" ? body.kind.trim() : "";
  const referrer = typeof body?.referrer === "string" ? body.referrer.trim() : null;
  const meta = body?.meta && typeof body.meta === "object" ? body.meta : {};

  if (!route || !kind) {
    return res.status(400).json({ ok: false, error: "Missing route or kind" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { error } = await userClient.rpc("erp_ui_route_hit_insert", {
    p_route: route,
    p_kind: kind,
    p_referrer: referrer,
    p_user_agent: req.headers["user-agent"] ?? null,
    p_meta: meta,
  });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message || "Failed to log route hit" });
  }

  return res.status(200).json({ ok: true });
}
