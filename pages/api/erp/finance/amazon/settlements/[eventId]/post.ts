import type { NextApiRequest, NextApiResponse } from "next";
import { requireErpFinanceApiAuth } from "../../../../../../../lib/erp/financeApiAuth";

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

  const auth = await requireErpFinanceApiAuth(req, "finance_writer");
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const batchId =
    getPathParam(req.query.eventId) ?? getPathParam(req.query.batchId) ?? (req.body?.batchId as string | undefined);
  if (!batchId) return res.status(400).json({ ok: false, error: "batchId is required" });

  try {
    const { data, error } = await auth.client.rpc("erp_amazon_settlement_post_to_finance", {
      p_batch_id: batchId,
      p_actor_user_id: auth.actorUserId,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to post Amazon settlement journal",
        details: error.details || error.hint || error.code,
      });
    }

    const first = Array.isArray(data) ? data[0] : data;
    const journalId = first?.journal_id ?? null;
    const journalNo = first?.journal_no ?? null;

    return res.status(200).json({
      ok: true,
      journal_id: journalId,
      journal_no: journalNo,
      link: journalId ? `/erp/finance/journals/${journalId}` : null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
