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
  if (!origin || !ALLOWED_ORIGINS.has(origin)) return null;

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  return origin;
}

function isBotUserAgent(ua: string | null) {
  if (!ua) return false;
  const s = ua.toLowerCase();
  return (
    s.includes("facebookexternalhit") ||
    s.includes("meta-externalads") ||
    s.includes("crawler") ||
    s.includes("bot") ||
    s.includes("spider")
  );
}

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

function getUserAgent(req: NextApiRequest, bodyUa?: string | null): string {
  const fromBody = (bodyUa ?? "").trim();
  if (fromBody) return fromBody;

  const ua = req.headers["user-agent"];
  const s = Array.isArray(ua) ? ua.join(", ") : (ua ?? "");
  return (s || "").trim() || "unknown";
}

function getClientIp(req: NextApiRequest): string | null {
  const pickFirst = (value: string | string[] | undefined): string | null => {
    if (!value) return null;
    const s = Array.isArray(value) ? value.join(",") : value;
    const first = s.split(",")[0]?.trim();
    return first || null;
  };

  const candidates: Array<string | null> = [
    pickFirst(req.headers["x-forwarded-for"] as any),
    pickFirst(req.headers["x-vercel-forwarded-for"] as any),
    pickFirst(req.headers["x-real-ip"] as any),
    pickFirst(req.headers["cf-connecting-ip"] as any),
    pickFirst(req.headers["true-client-ip"] as any),
    (req.socket?.remoteAddress ?? null) as string | null,
  ];

  for (const ip of candidates) {
    if (!ip) continue;
    const cleaned = ip.replace(/^::ffff:/, "").trim();
    if (!cleaned) continue;
    return cleaned;
  }
  return null;
}

function hashExternalIdFromSession(sessionId: string): string {
  return createHash("sha256").update(`bb:${sessionId.trim()}`).digest("hex");
}

const requestSchema = z.object({
  session_id: z.string().min(1),
  event_id: z.string().min(1),
  event_source_url: z.string().optional().nullable(),
  currency: z.string().optional().nullable(),
  value: z.coerce.number().optional(),
  contents: z
    .array(
      z.object({
        id: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
      }),
    )
    .min(1),
  fbp: z.string().optional().nullable(),
  fbc: z.string().optional().nullable(),
  user_agent: z.string().optional().nullable(),
  user_data: z
    .object({
      fbp: z.string().optional().nullable(),
      fbc: z.string().optional().nullable(),
    })
    .optional(),
});

type ApiResponse =
  | { ok: true; capi_event_row_id: string }
  | { ok: false; error: string; details?: string | null };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const allowedOrigin = applyCors(req, res);

  if (req.method === "OPTIONS") {
    if (!allowedOrigin) return res.status(403).end();
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

  // IMPORTANT: prefer body values (from Shopify asset). Cookies are only fallback.
  const fbp = body.fbp ?? body.user_data?.fbp ?? getCookieValue(rawCookieHeader, "_fbp") ?? null;
  const fbc = body.fbc ?? body.user_data?.fbc ?? getCookieValue(rawCookieHeader, "_fbc") ?? null;

  const clientUserAgent = getUserAgent(req, body.user_agent ?? null);
  const ip = getClientIp(req);

  if (isBotUserAgent(clientUserAgent)) {
    return res.status(200).json({ ok: true, capi_event_row_id: "bot_ignored" });
  }

  const externalId = hashExternalIdFromSession(body.session_id);
  const eventSourceUrl = body.event_source_url ?? null;

  const userData: {
    fbp: string | null;
    fbc: string | null;
    external_id: string[];
    client_user_agent: string;
    client_ip_address?: string;
  } = {
    fbp,
    fbc,
    external_id: [externalId],
    client_user_agent: clientUserAgent,
  };
  if (ip) userData.client_ip_address = ip;

  const payload = {
    event_name: "InitiateCheckout",
    event_time: Math.floor(Date.now() / 1000),
    event_id: body.event_id,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: {
      currency: body.currency ?? "INR",
      value: body.value ?? 0,
      content_type: "product",
      contents: body.contents.map((c) => ({ id: String(c.id), quantity: c.quantity })),
    },
  };

  const { data, error } = await serviceClient
    .from("erp_mkt_capi_events")
    .upsert(
      {
        company_id: companyId,
        event_name: "InitiateCheckout",
        event_time: new Date().toISOString(),
        event_id: body.event_id,
        action_source: "website",
        event_source_url: eventSourceUrl,
        payload,
        status: "queued",
        attempt_count: 0,
        last_error: null,
      },
      { onConflict: "company_id,event_id" },
    )
    .select("id")
    .single();

  if (error || !data?.id) {
    return res.status(500).json({
      ok: false,
      error: "Failed to enqueue InitiateCheckout event",
      details: error?.message ?? null,
    });
  }

  return res.status(200).json({ ok: true, capi_event_row_id: String(data.id) });
}
