import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };

type SuccessResponse = {
  ok: true;
  journal: { id: string | null; doc_no: string | null } | null;
};

type ApiResponse = ErrorResponse | SuccessResponse;

const getOrderId = (value: string | string[] | undefined): string | null => {
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

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const orderId = getOrderId(req.query.id) || (req.body?.orderId as string | undefined);
  if (!orderId) {
    return res.status(400).json({ ok: false, error: "orderId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const payload = (req.body ?? {}) as {
      refund_source_id?: string | null;
      refundSourceId?: string | null;
      idempotency_key?: string | null;
      idempotencyKey?: string | null;
    };

    const refundSourceId = payload.refund_source_id ?? payload.refundSourceId ?? null;
    if (!refundSourceId) {
      return res.status(400).json({ ok: false, error: "refund_source_id is required" });
    }

    const idempotencyKey = payload.idempotency_key ?? payload.idempotencyKey ?? null;

    const { data: journalId, error: postError } = await userClient.rpc("erp_sales_finance_refund_post", {
      p_order_id: orderId,
      p_refund_source_id: refundSourceId,
      p_idempotency_key: idempotencyKey,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post refund journal",
        details: postError.details || postError.hint || postError.code,
      });
    }

    let journal: { id: string | null; doc_no: string | null } | null = null;

    if (journalId) {
      const { data: journalData, error: journalError } = await userClient.rpc("erp_fin_journal_get", {
        p_journal_id: journalId,
      });
      if (!journalError && journalData?.header) {
        journal = {
          id: journalData.header.id ?? null,
          doc_no: journalData.header.doc_no ?? null,
        };
      } else {
        journal = { id: journalId, doc_no: null };
      }
    }

    return res.status(200).json({ ok: true, journal });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
