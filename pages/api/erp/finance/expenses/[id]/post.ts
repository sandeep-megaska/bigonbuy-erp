import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type JournalSummary = { id: string; doc_no?: string | null; status?: string | null } | null;

type PostingSummary = {
  posted: boolean;
  journal: { id: string | null; doc_no: string | null } | null;
  link?: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal: JournalSummary; post: PostingSummary };
type ApiResponse = ErrorResponse | SuccessResponse;

const getExpenseIdParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

const normalizePosting = (data: any): PostingSummary => {
  const posted = Boolean(data?.posted);
  if (!posted) {
    return { posted: false, journal: null, link: null };
  }
  return {
    posted: true,
    journal: {
      id: data?.finance_doc_id ?? null,
      doc_no: data?.journal_no ?? null,
    },
    link: data?.link ?? null,
  };
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
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

  const expenseId = getExpenseIdParam(req.query.id) || (req.body?.expenseId as string | undefined);
  if (!expenseId) {
    return res.status(400).json({ ok: false, error: "expenseId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (req.method === "GET") {
      const { data, error } = await userClient.rpc("erp_expense_finance_posting_get", {
        p_expense_id: expenseId,
      });
      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load expense finance posting",
          details: error.details || error.hint || error.code,
        });
      }

      const post = normalizePosting(data);
      const journal = post.posted && post.journal?.id ? { id: post.journal.id, doc_no: post.journal.doc_no } : null;

      return res.status(200).json({ ok: true, journal, post });
    }

    const { data: membership, error: membershipError } = await userClient
      .from("erp_company_users")
      .select("company_id")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (membershipError || !membership?.company_id) {
      return res.status(400).json({
        ok: false,
        error: membershipError?.message || "Company membership not found",
      });
    }

    const { data: journalId, error: postError } = await userClient.rpc("erp_expense_post_to_finance", {
      p_company_id: membership.company_id,
      p_expense_id: expenseId,
      p_posted_by_user_id: userData.user.id,
    });

    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to post expense journal",
        details: postError.details || postError.hint || postError.code,
      });
    }

    const { data: postData, error: postReadError } = await userClient.rpc("erp_expense_finance_posting_get", {
      p_expense_id: expenseId,
    });

    if (postReadError) {
      return res.status(400).json({
        ok: false,
        error: postReadError.message || "Failed to load expense finance posting",
        details: postReadError.details || postReadError.hint || postReadError.code,
      });
    }

    const post = normalizePosting(postData);
    let journal: JournalSummary = null;

    if (journalId) {
      const { data: journalData, error: journalError } = await userClient.rpc("erp_fin_journal_get", {
        p_journal_id: journalId,
      });
      if (!journalError && journalData?.header) {
        journal = {
          id: journalData.header.id,
          doc_no: journalData.header.doc_no,
          status: journalData.header.status,
        };
      }
    }

    if (!journal && post.posted && post.journal?.id) {
      journal = {
        id: post.journal.id,
        doc_no: post.journal.doc_no,
        status: null,
      };
    }

    return res.status(200).json({ ok: true, journal, post });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
