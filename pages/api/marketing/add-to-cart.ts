import type { NextApiRequest, NextApiResponse } from "next";
import { createHash } from "crypto";
import { z } from "zod";
import { createServiceRoleClient, getSupabaseEnv } from "../../../lib/serverSupabase";

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

function hashExternalIdFromSession(sessionId: string): string {
  return createHash("sha256").update(`bb:${sessionId}`).digest("hex");
}

const requestSchema = z.object({
  session_id: z.string().min(1),
  landing_url: z.string().optional().nullable(),
  fbp: z.string().optional().nullable(),
  fbc: z.string().optional().nullable(),
});

type ApiResponse = { ok: true; touchpoint_id: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const parse = requestSchema.safeParse(req.body ?? {});
  if (!parse.success) {
    return res.status(400).json({ ok: true, touchpoint_id: "invalid" });
  }

  const body = parse.data;
  const userAgent = (req.headers["user-agent"] as string) ?? null;

  if (isBotUserAgent(userAgent)) {
    return res.status(200).json({ ok: true, touchpoint_id: "bot_ignored" });
  }

  const externalId = hashExternalIdFromSession(body.session_id);

  const payload = {
    event_name: "PageView",
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_source_url: body.landing_url ?? null,
    user_data: {
      fbp: body.fbp ?? null,
      fbc: body.fbc ?? null,
      external_id: [externalId],
      client_user_agent: userAgent,
    },
  };

  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  const serviceClient = createServiceRoleClient(supabaseUrl!, serviceRoleKey!);

  const { data } = await serviceClient
    .from("erp_mkt_capi_events")
    .insert({
      event_name: "PageView",
      payload,
      status: "queued",
    })
    .select("id")
    .single();

  return res.status(200).json({ ok: true, touchpoint_id: String(data.id) });
}
