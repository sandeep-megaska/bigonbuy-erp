import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../../lib/serverSupabase";

type PostingSummary = {
  posted: boolean;
  journal_id: string | null;
  journal_no: string | null;
  link: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = PostingSummary & { ok: true };
type ApiResponse = ErrorResponse | SuccessResponse;

const getOrderIdParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

const normalizePosting = (data: any): PostingSummary => {
  const posted = Boolean(data?.posted?.journal_id || data?.posted?.doc_no);
  if (!posted) {
    return { posted: false, journal_id: null, journal_no: null, link: null };
  }
  const journalId = data?.posted?.journal_id ?? null;
  return {
    posted: true,
    journal_id: journalId,
    journal_no: data?.posted?.doc_no ?? null,
    link: journalId ? `/erp/finance/journals/${journalId}` : null,
  };
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

  const orderId = getOrderIdParam(req.query.id) || (req.body?.orderId as string | undefined);
  if (!orderId) {
    return res.status(400).json({ ok: false, error: "orderId is required" });
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

    const { error: postError } = await userClient.rpc("erp_shopify_sales_finance_post", {
      p_source_id: orderId,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post Shopify order journal",
        details: postError.details || postError.hint || postError.code,
      });
    }

    const { data: previewData, error: previewError } = await userClient.rpc("erp_sales_finance_posting_preview", {
      p_order_id: orderId,
    });

    if (previewError) {
      return res.status(400).json({
        ok: false,
        error: previewError.message || "Failed to load Shopify posting preview",
        details: previewError.details || previewError.hint || previewError.code,
      });
    }

    const post = normalizePosting(previewData);
    return res.status(200).json({ ok: true, ...post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
