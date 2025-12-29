import type { NextApiRequest, NextApiResponse } from "next";
import { requireManager } from "../../../../lib/erpAuth";

type CompanyUserRow = {
  user_id: string;
  email: string | null;
  role_key: string;
  created_at: string | null;
  updated_at: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; users: CompanyUserRow[] };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const auth = await requireManager(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ ok: false, error: auth.error });
  }

  try {
    const { data, error } = await auth.userClient.rpc("erp_list_company_users");
    if (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Failed to fetch company users",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, users: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
