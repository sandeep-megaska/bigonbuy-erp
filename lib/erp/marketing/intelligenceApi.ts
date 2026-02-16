// lib/erp/marketing/intelligenceApi.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

export const OWNER_ADMIN_ROLE_KEYS = ["owner", "admin"] as const;

export type MarketingApiContext = {
  userId: string;
  roleKey: string;
  companyId: string;
};

// ---------------------------
// small helpers used by APIs
// ---------------------------
export function parseLimitParam(value: unknown, fallback = 50, max = 500): number {
  const n = typeof value === "string" ? Number(value) : Array.isArray(value) ? Number(value[0]) : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseDateParam(value: unknown): string | null {
  const s = typeof value === "string" ? value : Array.isArray(value) ? value[0] : null;
  if (!s) return null;
  // accept YYYY-MM-DD only
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// ---------------------------
// auth + context resolution
// ---------------------------
function extractBearer(req: NextApiRequest): string | null {
  const raw = req.headers.authorization || "";
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function readCookie(req: NextApiRequest, name: string): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) return null;
  const parts = cookie.split(";").map((p) => p.trim());
  for (const p of parts) {
    if (!p.toLowerCase().startsWith(name.toLowerCase() + "=")) continue;
    const v = p.substring(name.length + 1);
    return decodeURIComponent(v);
  }
  return null;
}

function resolveCompanyId(req: NextApiRequest): string | null {
  // 1) header (if you ever add middleware)
  const h = req.headers["x-erp-company-id"];
  if (typeof h === "string" && h) return h;

  // 2) cookie fallbacks (common names)
  return (
    readCookie(req, "erp_company_id") ||
    readCookie(req, "bb_company_id") ||
    readCookie(req, "company_id") ||
    null
  );
}

function resolveRoleKey(req: NextApiRequest): string | null {
  const h = req.headers["x-erp-role-key"];
  if (typeof h === "string" && h) return h;

  return (
    readCookie(req, "erp_role_key") ||
    readCookie(req, "bb_role_key") ||
    readCookie(req, "role_key") ||
    null
  );
}

/**
 * IMPORTANT:
 * - For browser CSV downloads: call resolveMarketingApiContext(req, res)
 *   so cookie session auth works.
 * - Bearer token auth remains supported for worker/scripts.
 */
export async function resolveMarketingApiContext(
  req: NextApiRequest,
  res?: NextApiResponse
): Promise<MarketingApiContext> {
  // Prefer bearer if present (useful for server-to-server)
  const bearer = extractBearer(req);

  let userId: string | null = null;

  if (bearer) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.");
    }

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false },
    });

    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user?.id) throw new Error("Not authenticated (bearer).");
    userId = data.user.id;
  } else {
    // Cookie session path (this is what your CSV downloads need)
    if (!res) {
      // force caller to pass res so auth-helpers can read/write cookies correctly
      throw new Error("Missing response object. Call resolveMarketingApiContext(req, res) for cookie-auth routes.");
    }
    const supabase = createServerSupabaseClient({ req, res });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user?.id) throw new Error("Not authenticated (cookie).");
    userId = data.user.id;
  }

  // company + role
  const companyId = resolveCompanyId(req);
  const roleKey = resolveRoleKey(req);

  if (!companyId) {
    throw new Error("Missing company context (companyId not found in cookie/header).");
  }
  if (!roleKey) {
    throw new Error("Missing access context (roleKey not found in cookie/header).");
  }

  return { userId, companyId, roleKey };
}
