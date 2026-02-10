import type { NextApiRequest, NextApiResponse } from "next";
import crypto, { createHash } from "crypto";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

export const config = {
  api: {
    bodyParser: false,
  },
};

type ApiResponse = {
  ok: boolean;
  error?: string;
};

type ShopifyNoteAttribute = {
  name?: unknown;
  value?: unknown;
};

type ShopifyLineItem = {
  variant_id?: unknown;
  quantity?: unknown;
  price?: unknown;
};

type ShopifyClientDetails = {
  user_agent?: unknown;
  browser_ip?: unknown;
};

type ShopifyAddress = {
  phone?: unknown;
};

type ShopifyOrderWebhook = {
  id?: unknown;
  currency?: unknown;
  current_total_price?: unknown;
  total_price?: unknown;
  line_items?: unknown;
  order_status_url?: unknown;
  landing_site?: unknown;
  referring_site?: unknown;
  note_attributes?: unknown;
  email?: unknown;
  phone?: unknown;
  shipping_address?: ShopifyAddress | null;
  client_details?: ShopifyClientDetails | null;
  processed_at?: unknown;
  created_at?: unknown;
};

async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function isValidHmac(rawBody: Buffer, secret: string, provided: string | string[] | undefined): boolean {
  if (!provided || Array.isArray(provided)) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const digestBuffer = Buffer.from(digest, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (digestBuffer.length !== providedBuffer.length) return false;
  return crypto.timingSafeEqual(digestBuffer, providedBuffer);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toFiniteNumber(value: unknown): number | null {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "");
}

function pickSessionId(noteAttributes: unknown, fallback: string): string {
  if (!Array.isArray(noteAttributes)) return fallback;

  for (const attr of noteAttributes) {
    const item = attr as ShopifyNoteAttribute;
    const key = toNonEmptyString(item?.name)?.toLowerCase();
    if (!key || (key !== "bb_mkt_sid" && key !== "session_id")) continue;
    const val = toNonEmptyString(item?.value);
    if (val) return val;
  }

  return fallback;
}

function toUnixSeconds(value: unknown): number | null {
  const dt = toNonEmptyString(value);
  if (!dt) return null;
  const ms = Date.parse(dt);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 1000);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method === "OPTIONS") {
    return res.status(200).json({ ok: true });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "Missing SHOPIFY_WEBHOOK_SECRET" });
  }

  const companyId = process.env.ERP_SERVICE_COMPANY_ID ?? null;
  if (!companyId) {
    return res.status(500).json({ ok: false, error: "Missing ERP_SERVICE_COMPANY_ID" });
  }

  const rawBody = await readRawBody(req);
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  if (!isValidHmac(rawBody, secret, hmacHeader)) {
    return res.status(401).json({ ok: false, error: "Invalid webhook signature" });
  }

  let payload: ShopifyOrderWebhook;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as ShopifyOrderWebhook;
  } catch {
    return res.status(400).json({ ok: false, error: "Invalid JSON payload" });
  }

  const orderIdRaw = payload.id;
  const orderId = toNonEmptyString(orderIdRaw) ?? (Number.isFinite(Number(orderIdRaw)) ? String(orderIdRaw) : null);
  if (!orderId) {
    return res.status(400).json({ ok: false, error: "Missing payload.id" });
  }

  const eventId = `order_${orderId}`;
  const currency = toNonEmptyString(payload.currency) ?? "";
  const value = Number(payload.current_total_price ?? payload.total_price ?? 0);
  const safeValue = Number.isFinite(value) ? value : 0;

  const rawLineItems = Array.isArray(payload.line_items) ? (payload.line_items as ShopifyLineItem[]) : [];
  const contents = rawLineItems
    .map((item) => {
      const variantId = item?.variant_id;
      if (variantId === null || variantId === undefined) return null;
      const quantity = toFiniteNumber(item.quantity) ?? 0;
      const itemPrice = toFiniteNumber(item.price);
      const content: { id: string; quantity: number; item_price?: number } = {
        id: String(variantId),
        quantity,
      };
      if (itemPrice !== null) {
        content.item_price = itemPrice;
      }
      return content;
    })
    .filter((item): item is { id: string; quantity: number; item_price?: number } => item !== null);

  const sessionId = pickSessionId(payload.note_attributes, orderId);
  const externalIdHash = sha256Hex(`bb:${sessionId}`);

  const email = toNonEmptyString(payload.email);
  const normalizedEmail = email ? normalizeEmail(email) : null;

  const phone =
    toNonEmptyString(payload.phone) ??
    toNonEmptyString((payload.shipping_address as ShopifyAddress | null | undefined)?.phone);
  const normalizedPhone = phone ? normalizePhone(phone) : null;

  const clientDetails = payload.client_details ?? null;
  const clientUserAgent = toNonEmptyString(clientDetails?.user_agent) ?? null;
  const clientIpAddress = toNonEmptyString(clientDetails?.browser_ip) ?? null;

  const eventSourceUrl =
    toNonEmptyString(payload.order_status_url) ??
    toNonEmptyString(payload.landing_site) ??
    toNonEmptyString(payload.referring_site) ??
    null;

  const eventTimeUnix =
    toUnixSeconds(payload.processed_at) ?? toUnixSeconds(payload.created_at) ?? Math.floor(Date.now() / 1000);

  const userData: {
    external_id: string[];
    em?: string[];
    ph?: string[];
    client_user_agent?: string;
    client_ip_address?: string;
  } = {
    external_id: [externalIdHash],
  };

  if (normalizedEmail) {
    userData.em = [sha256Hex(normalizedEmail)];
  }
  if (normalizedPhone) {
    userData.ph = [sha256Hex(normalizedPhone)];
  }
  if (clientUserAgent) {
    userData.client_user_agent = clientUserAgent;
  }
  if (clientIpAddress) {
    userData.client_ip_address = clientIpAddress;
  }

  const capiPayload = {
    event_name: "Purchase",
    event_time: eventTimeUnix,
    event_id: eventId,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: {
      currency,
      value: safeValue,
      content_type: "product",
      contents,
      order_id: orderId,
    },
  };

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { error: upsertError } = await serviceClient.from("erp_mkt_capi_events").upsert(
    {
      company_id: companyId,
      event_name: "Purchase",
      event_time: new Date(eventTimeUnix * 1000).toISOString(),
      event_id: eventId,
      action_source: "website",
      event_source_url: eventSourceUrl,
      payload: capiPayload,
      status: "queued",
      attempt_count: 0,
      last_error: null,
    },
    { onConflict: "company_id,event_id" },
  );

  if (upsertError) {
    return res.status(500).json({ ok: false, error: upsertError.message });
  }

  console.log(`[webhooks] orders-paid ok order_id=${orderId} event_id=${eventId}`);
  return res.status(200).json({ ok: true });
}
