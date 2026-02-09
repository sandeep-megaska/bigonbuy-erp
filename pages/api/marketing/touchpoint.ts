import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createServiceRoleClient, getSupabaseEnv } from "../../../lib/serverSupabase";

const ALLOWED_ORIGINS = new Set([
  "https://megaska.com",
  "https://www.megaska.com",
  "https://bigonbuy-fashions.myshopify.com",
]);

function applyCors(req: NextApiRequest, res: NextApiResponse): string | null {
  const origin = req.headers.origin;
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return null;
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  return origin;
}

const requestSchema = z.object({
  session_id: z.string().min(1),
  utm_source: z.string().optional().nullable(),
  utm_medium: z.string().optional().nullable(),
  utm_campaign: z.string().optional().nullable(),
  utm_content: z.string().optional().nullable(),
  utm_term: z.string().optional().nullable(),
  fbp: z.string().optional().nullable(),
  fbc: z.string().optional().nullable(),
  landing_url: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
  user_agent: z.string().optional().nullable(),
  ip: z.string().optional().nullable(),
});

type ApiResponse =
  | { ok: true; touchpoint_id: string }
  | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const allowedOrigin = applyCors(req, res);

  if (req.method === "OPTIONS") {
    if (!allowedOrigin) {
      return res.status(403).end();
    }

    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!allowedOrigin) {
    return res.status(403).json({ ok: false, error: "Origin not allowed" });
  }

  const companyId = process.env.ERP_SERVICE_COMPANY_ID ?? null;
  if (!companyId) {
    return res.status(500).json({ ok: false, error: "Missing ERP_SERVICE_COMPANY_ID in environment" });
  }

  const parseResult = requestSchema.safeParse(req.body ?? {});
  if (!parseResult.success) {
    return res.status(400).json({ ok: false, error: "Invalid request body" });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const body = parseResult.data;
  const userAgent = body.user_agent ?? req.headers["user-agent"] ?? null;
  const ip = body.ip ?? (req.headers["x-forwarded-for"] as string | undefined)?.split(",")?.[0]?.trim() ?? null;

  const { data, error } = await serviceClient.rpc("erp_mkt_touchpoint_upsert", {
    p_company_id: companyId,
    p_session_id: body.session_id,
    p_utm_source: body.utm_source ?? null,
    p_utm_medium: body.utm_medium ?? null,
    p_utm_campaign: body.utm_campaign ?? null,
    p_utm_content: body.utm_content ?? null,
    p_utm_term: body.utm_term ?? null,
    p_fbp: body.fbp ?? null,
    p_fbc: body.fbc ?? null,
    p_landing_url: body.landing_url ?? null,
    p_referrer: body.referrer ?? null,
    p_user_agent: userAgent,
    p_ip: ip,
  });

  if (error || !data) {
    return res.status(500).json({
      ok: false,
      error: "Failed to upsert touchpoint",
      details: error?.message ?? null,
    });
  }

  return res.status(200).json({ ok: true, touchpoint_id: String(data) });
}
