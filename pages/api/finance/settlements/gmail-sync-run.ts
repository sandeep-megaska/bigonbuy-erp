import type { NextApiRequest, NextApiResponse } from "next";
import {
  createUserClient,
  getCookieAccessToken,
  getSiteUrl,
  getSupabaseEnv,
} from "../../../../lib/serverSupabase";

type GmailSyncRunResponse = {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GmailSyncRunResponse>,
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
    });
  }

  const accessToken = getCookieAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const secret = process.env.ERP_INTERNAL_JOB_SECRET ?? null;
  if (!secret) {
    return res.status(500).json({ ok: false, error: "Missing ERP_INTERNAL_JOB_SECRET" });
  }

  const host = req.headers.host;
  const protocolHeader = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(protocolHeader)
    ? protocolHeader[0]
    : protocolHeader || "http";
  const baseUrl = host ? `${protocol}://${host}` : getSiteUrl();
  const query = req.url?.split("?")[1];
  const url = query
    ? `${baseUrl}/api/finance/settlements/gmail-sync?${query}`
    : `${baseUrl}/api/finance/settlements/gmail-sync`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "x-bb-secret": secret,
    },
  });

  const result = (await response.json().catch(() => ({}))) as GmailSyncRunResponse;

  if (!response.ok) {
    return res.status(response.status).json({
      ...result,
      ok: false,
      error: result?.error || "Gmail sync failed",
    });
  }

  return res.status(200).json(result);
}
