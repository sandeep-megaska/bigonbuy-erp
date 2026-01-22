import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const eventSchema = z
  .object({
    platform: z.string().min(1),
    event_type: z.enum(["AMAZON_SETTLEMENT", "INDIFI_DISBURSEMENT", "BANK_CREDIT"]),
    party: z.string().min(1),
    event_date: z.string().min(1),
    amount: z.number(),
    currency: z.string().min(1),
    reference_no: z.string().optional().nullable(),
    payload: z.record(z.unknown()).optional().nullable(),
  })
  .strict();

const payloadSchema = z
  .object({
    source: z.literal("email_reader_push"),
    source_ref: z.string().min(1),
    received_at: z.string().min(1),
    events: z.array(eventSchema).min(1),
  })
  .strict();

function getHeaderValue(
  req: { headers: Record<string, string | string[] | undefined> },
  name: string
) {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const expectedSecret = process.env.ERP_SETTLEMENT_IMPORT_SECRET;
  const secretHeader = getHeaderValue(req, "x-bigonbuy-secret");
  if (!expectedSecret || !secretHeader || secretHeader !== expectedSecret) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const parsed = payloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "Invalid payload", details: parsed.error.flatten() });
  }

  const { source, source_ref, received_at, events } = parsed.data;

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: batchId, error: batchError } = await supabase.rpc(
    "erp_settlement_batch_create",
    {
      p_source: source,
      p_source_ref: source_ref,
      p_received_at: received_at,
      p_raw: { events_count: events.length, source },
    }
  );

  if (batchError || !batchId) {
    return res.status(400).json({
      ok: false,
      error: batchError?.message || "Unable to create settlement batch",
      details: batchError?.details || batchError?.hint || batchError?.code,
    });
  }

  let insertedCount = 0;
  for (const event of events) {
    const { error: insertError } = await supabase.rpc("erp_settlement_event_insert", {
      p_batch_id: batchId,
      p_platform: event.platform,
      p_event_type: event.event_type,
      p_event_date: event.event_date,
      p_amount: event.amount,
      p_currency: event.currency,
      p_reference_no: event.reference_no,
      p_party: event.party,
      p_payload: event.payload ?? null,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        continue;
      }
      return res.status(400).json({
        ok: false,
        error: insertError.message,
        details: insertError.details || insertError.hint || insertError.code,
      });
    }

    insertedCount += 1;
  }

  return res.status(200).json({ ok: true, batch_id: batchId, inserted_count: insertedCount });
}
