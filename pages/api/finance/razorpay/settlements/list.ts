import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

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

const parseBoolean = (value: string | string[] | undefined): boolean => {
  if (Array.isArray(value)) return value[0] === "true" || value[0] === "1";
  if (!value) return false;
  return value === "true" || value === "1";
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; rows: unknown[] };
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

  const from = parseDate(parseOptionalString(req.query.from));
  const to = parseDate(parseOptionalString(req.query.to));
  const query = parseOptionalString(req.query.q);
  const postedOnly = parseBoolean(req.query.posted_only);

  if (req.query.from && !from) {
    return res.status(400).json({ ok: false, error: "Invalid from date. Use YYYY-MM-DD." });
  }
  if (req.query.to && !to) {
    return res.status(400).json({ ok: false, error: "Invalid to date. Use YYYY-MM-DD." });
  }

  try {
    const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
    const { data: userData, error: sessionError } = await userClient.auth.getUser();
    if (sessionError || !userData?.user) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const { data, error } = await userClient.rpc("erp_razorpay_settlements_list", {
      p_from: from,
      p_to: to,
      p_query: query,
      p_posted_only: postedOnly,
    });

    if (error) {
      return res.status(400).json({
        ok: false,
        error: error.message || "Failed to load settlements",
        details: error.details || error.hint || error.code,
      });
    }

    return res.status(200).json({ ok: true, rows: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
