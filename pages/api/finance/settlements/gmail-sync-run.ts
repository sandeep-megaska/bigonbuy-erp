// pages/api/finance/settlements/gmail-sync-run.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createPagesServerClient } from "@supabase/auth-helpers-nextjs";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const supabase = createPagesServerClient({ req, res });
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const start = Array.isArray(req.query.start) ? req.query.start[0] : req.query.start;
    const end = Array.isArray(req.query.end) ? req.query.end[0] : req.query.end;
    if (!start || !end) {
      return res.status(400).json({ ok: false, error: "Missing start or end date" });
    }

    const secret = process.env.ERP_INTERNAL_JOB_SECRET;
    if (!secret) {
      return res.status(500).json({ ok: false, error: "Missing ERP_INTERNAL_JOB_SECRET in env" });
    }

    const baseUrl = `https://${req.headers.host}`;
    const jobUrl =
      `${baseUrl}/api/finance/settlements/gmail-sync?start=` +
      encodeURIComponent(String(start)) +
      `&end=` +
      encodeURIComponent(String(end));

    const jobResp = await fetch(jobUrl, {
      method: "POST",
      headers: { "x-bb-secret": secret },
    });

    const json = await jobResp.json().catch(() => null);
    return res.status(jobResp.status).json(json ?? { ok: false, error: "Job returned invalid JSON" });
  } catch (e: any) {
    console.error("gmail-sync-run failed", e);
    return res.status(500).json({ ok: false, error: e?.message || "Unexpected error" });
  }
}
