import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal_id: string | null; journal_no: string | null };
type ApiResponse = ErrorResponse | SuccessResponse;

const parseDateParam = (value: string | string[] | undefined) => {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
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

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const day = parseDateParam(req.query.day) || parseDateParam(req.body?.day as string | undefined);
  if (!day) {
    return res.status(400).json({ ok: false, error: "day is required" });
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

    const { data: journalId, error: postError } = await userClient.rpc("erp_shopify_sales_day_post_to_finance", {
      p_day: day,
      p_actor_user_id: userData.user.id,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post Shopify daily journal",
        details: postError.details || postError.hint || postError.code,
      });
    }

    if (!journalId) {
      return res.status(200).json({ ok: true, journal_id: null, journal_no: null });
    }

    const { data: journalData, error: journalError } = await userClient
      .from("erp_fin_journals")
      .select("id, doc_no")
      .eq("id", journalId as string)
      .maybeSingle();

    if (journalError || !journalData) {
      return res.status(200).json({ ok: true, journal_id: journalId as string, journal_no: null });
    }

    return res.status(200).json({ ok: true, journal_id: journalData.id, journal_no: journalData.doc_no ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
