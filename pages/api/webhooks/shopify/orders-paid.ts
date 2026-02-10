// pages/api/webhooks/shopify/orders-paid.ts

import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { createHash } from "crypto";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

// IMPORTANT: raw body needed for HMAC verification
export const config = {
  api: {
    bodyParser: false,
  },
};

type ApiResponse = { ok: true } | { ok: false; error: string; details?: string | null };

// --- helpers: raw body ---
async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// --- helpers: shopify hmac verify ---
function safeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const provided = hmacHeader.trim();

  return safeEqual(Buffer.from(digest), Buffer.from(provided));
}

// --- helpers: normalization + hashing for Meta ---
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Meta expects phone in E.164 if possible; at minimum normalize to digits with leading +
// We keep + if present; otherwise digits-only.
function normalizePhone(phone: string): string {
  const s = phone.trim();
  if (!s) return "";
  // keep leading + if present, then digits
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/[^\d]/g, "");
  if (!digits) return "";
  return hasPlus ? `+${digits}` : digits;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// In your system we already use external_id derived from a session id.
// For Shopify webhook, we may not have session_id reliably.
// We still create a deterministic external_id based on customer id/email/phone/order id.
// This improves event stitching.
function computeExternalId(order: any): string {
  const companySalt = "bb"; // stable prefix
  const customerId = order?.customer?.id ? String(order.customer.id) : "";
  const email = order?.email ? normalizeEmail(String(order.email)) : "";
  const phone = order?.phone ? normalizePhone(String(order.phone)) : "";
  const orderId = order?.id ? String(order.id) : "";
  const raw = [companySalt, customerId, email, phone, orderId].join("|");
  return sha256Hex(raw);
}

function pickFirstIp(value: any): string | null {
  if (!value) return null;
  const s = Array.isArray(value) ? value.join(",") : String(value);
  const first = s.split(",")[0]?.trim();
  if (!first) return null;
  return first.replace(/^::ffff:/, "").trim() || null;
}

function getOrderIp(order: any): string | null {
  // Shopify order payload usually contains: browser_ip, sometimes client_details.browser_ip
  const candidates = [
    pickFirstIp(order?.browser_ip),
    pickFirstIp(order?.client_details?.browser_ip),
    pickFirstIp(order?.client_details?.ip_address),
  ];
  for (const ip of candidates) if (ip) return ip;
  return null;
}

function getOrderUserAgent(order: any): string | null {
  const ua =
    order?.client_details?.user_agent ??
    order?.client_details?.browser_user_agent ??
    order?.user_agent ??
    null;
  if (!ua) return null;
  const s = String(ua).trim();
  return s || null;
}

function buildContentsFromLineItems(order: any) {
  const items = Array.isArray(order?.line_items) ? order.line_items : [];
  return items
    .map((li: any) => {
      const variantId = li?.variant_id != null ? String(li.variant_id) : null;
      const productId = li?.product_id != null ? String(li.product_id) : null;
      const id = variantId || productId || (li?.sku ? String(li.sku) : null);
      const qty = li?.quantity != null ? Number(li.quantity) : 1;
      if (!id) return null;
      return { id, quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 };
    })
    .filter(Boolean) as Array<{ id: string; quantity: number }>;
}

function parseMoney(order: any): { value: number; currency: string } {
  const currency = (order?.currency ? String(order.currency) : "INR").toUpperCase();
  // total_price is usually a string like "1299.00"
  const raw = order?.total_price ?? order?.current_total_price ?? order?.subtotal_price ?? "0";
  const value = Number(raw);
  return { value: Number.isFinite(value) ? value : 0, currency };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const webhookSecret = process.env.SHOPIFY_WEBHOOK_SECRET ?? "";
  if (!webhookSecret) {
    return res.status(500).json({ ok: false, error: "Missing SHOPIFY_WEBHOOK_SECRET env var" });
  }

  const companyId = process.env.ERP_SERVICE_COMPANY_ID ?? null;
  if (!companyId) {
    return res.status(500).json({ ok: false, error: "Missing ERP_SERVICE_COMPANY_ID in environment" });
  }

  const rawBody = await readRawBody(req);

  const hmacHeader = (req.headers["x-shopify-hmac-sha256"] as string | undefined) ?? null;
  const ok = verifyShopifyHmac(rawBody, hmacHeader, webhookSecret);
  if (!ok) {
    return res.status(401).json({ ok: false, error: "Invalid webhook HMAC" });
  }

  let order: any;
  try {
    order = JSON.parse(rawBody.toString("utf8"));
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: "Invalid JSON body", details: e?.message ?? null });
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

  // --- Match keys (hashed) ---
  const emailRaw = order?.email ? String(order.email) : "";
  const phoneRaw = order?.phone ? String(order.phone) : "";

  const emailNorm = emailRaw ? normalizeEmail(emailRaw) : "";
  const phoneNorm = phoneRaw ? normalizePhone(phoneRaw) : "";

  const em = emailNorm ? sha256Hex(emailNorm) : null;
  const ph = phoneNorm ? sha256Hex(phoneNorm) : null;

  const ip = getOrderIp(order);
  const ua = getOrderUserAgent(order);

  // --- Event identity ---
  const shopifyOrderId = order?.id ? String(order.id) : null;
  if (!shopifyOrderId) {
    return res.status(400).json({ ok: false, error: "Missing order.id in webhook payload" });
  }

  // Stable & idempotent: same order.id => same event_id
  const eventId = `shopify_purchase_${shopifyOrderId}`;

  // event_time: use paid_at if available, else created_at, else now
  const paidAt = order?.processed_at ?? order?.paid_at ?? order?.created_at ?? null;
  const eventTimeUnix = (() => {
    const d = paidAt ? new Date(paidAt) : new Date();
    const t = Math.floor(d.getTime() / 1000);
    return Number.isFinite(t) ? t : Math.floor(Date.now() / 1000);
  })();

  // Best available source url (Shopify checkout/order status might be in landing_site or order_status_url)
  const eventSourceUrl =
    (order?.order_status_url ? String(order.order_status_url) : null) ??
    (order?.landing_site ? String(order.landing_site) : null) ??
    null;

  const { value, currency } = parseMoney(order);
  const contents = buildContentsFromLineItems(order);

  // external_id helps stitching across events even if session_id is missing
  const externalId = computeExternalId(order);

  const userData: any = {
    external_id: [externalId],
  };

  // include hashed identifiers as arrays (Meta supports array form)
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];

  if (ua) userData.client_user_agent = ua;
  if (ip) userData.client_ip_address = ip;

  const payload: any = {
    event_name: "Purchase",
    event_time: eventTimeUnix,
    event_id: eventId,
    action_source: "website",
    event_source_url: eventSourceUrl,
    user_data: userData,
    custom_data: {
      currency,
      value,
      content_type: "product",
      contents,
      // optional but helpful
      order_id: shopifyOrderId,
    },
  };

  // Enqueue Purchase into erp_mkt_capi_events (idempotent by company_id,event_id)
  const { error } = await serviceClient.from("erp_mkt_capi_events").upsert(
    {
      company_id: companyId,
      event_name: "Purchase",
      event_time: new Date(eventTimeUnix * 1000).toISOString(),
      event_id: eventId,
      action_source: "website",
      event_source_url: eventSourceUrl,
      payload,
      status: "queued",
      attempt_count: 0,
      last_error: null,
    },
    { onConflict: "company_id,event_id" },
  );

  if (error) {
    return res.status(500).json({ ok: false, error: "Failed to enqueue Purchase event", details: error.message });
  }

  return res.status(200).json({ ok: true });
}
