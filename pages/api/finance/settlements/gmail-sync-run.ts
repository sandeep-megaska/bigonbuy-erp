import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

function getBearer(req: NextApiRequest) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Allow GET just for debugging (so you can open it in browser)
    const start = Array.isArray(req.query.start) ? req.query.start[0] : req.query.start;
    const end = Array.isArray(req.query.end) ? req.query.end[0] : req.query.end;

    const hasCookie = Boolean(req.headers.cookie);
    const bearer = getBearer(req);
    const hasAuthHeader = Boolean(req.headers.authorization);
    const hasBearer = Boolean(bearer);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

    const envOk = Boolean(supabaseUrl && anonKey);

    let bearerUserId: string | null = null;
    let bearerErr: string | null = null;

    if (envOk && bearer) {
      const sb = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await sb.auth.getUser(bearer);
      bearerUserId = data?.user?.id ?? null;
      bearerErr = error?.message ?? null;
    }

    let cookieUserId: string | null = null;
    let cookieErr: string | null = null;
    try {
      const sbCookie = createPagesServerClient({ req, res });
      const { data, error } = await sbCookie.auth.getUser();
      cookieUserId = data?.user?.id ?? null;
      cookieErr = error?.message ?? null;
    } catch (e: any) {
      cookieErr = e?.message || "cookie client init failed";
    }

    return res.status(200).json({
      ok: true,
      method: req.method,
      start,
      end,
      received: {
        hasCookie,
        hasAuthHeader,
        hasBearer,
        bearerPrefix: bearer ? bearer.slice(0, 12) + "…" : null,
      },
      env: {
        hasUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
        hasAnon: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
        hasJobSecret: Boolean(process.env.ERP_INTERNAL_JOB_SECRET),
      },
      authCheck: {
        bearerUserId,
        bearerErr,
        cookieUserId,
        cookieErr,
      },
    });
  } catch (e: any) {
    console.error("gmail-sync-run debug failed", e);
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
