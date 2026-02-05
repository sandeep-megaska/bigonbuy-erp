import type { NextApiRequest, NextApiResponse } from "next";
import { requireErpFinanceApiAuth } from "../../../../../../../lib/erp/financeApiAuth";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal_id: string | null; journal_no: string | null };
type ApiResponse = ErrorResponse | SuccessResponse;

// If you want debug without breaking response typing, use ok:false with details,
// or keep it behind "debug=1" and return ErrorResponse shape.
export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const batchId = typeof req.query.batchId === "string" ? req.query.batchId : null;
  if (!batchId) {
    return res.status(400).json({ ok: false, error: "batchId is required" });
  }

  // TEMP DEBUG: doesn't break TS types
  if (req.query.debug === "1") {
    const hasAuthHeader = Boolean(req.headers.authorization);
    const cookieKeys = Object.keys(req.cookies ?? {});
    return res.status(401).json({
      ok: false,
      error: "DEBUG",
      details: JSON.stringify({
        hit: "api/erp/finance/amazon/settlement-posting/[batchId]/post.ts",
        method: req.method,
        batchId,
        hasAuthHeader,
        cookieCount: cookieKeys.length,
        cookieKeys: cookieKeys.slice(0, 30),
      }),
    });
  }

  const auth = await requireErpFinanceApiAuth(req, "finance_writer");
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  try {
    // Stage-1: idempotent post (server RPC decides if already posted)
    const { data: journalId, error: postError } = await auth.client.rpc("erp_amazon_settlement_batch_post_to_finance", {
      p_batch_id: batchId,
      p_actor_user_id: auth.user.id,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post Amazon settlement batch",
        details: postError.details || postError.hint || postError.code,
      });
    }

    if (!journalId) {
      return res.status(200).json({ ok: true, journal_id: null, journal_no: null });
    }

    const { data: journalRow, error: journalErr } = await auth.client
      .from("erp_fin_journals")
      .select("id, doc_no")
      .eq("id", journalId as string)
      .maybeSingle();

    if (journalErr || !journalRow) {
      return res.status(200).json({ ok: true, journal_id: journalId as string, journal_no: null });
    }

    return res.status(200).json({ ok: true, journal_id: journalRow.id, journal_no: journalRow.doc_no ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
