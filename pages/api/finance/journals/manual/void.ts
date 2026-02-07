import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type VoidBody = {
  companyId?: string;
  journalId?: string;
  reason?: string;
  voidDate?: string;
};

type ApiResponse = { ok: true; reversalJournalId: string } | { ok: false; error: string; details?: string | null };

const isIsoDate = (value: string | undefined): value is string => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
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
  if (!accessToken) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const body = (req.body || {}) as VoidBody;
  if (!body.companyId) return res.status(400).json({ ok: false, error: "companyId is required" });
  if (!body.journalId) return res.status(400).json({ ok: false, error: "journalId is required" });
  if (!body.reason?.trim()) return res.status(400).json({ ok: false, error: "reason is required" });
  if (body.voidDate && !isIsoDate(body.voidDate)) {
    return res.status(400).json({ ok: false, error: "voidDate must be YYYY-MM-DD" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_fin_manual_journal_void", {
      p_company_id: body.companyId,
      p_journal_id: body.journalId,
      p_reason: body.reason.trim(),
      p_void_date: body.voidDate ?? null,
    });

    if (error || !data) {
      return res.status(400).json({
        ok: false,
        error: error?.message || "Failed to void manual journal",
        details: error?.details || error?.hint || error?.code,
      });
    }

    return res.status(200).json({ ok: true, reversalJournalId: String(data) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
