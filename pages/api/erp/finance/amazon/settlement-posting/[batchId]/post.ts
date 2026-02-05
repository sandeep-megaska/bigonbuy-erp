import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal_id: string | null; journal_no: string | null; link: string | null };
type ApiResponse = ErrorResponse | SuccessResponse;

const getPathParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // DEBUG: confirm request hits this file + auth header presence
  if (req.query.debug === "auth") {
    const authHeader = req.headers.authorization ?? null;
    return res.status(200).json({
      ok: true,
      journal_id: null,
      journal_no: null,
      link: null,
      // extra debug info
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { data: {
        hit: "api/erp/finance/amazon/settlement-posting/[batchId]/post.ts",
        method: req.method,
        batchId: getPathParam(req.query.batchId),
        hasAuthorizationHeader: Boolean(authHeader),
        authorizationPrefix: authHeader ? authHeader.slice(0, 20) : null,
      }} as any),
    });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  // Shopify-style: require Bearer token
  const accessToken = getBearerToken(req);
  if (!accessToken) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const batchId = getPathParam(req.query.batchId) ?? (req.body?.batchId as string | undefined);
  if (!batchId) return res.status(400).json({ ok: false, error: "batchId is required" });

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

    // Stage-1 posting RPC (idempotent). If your DB function name differs, change it here only.
    const { data: journalId, error: postError } = await userClient.rpc("erp_amazon_settlement_batch_post_to_finance", {
      p_batch_id: batchId,
      p_actor_user_id: userData.user.id,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post Amazon settlement batch",
        details: postError.details || postError.hint || postError.code,
      });
    }

    if (!journalId) {
      return res.status(200).json({ ok: true, journal_id: null, journal_no: null, link: null });
    }

    const { data: journalRow, error: journalError } = await userClient
      .from("erp_fin_journals")
      .select("id, doc_no")
      .eq("id", journalId as string)
      .maybeSingle();

    if (journalError || !journalRow) {
      return res.status(200).json({
        ok: true,
        journal_id: journalId as string,
        journal_no: null,
        link: `/erp/finance/journals/${journalId}`,
      });
    }

    return res.status(200).json({
      ok: true,
      journal_id: journalRow.id,
      journal_no: journalRow.doc_no ?? null,
      link: `/erp/finance/journals/${journalRow.id}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
