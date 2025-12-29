import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessListResponse = { ok: true; documents: unknown[] };
type SuccessMutateResponse = { ok: true; document: Record<string, unknown> };
type ApiResponse = ErrorResponse | SuccessListResponse | SuccessMutateResponse;

function docTypeIsValid(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return ["photo", "id_proof", "offer_letter", "certificate", "other"].includes(value.trim().toLowerCase());
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
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

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    if (req.method === "GET") {
      const employeeIdParam = req.query.employee_id;
      const employeeId = Array.isArray(employeeIdParam) ? employeeIdParam[0] : employeeIdParam;
      if (!employeeId) {
        return res.status(400).json({ ok: false, error: "employee_id is required" });
      }
      const { data, error } = await userClient
        .from("erp_employee_documents")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load documents",
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, documents: Array.isArray(data) ? data : [] });
    }

    if (req.method === "POST") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const employeeId = typeof body.employee_id === "string" ? body.employee_id : null;
      const docType = typeof body.doc_type === "string" ? body.doc_type.trim().toLowerCase() : "";
      const filePath = typeof body.file_path === "string" ? body.file_path : "";

      if (!employeeId) {
        return res.status(400).json({ ok: false, error: "employee_id is required" });
      }
      if (!docTypeIsValid(docType)) {
        return res.status(400).json({ ok: false, error: "Invalid doc_type" });
      }
      if (!filePath) {
        return res.status(400).json({ ok: false, error: "file_path is required" });
      }

      const { data, error } = await userClient.rpc("erp_employee_document_add", {
        p_employee_id: employeeId,
        p_doc_type: docType,
        p_file_path: filePath,
        p_file_name: (body.file_name as string) ?? null,
        p_mime_type: (body.mime_type as string) ?? null,
        p_size_bytes: (body.size_bytes as number) ?? null,
        p_notes: (body.notes as string) ?? null,
      });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to add document",
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, document: data as Record<string, unknown> });
    }

    if (req.method === "DELETE") {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const documentId =
        typeof body.document_id === "string"
          ? body.document_id
          : typeof req.query.document_id === "string"
          ? (req.query.document_id as string)
          : null;
      if (!documentId) {
        return res.status(400).json({ ok: false, error: "document_id is required" });
      }

      const { data, error } = await userClient.rpc("erp_employee_document_delete", {
        p_document_id: documentId,
      });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to delete document",
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, document: data as Record<string, unknown> });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
