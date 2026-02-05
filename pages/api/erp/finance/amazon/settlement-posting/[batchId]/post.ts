import type { NextApiRequest, NextApiResponse } from "next";
import { requireErpFinanceApiAuth } from "../../../../../../../lib/erp/financeApiAuth";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal_id: string | null; journal_no: string | null };
type ApiResponse = ErrorResponse | SuccessResponse;

const parseStringParam = (value: string | string[] | undefined) => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // TEMP DEBUG (remove after fix)
  if (parseStringParam(req.query.debug) === "auth") {
    const cookieKeys = Object.keys(req.cookies ?? {});
    return res.status(200).json({
      ok: true,
      journal_id: null,
      journal_no: null,
      // keep shape stable
      // @ts-expect-error debug payload
      data: {
        hit: "api/erp/finance/amazon/settlement-posting/[batchId]/post.ts",
        method: req.method,
        batchId: parseStringParam(req.query.batchId) ?? null,
        hasAuthHeader: Boolean(req.headers.authorization),
        hasCookieHeader: Boolean(req.headers.cookie),
        cookieCount: cookieKeys.length,
        cookieKeys: cookieKeys.slice(0, 30),
      },
    } as any);
  }

  const batchId = parseStringParam(req.query.batchId) ?? parseStringParam((req.body as any)?.batchId);
  if (!batchId) return res.status(400).json({ ok: false, error: "batchId is required" });

  const auth = await requireErpFinanceApiAuth(req, "finance_writer");
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error });

  try {
    const actorUserId = auth.user?.id ?? null;

    const { data: journalId, error: postError } = await auth.client.rpc("erp_amazon_settlement_post_to_finance", {
      p_batch_id: batchId,
      p_actor_user_id: actorUserId,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post batch",
        details: postError.details || postError.hint || postError.code,
      });
    }

    if (!journalId) return res.status(200).json({ ok: true, journal_id: null, journal_no: null });

    const { data: j, error: jErr } = await auth.client
      .from("erp_fin_journals")
      .select("id, doc_no")
      .eq("id", journalId as string)
      .maybeSingle();

    if (jErr || !j) return res.status(200).json({ ok: true, journal_id: journalId as string, journal_no: null });

    return res.status(200).json({ ok: true, journal_id: j.id, journal_no: j.doc_no ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
