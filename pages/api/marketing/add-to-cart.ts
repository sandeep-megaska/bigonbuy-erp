import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createServiceRoleClient, getSupabaseEnv } from "../../../lib/serverSupabase";

const ALLOWED_ORIGINS = new Set([
  "https://megaska.com",
  "https://www.megaska.com",
  "https://megaska.myshopify.com",
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
  sku: z.string().min(1),
  quantity: z.coerce.number().int().min(1).optional(),
  qty: z.coerce.number().int().min(1).optional(),
  value: z.coerce.number().default(0),
  currency: z.string().optional().nullable(),
  event_source_url: z.string().optional().nullable(),
  event_id: z.string().optional().nullable(),
  fbp: z.string().optional().nullable(),
  fbc: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

type ApiResponse =
  | { ok: true; capi_event_row_id: string }
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

  const { data, error } = await serviceClient.rpc("erp_mkt_capi_enqueue_add_to_cart", {
    p_company_id: companyId,
    p_session_id: body.session_id,
    p_sku: body.sku,
    p_quantity: body.quantity ?? body.qty ?? 1,
    p_value: body.value,
    p_currency: body.currency ?? "INR",
    p_event_source_url: body.event_source_url ?? null,
    p_event_id: body.event_id ?? null,
    p_fbp: body.fbp ?? null,
    p_fbc: body.fbc ?? null,
    p_email: body.email ?? null,
    p_phone: body.phone ?? null,
  });

  if (error || !data) {
    return res.status(500).json({
      ok: false,
      error: "Failed to enqueue AddToCart event",
      details: error?.message ?? null,
    });
  }

  return res.status(200).json({ ok: true, capi_event_row_id: String(data) });
}
