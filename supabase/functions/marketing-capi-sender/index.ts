// supabase/functions/marketing-capi-sender/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Json = Record<string, unknown>;

function getEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function pickString(obj: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(obj: any, keys: string[]): number | null {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v))) return Number(v);
  }
  return null;
}

function toUnixSeconds(value: any): number {
  // Accept: unix seconds, ISO string, timestamptz-like string
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "string" && value.trim()) {
    const asNum = Number(value);
    if (!Number.isNaN(asNum) && Number.isFinite(asNum)) return Math.floor(asNum);
    const dt = Date.parse(value);
    if (!Number.isNaN(dt)) return Math.floor(dt / 1000);
  }
  return Math.floor(Date.now() / 1000);
}

function buildMetaPayload(eventRow: any): Json {
  // Try to use a prebuilt payload if you already store it
  const prebuilt =
    eventRow?.meta_payload ??
    eventRow?.payload ??
    eventRow?.event_payload ??
    null;

  if (prebuilt && typeof prebuilt === "object") {
    return prebuilt as Json;
  }

  // Otherwise: best-effort mapping from row fields
  const eventName = pickString(eventRow, ["event_name", "eventName"]) ?? "PageView";
  const eventId = pickString(eventRow, ["event_id", "eventId", "id"]) ?? crypto.randomUUID();
  const eventTime = toUnixSeconds(eventRow?.event_time ?? eventRow?.eventTime ?? eventRow?.created_at);

  const em = pickString(eventRow, ["em_hash", "em", "email_hash"]);
  const ph = pickString(eventRow, ["ph_hash", "ph", "phone_hash"]);
  const fbp = pickString(eventRow, ["fbp"]);
  const fbc = pickString(eventRow, ["fbc"]);

  const ip = pickString(eventRow, ["ip", "client_ip_address"]);
  const ua = pickString(eventRow, ["ua", "user_agent", "client_user_agent"]);

  const value = pickNumber(eventRow, ["value", "order_value", "total_value", "amount"]);
  const currency = pickString(eventRow, ["currency"]) ?? "INR";

  const contentIds =
    (Array.isArray(eventRow?.content_ids) ? eventRow.content_ids : null) ??
    (Array.isArray(eventRow?.sku_codes) ? eventRow.sku_codes : null) ??
    undefined;

  const payload: any = {
    data: [
      {
        event_name: eventName,
        event_time: eventTime,
        event_id: eventId,
        action_source: "website",
        user_data: {
          ...(em ? { em: [em] } : {}),
          ...(ph ? { ph: [ph] } : {}),
          ...(fbp ? { fbp } : {}),
          ...(fbc ? { fbc } : {}),
          ...(ip ? { client_ip_address: ip } : {}),
          ...(ua ? { client_user_agent: ua } : {}),
        },
        ...(value !== null
          ? {
              custom_data: {
                value,
                currency,
                ...(contentIds ? { content_ids: contentIds, content_type: "product" } : {}),
              },
            }
          : {}),
      },
    ],
  };

  return payload;
}

serve(async (req) => {
  try {
    // OPTIONAL: add a simple shared secret check if you want
    // const expected = getEnv("INTERNAL_CRON_SECRET");
    // const got = req.headers.get("x-cron-secret");
    // if (got !== expected) return new Response("Unauthorized", { status: 401 });

    const SUPABASE_URL = getEnv("SUPABASE_URL");
    const SERVICE_ROLE = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const META_PIXEL_ID = getEnv("META_PIXEL_ID");
    const META_TOKEN = getEnv("META_CAPI_ACCESS_TOKEN");

    const BATCH_SIZE = Number(Deno.env.get("MKT_CAPI_BATCH_SIZE") ?? "200");

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    // 1) Dequeue
    const { data: dq, error: dqErr } = await sb.rpc("erp_mkt_capi_dequeue_batch_v1", {
      p_batch_size: BATCH_SIZE,
    });

    if (dqErr) throw dqErr;

    const events = (dq?.events ?? []) as Array<{ id: string; event: any }>;
    if (!Array.isArray(events) || events.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const url = `https://graph.facebook.com/v19.0/${META_PIXEL_ID}/events?access_token=${META_TOKEN}`;

    let sent = 0;
    let retry = 0;
    let failed = 0;

    // 2) Send each event
    for (const item of events) {
      const eventId = item.id;
      const row = item.event;

      const metaPayload = buildMetaPayload(row);

      let status: "sent" | "retry" | "failed" = "retry";
      let responsePayload: Json = { request: metaPayload };

      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(metaPayload),
        });

        const bodyText = await r.text();
        let bodyJson: any = null;
        try {
          bodyJson = bodyText ? JSON.parse(bodyText) : null;
        } catch {
          bodyJson = { raw: bodyText };
        }

        responsePayload = { request: metaPayload, response: bodyJson, http_status: r.status };

        if (r.ok) {
          status = "sent";
          sent++;
        } else {
          // Meta errors are usually fixable payload issues; retry few times
          status = "retry";
          retry++;
        }
      } catch (e) {
        responsePayload = { request: metaPayload, error: String(e) };
        status = "retry";
        retry++;
      }

      // 3) Mark result back in DB
      const { error: markErr } = await sb.rpc("erp_mkt_capi_mark_result_v1", {
        p_event_id: eventId,
        p_status: status,
        p_response: responsePayload,
      });

      if (markErr) {
        // If marking fails, we cannot lose visibility: throw hard
        throw markErr;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: events.length, sent, retry, failed }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { "content-type": "application/json" } },
    );
  }
});
