import type { NextApiRequest, NextApiResponse } from "next";
import {
  createUserClient,
  getBearerToken,
  getCookieAccessToken,
  getSupabaseEnv,
} from "../../../../../../../lib/serverSupabase";

type PostingSummary = {
  posted: boolean;
  journal_id: string | null;
  journal_no: string | null;
  link: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = PostingSummary & { ok: true };
type ApiResponse = ErrorResponse | SuccessResponse;

const getBatchIdParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

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

  const accessToken = getBearerToken(req) ?? getCookieAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization token" });
  }

  const batchId = getBatchIdParam(req.query.batchId) || (req.body?.batchId as string | undefined);
  if (!batchId) {
    return res.status(400).json({ ok: false, error: "batchId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { error: permissionError } = await userClient.rpc("erp_require_finance_writer");
    if (permissionError) {
      return res.status(403).json({ ok: false, error: permissionError.message || "Finance write access required" });
    }

    const { data: journalId, error: postError } = await userClient.rpc("erp_amazon_settlement_post_to_finance", {
      p_batch_id: batchId,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post Amazon settlement journal",
        details: postError.details || postError.hint || postError.code,
      });
    }

    if (!journalId) {
      return res.status(400).json({ ok: false, error: "No journal created" });
    }

    const { data: journal, error: journalError } = await userClient
      .from("erp_fin_journals")
      .select("id, doc_no")
      .eq("id", journalId)
      .maybeSingle();

    if (journalError) {
      return res.status(400).json({
        ok: false,
        error: journalError.message || "Failed to load journal details",
        details: journalError.details || journalError.hint || journalError.code,
      });
    }

    const summary: PostingSummary = {
      posted: true,
      journal_id: journal?.id ?? journalId,
      journal_no: journal?.doc_no ?? null,
      link: journal?.id ? `/erp/finance/journals/${journal.id}` : null,
    };

    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
