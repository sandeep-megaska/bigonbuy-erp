import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";
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

function getCookieValue(rawCookieHeader: string | undefined, cookieName: string): string | null {
  if (!rawCookieHeader) return null;
  const cookie = rawCookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const rawValue = cookie.slice(cookieName.length + 1).trim();
  if (!rawValue) return null;
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function hashExternalIdFromSession(sessionId: string): string {
  return createHash("sha256").update(`bb:${sessionId.trim()}`).digest("hex");
}

function computeTouchpointEventId(sessionId: string, landingUrl: string | null): string {
  const digest = createHash("sha256").update([sessionId.trim(), landingUrl ?? ""].join("|")).digest("hex").slice(0, 24);
  return `tp_${digest}`;
}

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
  const rawCookieHeader = Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie;
  const userAgent = body.user_agent ?? req.headers["user-agent"] ?? null;
  const fbp = body.fbp ?? getCookieValue(rawCookieHeader, "_fbp") ?? null;
  const fbc = body.fbc ?? getCookieValue(rawCookieHeader, "_fbc") ?? null;
  const ip = body.ip ?? (req.headers["x-forwarded-for"] as string | undefined)?.split(",")?.[0]?.trim() ?? null;

  const { data, error } = await serviceClient.rpc("erp_mkt_touchpoint_upsert", {
    p_company_id: companyId,
    p_session_id: body.session_id,
    p_utm_source: body.utm_source ?? null,
    p_utm_medium: body.utm_medium ?? null,
    p_utm_campaign: body.utm_campaign ?? null,
    p_utm_content: body.utm_content ?? null,
    p_utm_term: body.utm_term ?? null,
    p_fbp: fbp,
    p_fbc: fbc,
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

  const eventSourceUrl = body.landing_url ?? null;
  const eventId = computeTouchpointEventId(body.session_id, eventSourceUrl);
  const externalId = hashExternalIdFromSession(body.session_id);
  const payload = {
    event_name: "PageView",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: {
      fbp,
      fbc,
      external_id: externalId,
      client_user_agent: userAgent,
    },
  };

  await serviceClient.from("erp_mkt_capi_events").upsert(
    {
      company_id: companyId,
      event_name: "PageView",
      event_time: new Date().toISOString(),
      event_id: eventId,
      action_source: "website",
      event_source_url: eventSourceUrl,
      touchpoint_id: String(data),
      payload,
      status: "queued",
      attempt_count: 0,
      last_error: null,
    },
    {
      onConflict: "company_id,event_id",
    },
  );

  return res.status(200).json({ ok: true, touchpoint_id: String(data) });
}
