import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type JournalSummary = { id: string; doc_no?: string | null; status?: string | null } | null;
type PostSummary = {
  posted: boolean;
  journal: { id: string | null; doc_no: string | null } | null;
  link?: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; journal: JournalSummary; post: PostSummary };
type ApiResponse = ErrorResponse | SuccessResponse;


const getRunIdParam = (value: string | string[] | undefined): string | null => {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
};

const normalizePostPayload = (data: any): PostSummary => {
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

  const runId = getRunIdParam(req.query.runId) || (req.body?.runId as string | undefined);
  if (!runId) {
    return res.status(400).json({ ok: false, error: "runId is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (req.method === "GET") {
      const { data, error } = await userClient.rpc("erp_payroll_finance_posting_get", {
        p_run_id: runId,
      });
      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load payroll finance posting",
          details: error.details || error.hint || error.code,
        });
      }

      const post = normalizePostPayload(data);
      const journal = post.posted && post.journal?.id ? { id: post.journal.id, doc_no: post.journal.doc_no } : null;

      return res.status(200).json({ ok: true, journal, post });
    }

    const payload = (req.body ?? {}) as {
      postDate?: string | null;
      notes?: string | null;
      idempotencyKey?: string | null;
    };
    const idempotencyKey = payload.idempotencyKey ?? runId;

    const postParams = {
      p_run_id: runId,
      p_post_date: payload.postDate ?? null,
      p_notes: payload.notes ?? null,
      p_idempotency_key: idempotencyKey,
    };

    let postResult = await userClient.rpc("erp_payroll_finance_post_v2", postParams);
    if (postResult.error) {
      const message = postResult.error.message || "";
      if (message.includes("erp_payroll_finance_post_v2")) {
        postResult = await userClient.rpc("erp_payroll_finance_post", postParams);
      }
    }

    if (postResult.error) {
      return res.status(400).json({
        ok: false,
        error: postResult.error.message || "Failed to post payroll finance journal",
        details: postResult.error.details || postResult.error.hint || postResult.error.code,
      });
    }

    const journalId = postResult.data as string | null;
    const { data: postData, error: postError } = await userClient.rpc("erp_payroll_finance_posting_get", {
      p_run_id: runId,
    });
    if (postError) {
      return res.status(400).json({
        ok: false,
        error: postError.message || "Failed to load payroll finance posting",
        details: postError.details || postError.hint || postError.code,
      });
    }

    const post = normalizePostPayload(postData);
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
