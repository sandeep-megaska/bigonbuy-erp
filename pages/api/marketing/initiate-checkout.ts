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

function computeStableEventId(sessionId: string, contents: Array<{ id: string; quantity: number }>, value: number): string {
  const digest = createHash("sha256")
    .update(`${sessionId.trim()}|${value}|${contents.map((item) => `${item.id}:${item.quantity}`).join(",")}`)
    .digest("hex")
    .slice(0, 24);
  return `ic_${digest}`;
}

const requestSchema = z.object({
  session_id: z.string().min(1),
  event_id: z.string().min(1).optional().nullable(),
  event_source_url: z.string().optional().nullable(),
  currency: z.string().min(1),
  value: z.coerce.number().min(0),
  contents: z
    .array(
      z.object({
        id: z.string().min(1),
        quantity: z.coerce.number().int().min(1),
        item_price: z.coerce.number().min(0).optional(),
      }),
    )
    .min(1),
  fbp: z.string().optional().nullable(),
  fbc: z.string().optional().nullable(),
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

  const normalizedContents = body.contents.map((item) => ({
    id: item.id.trim(),
    quantity: item.quantity,
    item_price: item.item_price,
  }));

  const eventId =
    body.event_id && body.event_id.trim()
      ? body.event_id.trim()
      : computeStableEventId(body.session_id, normalizedContents, body.value);

  const rawCookieHeader = Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie;
  const fbp = body.fbp ?? body.user_data?.fbp ?? getCookieValue(rawCookieHeader, "_fbp") ?? null;
  const fbc = body.fbc ?? body.user_data?.fbc ?? getCookieValue(rawCookieHeader, "_fbc") ?? null;

  const eventSourceUrl = body.event_source_url ?? null;
  const clientUserAgent = (req.headers["user-agent"] as string | undefined) ?? null;
  const externalId = hashExternalIdFromSession(body.session_id);

  const payload = {
    event_name: "InitiateCheckout",
    event_time: Math.floor(Date.now() / 1000),
    event_id: eventId,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: {
      fbp,
      fbc,
      external_id: [externalId],
      client_user_agent: clientUserAgent,
    },
    custom_data: {
      currency: body.currency,
      value: body.value,
      content_type: "product",
      contents: normalizedContents,
    },
  };

  const { data, error } = await serviceClient
    .from("erp_mkt_capi_events")
    .upsert(
      {
        company_id: companyId,
        event_name: "InitiateCheckout",
        event_time: new Date().toISOString(),
        event_id: eventId,
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

  if (data?.id) {
    await serviceClient.from("erp_mkt_touchpoints").upsert(
      {
        company_id: companyId,
        session_id: body.session_id,
        fbp,
        fbc,
        landing_url: eventSourceUrl,
        user_agent: clientUserAgent,
      },
      { onConflict: "company_id,session_id" },
    );
  }

  if (error || !data?.id) {
    return res.status(500).json({
      ok: false,
      error: "Failed to enqueue InitiateCheckout event",
      details: error?.message ?? null,
    });
  }

  return res.status(200).json({ ok: true, capi_event_row_id: String(data.id) });
}
