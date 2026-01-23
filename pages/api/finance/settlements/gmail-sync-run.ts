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
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    if (!supabaseUrl || !anonKey) {
      return res
        .status(500)
        .json({ ok: false, error: "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY" });
    }

    // 1) Bearer token auth (works even if no cookies)
    const token = getBearer(req);
    if (token) {
      const sb = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const {
        data: { user },
        error,
      } = await sb.auth.getUser(token);
      if (error || !user) return res.status(401).json({ ok: false, error: "Not authenticated" });
    } else {
      // 2) Cookie fallback
      const sb = createPagesServerClient({ req, res });
      const {
        data: { user },
        error,
      } = await sb.auth.getUser();
      if (error || !user) return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const start = Array.isArray(req.query.start) ? req.query.start[0] : req.query.start;
    const end = Array.isArray(req.query.end) ? req.query.end[0] : req.query.end;
    if (!start || !end) return res.status(400).json({ ok: false, error: "Missing start or end date" });

    const secret = process.env.ERP_INTERNAL_JOB_SECRET;
    if (!secret) return res.status(500).json({ ok: false, error: "Missing ERP_INTERNAL_JOB_SECRET" });

    const baseUrl = `https://${req.headers.host}`;
    const jobUrl = `${baseUrl}/api/finance/settlements/gmail-sync?start=${encodeURIComponent(
      String(start),
    )}&end=${encodeURIComponent(String(end))}`;

    const jobResp = await fetch(jobUrl, { method: "POST", headers: { "x-bb-secret": secret } });
    const json = await jobResp.json().catch(() => null);
    return res.status(jobResp.status).json(json ?? { ok: false, error: "Job returned invalid JSON" });
  } catch (e: any) {
    console.error("gmail-sync-run failed", e);
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
