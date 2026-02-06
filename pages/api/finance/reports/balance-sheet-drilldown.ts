import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

const parseOptionalString = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return value[0] ?? null;
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseDate = (value: string | null): string | null => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return null;
};

const parseUuid = (value: string | null): string | null => {
  if (!value) return null;
  if (/^[0-9a-fA-F-]{36}$/.test(value)) return value;
  return null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: unknown[] };
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

  const companyId = parseUuid(parseOptionalString(req.query.company_id));
  const asOf = parseDate(parseOptionalString(req.query.as_of));
  const statementGroup = parseOptionalString(req.query.statement_group);
  const statementSubgroup = parseOptionalString(req.query.statement_subgroup);

  if (!companyId) {
    return res.status(400).json({ ok: false, error: "Invalid company_id." });
  }
  if (!asOf) {
    return res.status(400).json({ ok: false, error: "Invalid as_of date. Use YYYY-MM-DD." });
  }
  if (!statementGroup) {
    return res.status(400).json({ ok: false, error: "statement_group is required." });
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

    const { data, error } = await userClient.rpc("erp_fin_balance_sheet_drilldown", {
      p_company_id: companyId,
      p_as_of: asOf,
      p_statement_group: statementGroup,
      p_statement_subgroup: statementSubgroup,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load balance sheet drilldown",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
