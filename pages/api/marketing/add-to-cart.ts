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
  try {
    return decodeURIComponent(cookie.slice(cookieName.length + 1));
  } catch {
    return cookie.slice(cookieName.length + 1);
  }
}

function hashExternalIdFromSession(sessionId: string): string {
  return createHash("sha256").update(`bb:${sessionId}`).digest("hex");
}

const requestSchema = z.object({
  session_id: z.string().min(1),
  sku: z.string().optional().nullable(),
  shopify_variant_id: z.string().optional().nullable(),
  variant_id: z.string().optional().nullable(),
  quantity: z.coerce.number().int().min(1).optional(),
  currency: z.string().optional().nullable(),
  event_source_url: z.string().optional().nullable(),
  event_id: z.string().optional().nullable(),
  fbp: z.string().optional().nullable(),
  fbc: z.string().optional().nullable(),
});

type ApiResponse =
  | { ok: true; capi_event_row_id: string }
  | { ok: false; error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const allowedOrigin = applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    return res.status(200).end();
  }

  if (req.method !== "POST" || !allowedOrigin) {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const parse = requestSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    return res.status(400).json({ ok: false, error: "Invalid body" });
  }

  const body = parse.data;
  const rawCookieHeader = Array.isArray(req.headers.cookie)
    ? req.headers.cookie.join("; ")
    : req.headers.cookie;

  const fbp = body.fbp ?? getCookieValue(rawCookieHeader, "_fbp");
  const fbc = body.fbc ?? getCookieValue(rawCookieHeader, "_fbc");
  const userAgent = (req.headers["user-agent"] as string) ?? null;

  if (isBotUserAgent(userAgent)) {
    return res.status(200).json({ ok: true, capi_event_row_id: "bot_ignored" });
  }

  const externalId = hashExternalIdFromSession(body.session_id);

  const payload = {
    event_name: "AddToCart",
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: body.event_source_url ?? null,
    user_data: {
      fbp,
      fbc,
      external_id: [externalId],
      client_user_agent: userAgent,
    },
    custom_data: {
      content_type: "product",
      contents: [
        {
          id: body.sku ?? body.shopify_variant_id ?? body.variant_id,
          quantity: body.quantity ?? 1,
        },
      ],
      currency: body.currency ?? "INR",
      value: 0,
    },
  };

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  const serviceClient = createServiceRoleClient(supabaseUrl!, serviceRoleKey!);

  const { data } = await serviceClient
    .from("erp_mkt_capi_events")
    .insert({
      event_name: "AddToCart",
      payload,
      status: "queued",
    })
    .select("id")
    .single();

  return res.status(200).json({ ok: true, capi_event_row_id: String(data.id) });
}
