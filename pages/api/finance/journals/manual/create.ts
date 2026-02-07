import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type JournalLineInput = {
  account_code?: string | null;
  account_name?: string | null;
  debit?: number | string | null;
  credit?: number | string | null;
  memo?: string | null;
};

type CreateBody = {
  companyId?: string;
  journalDate?: string;
  memo?: string | null;
  currency?: string | null;
  clientKey?: string | null;
  lines?: JournalLineInput[];
};

type ApiResponse = { ok: true; journalId: string } | { ok: false; error: string; details?: string | null };

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

  const body = (req.body || {}) as CreateBody;

  if (!body.companyId) {
    return res.status(400).json({ ok: false, error: "companyId is required" });
  }
  if (!isIsoDate(body.journalDate)) {
    return res.status(400).json({ ok: false, error: "journalDate is required in YYYY-MM-DD format" });
  }
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(400).json({ ok: false, error: "At least one line is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_fin_manual_journal_create", {
      p_company_id: body.companyId,
      p_journal_date: body.journalDate,
      p_memo: body.memo ?? null,
      p_lines: body.lines,
      p_currency: body.currency ?? null,
      p_client_key: body.clientKey ?? null,
    });

    if (error || !data) {
      return res.status(400).json({
        ok: false,
        error: error?.message || "Failed to create manual journal",
        details: error?.details || error?.hint || error?.code,
      });
    }

    return res.status(200).json({ ok: true, journalId: String(data) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
