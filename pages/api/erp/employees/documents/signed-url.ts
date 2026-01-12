import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; url: string; fileName?: string | null };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
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

  const documentIdParam = req.query.document_id;
  const documentId = Array.isArray(documentIdParam) ? documentIdParam[0] : documentIdParam;
  if (!documentId) {
    return res.status(400).json({ ok: false, error: "document_id is required" });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data: doc, error: docError } = await userClient
      .from("erp_employee_documents")
      .select("id, file_path, storage_path, file_name")
      .eq("id", documentId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (docError) {
      return res.status(400).json({
        ok: false,
        error: docError.message || "Failed to load document",
        details: docError.details || docError.hint || docError.code,
      });
    }

    if (!doc) {
      return res.status(404).json({ ok: false, error: "Document not found" });
    }

    const storagePath =
      (doc.storage_path as string | null) ?? (doc.file_path as string | null);
    if (!storagePath) {
      return res.status(400).json({ ok: false, error: "Document is missing storage path" });
    }
    const bucketId = storagePath.startsWith("company/") ? "erp-employee-docs" : "erp-employee-private";

    const { data, error } = await userClient.storage
      .from(bucketId)
      .createSignedUrl(storagePath, 300);

    if (error || !data?.signedUrl) {
      return res.status(500).json({
        ok: false,
        error: error?.message || "Failed to create signed URL",
        details: error?.name || null,
      });
    }

    return res
      .status(200)
      .json({ ok: true, url: data.signedUrl, fileName: (doc.file_name as string) ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
