// lib/erp/marketing/intelligenceApi.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";

export const OWNER_ADMIN_ROLE_KEYS = ["owner", "admin"] as const;

export type MarketingApiContextOk = {
  ok: true;
  userId: string;
  roleKey: string;
  companyId: string;
};

export type MarketingApiContextErr = {
  ok: false;
  status: number;
  error: string;
};

export type MarketingApiContext = MarketingApiContextOk | MarketingApiContextErr;

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// ---------------------------
// internal helpers
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
  const h = req.headers["x-erp-company-id"];
  if (typeof h === "string" && h) return h;

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
 * Contract (matches your existing API code):
 * - returns { ok:true, userId, companyId, roleKey } OR { ok:false, status, error }
 *
 * Auth rules:
 * - If Authorization: Bearer <token> is present => validate via supabase.auth.getUser()
 * - Else => cookie-session auth using createServerSupabaseClient (requires res for best compatibility)
 *
 * IMPORTANT:
 * - For CSV downloads from browser, always call resolveMarketingApiContext(req, res)
 *   so cookie auth works (no bearer needed).
 */
export async function resolveMarketingApiContext(
  req: NextApiRequest,
  res?: NextApiResponse
): Promise<MarketingApiContext> {
  try {
    const bearer = extractBearer(req);

    let userId: string | null = null;

    if (bearer) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

      if (!url || !anon) {
        return { ok: false, status: 500, error: "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY." };
      }

      const supabase = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false },
      });

      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user?.id) return { ok: false, status: 401, error: "Not authenticated (bearer)." };
      userId = data.user.id;
    } else {
      // Cookie session path (browser)
      // NOTE: auth-helpers prefers having both req+res. If res is not provided, we still try,
      // but some setups may fail to read cookies consistently.
      const supabase = createServerSupabaseClient({ req, res: res as any });
      const { data, error } = await supabase.auth.getUser();
      if (error || !data?.user?.id) return { ok: false, status: 401, error: "Not authenticated (cookie)." };
      userId = data.user.id;
    }

    const companyId = resolveCompanyId(req);
    const roleKey = resolveRoleKey(req);

    if (!companyId) return { ok: false, status: 400, error: "Missing company context (companyId not found)." };
    if (!roleKey) return { ok: false, status: 403, error: "Missing access context (roleKey not found)." };

    return { ok: true, userId, companyId, roleKey };
  } catch (e: any) {
    return { ok: false, status: 500, error: e?.message || "Unknown error resolving marketing api context." };
  }
}
