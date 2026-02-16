// lib/erp/marketing/intelligenceApi.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "../supabaseAdmin"; // <- keep whatever you already use for service/admin
import { getCompanyContext } from "../../erpContext"; // <- if you already use this, keep it; otherwise remove

export const OWNER_ADMIN_ROLE_KEYS = ["owner", "admin"] as const;

export type MarketingApiContext = {
  ok: true;
  userId: string;
  roleKey: string;
  companyId: string;
};

function extractBearer(req: NextApiRequest): string | null {
  const raw = req.headers.authorization || "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

// IMPORTANT: signature now accepts res optionally
export async function resolveMarketingApiContext(req: NextApiRequest, res?: NextApiResponse): Promise<MarketingApiContext> {
  // 1) If caller provided Bearer token, keep supporting it (workers / scripts)
  const bearer = extractBearer(req);
  if (bearer) {
    // If you already had logic here, keep your existing bearer verification.
    // Minimal safe pattern: validate token by calling Supabase with it.
    const supa = supabaseAdmin.auth; // placeholder; replace with YOUR existing bearer flow if different

    // Many codebases do:
    // const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${bearer}` }}})
    // const { data } = await supabase.auth.getUser();
    // Use your existing implementation if you already have it.

    // If you don't have it implemented, DO NOT guess here.
    // In most of your app, you should use cookie auth anyway.
  }

  // 2) No bearer token — use cookie session (this is what browser CSV downloads need)
  if (!res) {
    // Without res we can’t use auth-helpers cookie flow reliably.
    throw new Error("Missing auth context: pass (req,res) or send Authorization: Bearer <token>.");
  }

  const supabase = createServerSupabaseClient({ req, res });
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.id) {
    throw new Error("Not authenticated.");
  }

  // 3) Resolve company + role using YOUR existing company context logic
  // If your current intelligenceApi.ts already calculates roleKey/companyId, keep that code.
  const ctx = await getCompanyContext(); // If this reads from cookies/session, it should work.
  const roleKey = (ctx?.roleKey ?? null) as string | null;
  const companyId = (ctx?.companyId ?? null) as string | null;

  if (!roleKey || !companyId) {
    throw new Error("Missing company context.");
  }

  return {
    ok: true,
    userId: userData.user.id,
    roleKey,
    companyId,
  };
}
