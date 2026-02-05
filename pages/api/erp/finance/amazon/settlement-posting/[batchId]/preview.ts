import type { NextApiRequest, NextApiResponse } from "next";
import { requireErpFinanceApiAuth } from "../../../../../../../lib/erp/financeApiAuth";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

const parseStringParam = (value: string | string[] | undefined) => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // TEMP DEBUG (remove after fix)
  if (parseStringParam(req.query.debug) === "auth") {
    const cookieKeys = Object.keys(req.cookies ?? {});
    return res.status(200).json({
      ok: true,
      data: {
        hit: "api/erp/finance/amazon/settlement-posting/[batchId]/preview.ts",
        method: req.method,
        batchId: parseStringParam(req.query.batchId) ?? null,
        hasAuthHeader: Boolean(req.headers.authorization),
        hasCookieHeader: Boolean(req.headers.cookie),
        cookieCount: cookieKeys.length,
        cookieKeys: cookieKeys.slice(0, 30),
      },
    });
  }

  const batchId = parseStringParam(req.query.batchId);
  if (!batchId) return res.status(400).json({ ok: false, error: "batchId is required" });

  const auth = await requireErpFinanceApiAuth(req, "finance_reader");
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  try {
    const { data, error } = await auth.client.rpc("erp_amazon_settlement_posting_preview", {
      p_batch_id: batchId,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load preview",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
