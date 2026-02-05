import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; data: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

const parseDateParam = (value: string | string[] | undefined) => {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // DEBUG: confirm request hits this file + auth header presence
  if (req.query.debug === "auth") {
    const authHeader = req.headers.authorization ?? null;
    return res.status(200).json({
      ok: true,
      data: {
        hit: "api/erp/finance/amazon/settlement-posting/summary.ts",
        method: req.method,
        hasAuthorizationHeader: Boolean(authHeader),
        authorizationPrefix: authHeader ? authHeader.slice(0, 20) : null,
      },
    });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  // Shopify-style: require Bearer token
  const accessToken = getBearerToken(req);
  if (!accessToken) return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });

  const from = parseDateParam(req.query.from);
  const to = parseDateParam(req.query.to);
  if (!from || !to) return res.status(400).json({ ok: false, error: "from/to dates are required" });

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);

    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { error: permissionError } = await userClient.rpc("erp_require_finance_reader");
    if (permissionError) {
      return res.status(403).json({ ok: false, error: permissionError.message || "Finance access required" });
    }

    const { data, error } = await userClient.rpc("erp_amazon_settlement_posting_summary", {
      p_from: from,
      p_to: to,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load Amazon settlement posting summary",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
