import type { NextApiRequest, NextApiResponse } from "next";
import { requireErpFinanceApiAuth } from "../../../../../../../lib/erp/financeApiAuth";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal_id: string | null; journal_no: string | null };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const batchIdRaw = req.query.batchId;
  const batchId = Array.isArray(batchIdRaw) ? batchIdRaw[0] : batchIdRaw;

  if (!batchId || typeof batchId !== "string") {
    return res.status(400).json({ ok: false, error: "batchId is required" });
  }

  // TEMP DEBUG: call .../post?debug=1 (remove later)
  if (req.query.debug === "1") {
    return res.status(200).json({
      ok: true,
      journal_id: null,
      journal_no: null,
    });
  }

  const auth = await requireErpFinanceApiAuth(req, "finance_writer");
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  try {
    // ✅ Don’t rely on auth.user (not present). Ask Supabase using the same authenticated client.
    const { data: userData, error: userErr } = await auth.client.auth.getUser();
    const actorUserId = userData?.user?.id ?? null;

    if (userErr || !actorUserId) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data: journalId, error: postError } = await auth.client.rpc("erp_amazon_settlement_batch_post_to_finance", {
      p_batch_id: batchId,
      p_actor_user_id: actorUserId,
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

    const { data: journalData, error: journalErr } = await auth.client
      .from("erp_fin_journals")
      .select("id, doc_no")
      .eq("id", journalId as string)
      .maybeSingle();

    if (journalErr || !journalData) {
      return res.status(200).json({ ok: true, journal_id: journalId as string, journal_no: null });
    }

    return res.status(200).json({ ok: true, journal_id: journalData.id, journal_no: journalData.doc_no ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
