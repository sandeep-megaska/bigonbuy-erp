// pages/api/webhooks/shopify/orders-paid.ts
import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

// IMPORTANT: raw body needed for HMAC verification
export const config = {
  api: { bodyParser: false },
};

type ApiResponse = { ok: true } | { ok: false; error: string; details?: string | null };

async function readRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function safeEqual(a: Buffer, b: Buffer) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function verifyShopifyHmac(rawBody: Buffer, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  return safeEqual(Buffer.from(digest), Buffer.from(hmacHeader.trim()));
}

function extractNoteAttribute(order: any, key: string): string | null {
  const arr = Array.isArray(order?.note_attributes) ? order.note_attributes : [];
  const k = key.toLowerCase();
  for (const x of arr) {
    const name = String(x?.name ?? "").toLowerCase().trim();
    if (name === k) {
      const v = String(x?.value ?? "").trim();
      return v || null;
    }
  }
  return null;
}

/**
 * We want session_id available to DB function.
 * We will accept either:
 * - order.session_id (if you ever inject it upstream)
 * - note_attributes: bb_mkt_sid / session_id
 */
function ensureSessionIdOnOrder(order: any): any {
  const existing = String(order?.session_id ?? "").trim();
  if (existing) return order;

  const sid =
    extractNoteAttribute(order, "bb_mkt_sid") ??
    extractNoteAttribute(order, "session_id") ??
    null;

  if (!sid) return order;

  // shallow clone (keep original untouched)
  return { ...order, session_id: sid };
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
  if (!verifyShopifyHmac(rawBody, hmacHeader, webhookSecret)) {
    return res.status(401).json({ ok: false, error: "Invalid webhook HMAC" });
  }

  let order: any;
  try {
    order = JSON.parse(rawBody.toString("utf8"));
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: "Invalid JSON body", details: e?.message ?? null });
  }

  const orderId = order?.id ? String(order.id) : null;
  if (!orderId) {
    return res.status(400).json({ ok: false, error: "Missing order.id in webhook payload" });
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

  // Ensure session_id present if we captured it on cart
  const orderForDb = ensureSessionIdOnOrder(order);

  // Canonical enqueue in DB (handles em/ph hashing + COD mode + fbp/fbc from note_attributes)
  const { data, error } = await serviceClient.rpc("erp_mkt_capi_enqueue_purchase_from_shopify_order", {
    p_company_id: companyId,
    p_shopify_order_json: orderForDb,
  });

  if (error) {
    return res.status(500).json({
      ok: false,
      error: "Failed to enqueue Purchase via erp_mkt_capi_enqueue_purchase_from_shopify_order",
      details: error.message,
    });
  }

  // If DB decides not to enqueue (e.g., COD not fulfilled yet), it returns null — still ok.
  return res.status(200).json({ ok: true });
}
