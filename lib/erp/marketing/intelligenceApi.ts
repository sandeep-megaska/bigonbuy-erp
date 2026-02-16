// lib/erp/marketing/intelligenceApi.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const OWNER_ADMIN_ROLE_KEYS = ["owner", "admin"] as const;

export type MarketingApiContextOk = {
  ok: true;
  status: 200;
  userId: string;
  roleKey: string;
  companyId: string;
  userClient: SupabaseClient;
};

export type MarketingApiContextFail = {
  ok: false;
  status: number;
  error: string;
};

export type MarketingApiContext = MarketingApiContextOk | MarketingApiContextFail;

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
 * Contract expected by your API routes:
 * - returns { ok, status, error? } union
 * - includes userClient when ok=true
 *
 * IMPORTANT:
 * For browser-triggered routes (CSV download links), CALL WITH (req, res)
 * so cookie-session auth works.
 */
export async function resolveMarketingApiContext(
  req: NextApiRequest,
  res?: NextApiResponse
): Promise<MarketingApiContext> {
  try {
    const companyId = resolveCompanyId(req);
    const roleKey = resolveRoleKey(req);

    if (!companyId) return { ok: false, status: 400, error: "Missing company context (companyId not found)." };
    if (!roleKey) return { ok: false, status: 400, error: "Missing access context (roleKey not found)." };

    const bearer = extractBearer(req);

    // 1) Bearer path (server-to-server / scripts)
    if (bearer) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) {
        return {
          ok: false,
          status: 500,
          error: "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.",
        };
      }

      const userClient = createClient(url, anon, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
        auth: { persistSession: false },
      });

      const { data, error } = await userClient.auth.getUser();
      if (error || !data?.user?.id) return { ok: false, status: 401, error: "Not authenticated (bearer)." };

      return {
        ok: true,
        status: 200,
        userId: data.user.id,
        companyId,
        roleKey,
        userClient,
      };
    }

    // 2) Cookie session path (browser)
    if (!res) {
      // Keep old callers from silently breaking: they MUST pass res for cookie auth.
      return {
        ok: false,
        status: 400,
        error: "Missing response object. Call resolveMarketingApiContext(req, res) for cookie-auth routes.",
      };
    }

    const userClient = createServerSupabaseClient({ req, res });
    const { data, error } = await userClient.auth.getUser();
    if (error || !data?.user?.id) return { ok: false, status: 401, error: "Not authenticated (cookie)." };

    return {
      ok: true,
      status: 200,
      userId: data.user.id,
      companyId,
      roleKey,
      userClient,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error resolving marketing API context.";
    return { ok: false, status: 500, error: msg };
  }
}
