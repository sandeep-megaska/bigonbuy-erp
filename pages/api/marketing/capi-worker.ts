import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { createServiceRoleClient, getSupabaseEnv } from "../../../lib/serverSupabase";

const querySchema = z.object({
  company_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type CapiEventRow = {
  id: string;
  event_id: string;
  payload: Record<string, unknown>;
  attempt_count: number;
};

type ApiResponse =
  | {
      ok: true;
      processed: number;
      sent: number;
      failed: number;
      deadlettered: number;
    }
  | { ok: false; error: string; details?: string | null };

function getCronSecret(req: NextApiRequest): string | null {
  const header = req.headers["x-erp-cron-secret"];
  return Array.isArray(header) ? header[0] ?? null : header ?? null;
}

function buildMetaBody(payload: Record<string, unknown>, testEventCode: string | null): Record<string, unknown> {
  const hasDataEnvelope = Array.isArray(payload.data);
  const wrappedData = hasDataEnvelope ? (payload.data as unknown[]) : [payload];
  const body: Record<string, unknown> = { data: wrappedData };
  if (hasDataEnvelope) {
    Object.entries(payload).forEach(([key, value]) => {
      if (key !== "data") {
        body[key] = value;
      }
    });
  }
  if (testEventCode && !("test_event_code" in body)) {
    body.test_event_code = testEventCode;
  }
  return body;
}

function hasUsableMatchKeys(userData: unknown): boolean {
  if (!userData || typeof userData !== "object") return false;
  const userDataRecord = userData as Record<string, unknown>;
  const keys = ["fbp", "fbc", "external_id", "em", "ph", "fn", "ln", "ct", "st", "zp", "country", "client_ip_address"];
  return keys.some((key) => {
    const value = userDataRecord[key];
    if (Array.isArray(value)) return value.some((item) => typeof item === "string" && item.trim().length > 0);
    return typeof value === "string" && value.trim().length > 0;
  });
}

function getMetaErrorMessage(
  responseStatus: number,
  json: Record<string, unknown> | null,
  options?: { includeFullResponse?: boolean },
): string {
  if (options?.includeFullResponse && json) {
    return JSON.stringify(json);
  }
  if (json?.error) {
    return JSON.stringify(json.error);
  }
  return JSON.stringify({ message: `Meta API request failed: ${responseStatus}` });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const expectedSecret = process.env.ERP_CRON_SECRET ?? null;
  const providedSecret = getCronSecret(req);
  if (!expectedSecret || providedSecret !== expectedSecret) {
    return res.status(401).json({ ok: false, error: "Invalid or missing X-ERP-CRON-SECRET" });
  }

  const parsedQuery = querySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ ok: false, error: "Invalid query" });
  }

  const companyId = parsedQuery.data.company_id ?? process.env.ERP_SERVICE_COMPANY_ID ?? null;
  if (!companyId) {
    return res.status(500).json({ ok: false, error: "Missing company_id query or ERP_SERVICE_COMPANY_ID" });
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

  const { data: settings, error: settingsError } = await serviceClient
    .from("erp_mkt_settings")
    .select("meta_pixel_id, meta_access_token, meta_test_event_code")
    .eq("company_id", companyId)
    .maybeSingle();

  if (settingsError) {
    return res.status(500).json({ ok: false, error: "Failed to load marketing settings", details: settingsError.message });
  }

  const pixelId = settings?.meta_pixel_id ?? process.env.META_PIXEL_ID ?? null;
  const accessToken = settings?.meta_access_token ?? process.env.META_ACCESS_TOKEN ?? null;
  const testEventCode = settings?.meta_test_event_code ?? process.env.META_TEST_EVENT_CODE ?? null;

  if (!pixelId || !accessToken) {
    return res.status(400).json({ ok: false, error: "Missing Meta credentials in erp_mkt_settings or env" });
  }

  const { data: events, error: dequeueError } = await serviceClient.rpc("erp_mkt_capi_dequeue_batch", {
    p_company_id: companyId,
    p_limit: parsedQuery.data.limit ?? 50,
  });

  if (dequeueError) {
    return res.status(500).json({ ok: false, error: "Failed to dequeue CAPI events", details: dequeueError.message });
  }

  let sent = 0;
  let failed = 0;
  let deadlettered = 0;

  const queue = (events ?? []) as CapiEventRow[];
  for (const row of queue) {
    try {
      const body = buildMetaBody(row.payload, testEventCode);
      const events = Array.isArray(body.data) ? body.data : [];
      const missingMatchKeys = events.some((event) => {
        if (!event || typeof event !== "object") return true;
        return !hasUsableMatchKeys((event as Record<string, unknown>).user_data);
      });

      if (missingMatchKeys) {
        const deadletter = row.attempt_count + 1 >= 8;
        await serviceClient.rpc("erp_mkt_capi_mark_failed", {
          p_company_id: companyId,
          p_event_id: row.event_id,
          p_error: JSON.stringify({ error: "no_match_keys" }),
          p_deadletter: deadletter,
        });
        if (deadletter) deadlettered += 1;
        else failed += 1;
        continue;
      }

      const response = await fetch(
        `https://graph.facebook.com/v19.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
      if (!response.ok || json?.error) {
        const errMessage = getMetaErrorMessage(response.status, json, { includeFullResponse: !response.ok });
        const deadletter = row.attempt_count + 1 >= 8;
        await serviceClient.rpc("erp_mkt_capi_mark_failed", {
          p_company_id: companyId,
          p_event_id: row.event_id,
          p_error: errMessage,
          p_deadletter: deadletter,
        });
        if (deadletter) deadlettered += 1;
        else failed += 1;
        continue;
      }

      await serviceClient.rpc("erp_mkt_capi_mark_sent", {
        p_company_id: companyId,
        p_event_id: row.event_id,
      });
      sent += 1;
    } catch (error: unknown) {
      const deadletter = row.attempt_count + 1 >= 8;
      await serviceClient.rpc("erp_mkt_capi_mark_failed", {
        p_company_id: companyId,
        p_event_id: row.event_id,
        p_error: error instanceof Error ? error.message : "Unknown network error",
        p_deadletter: deadletter,
      });
      if (deadletter) deadlettered += 1;
      else failed += 1;
    }
  }

  return res.status(200).json({
    ok: true,
    processed: queue.length,
    sent,
    failed,
    deadlettered,
  });
}
