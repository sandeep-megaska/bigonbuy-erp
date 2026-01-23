import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../lib/serverSupabase";

export const config = {
  api: {
    bodyParser: false,
  },
};

type WebhookResponse = {
  ok: boolean;
  error?: string;
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

export default async function handler(req: NextApiRequest, res: NextApiResponse<WebhookResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "Missing SHOPIFY_WEBHOOK_SECRET" });
  }

  const rawBody = await readRawBody(req);
  const hmacHeader = req.headers["x-shopify-hmac-sha256"];
  if (!isValidHmac(rawBody, secret, hmacHeader)) {
    return res.status(401).json({ ok: false, error: "Invalid webhook signature" });
  }

  const { supabaseUrl, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !serviceRoleKey || missing.length > 0) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars" });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    return res.status(400).json({ ok: false, error: "Invalid JSON payload" });
  }

  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data: companyRow, error: companyError } = await serviceClient
    .from("erp_companies")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (companyError || !companyRow?.id) {
    return res.status(500).json({ ok: false, error: "Unable to resolve company" });
  }

  const { error: upsertError } = await serviceClient.rpc("erp_shopify_order_upsert", {
    p_company_id: companyRow.id,
    p_order: payload,
  });

  if (upsertError) {
    return res.status(500).json({ ok: false, error: upsertError.message });
  }

  return res.status(200).json({ ok: true });
}
