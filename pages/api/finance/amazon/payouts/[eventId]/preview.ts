import type { NextApiRequest, NextApiResponse } from "next";
import { requireErpFinanceApiAuth } from "../../../../../../lib/erp/financeApiAuth";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

const getPathParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireErpFinanceApiAuth(req, "finance_reader");
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  const batchId = getPathParam(req.query.eventId) ?? getPathParam(req.query.batchId);
  if (!batchId) return res.status(400).json({ ok: false, error: "batchId is required" });

  try {
    const { data, error } = await auth.client.rpc("erp_amazon_settlement_journal_preview", {
      p_batch_id: batchId,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load Amazon settlement preview",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
