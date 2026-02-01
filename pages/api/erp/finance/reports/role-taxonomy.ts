import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

const parseOptionalString = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseUuid = (value: string | null): string | null => {
  if (!value) return null;
  if (/^[0-9a-fA-F-]{36}$/.test(value)) return value;
  return null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: unknown[] };
type ApiResponse = ErrorResponse | SuccessResponse;

type TaxonomyRow = {
  role: string;
  statement_section: string;
  statement_group: string;
  statement_subgroup: string | null;
  normal_balance: string;
  is_active: boolean;
  sort_order: number;
};

type ControlRoleRow = {
  role_key: string;
  account_id: string | null;
  account_code: string | null;
  account_name: string | null;
};

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

  const companyId = parseUuid(parseOptionalString(req.query.company_id));
  if (!companyId) {
    return res.status(400).json({ ok: false, error: "Invalid company_id." });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { error: permissionError } = await userClient.rpc("erp_require_finance_reader");
    if (permissionError) {
      return res.status(403).json({ ok: false, error: "Not authorized" });
    }

    const { data: taxonomyData, error: taxonomyError } = await userClient.rpc("erp_fin_role_taxonomy_list", {
      p_company_id: companyId,
    });
    if (taxonomyError) {
      return res.status(400).json({
        ok: false,
        error: taxonomyError.message || "Failed to load role taxonomy",
        details: taxonomyError.details || taxonomyError.hint || taxonomyError.code,
      });
    }

    const { data: controlData, error: controlError } = await userClient.rpc("erp_fin_coa_control_roles_list");
    if (controlError) {
      return res.status(400).json({
        ok: false,
        error: controlError.message || "Failed to load COA control roles",
        details: controlError.details || controlError.hint || controlError.code,
      });
    }

    const controlMap = new Map<string, ControlRoleRow>();
    (controlData || []).forEach((row: ControlRoleRow) => {
      controlMap.set(row.role_key, row);
    });

    const merged = (taxonomyData || []).map((row: TaxonomyRow) => {
      const mapping = controlMap.get(row.role) || null;
      return {
        ...row,
        account_id: mapping?.account_id ?? null,
        account_code: mapping?.account_code ?? null,
        account_name: mapping?.account_name ?? null,
      };
    });

    return res.status(200).json({ ok: true, data: merged });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
