import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextApiRequest } from "next";

type SupabaseEnv = {
  supabaseUrl: string | null;
  anonKey: string | null;
  serviceRoleKey: string | null;
  missing: string[];
};
export function createAnonClient(supabaseUrl: string, anonKey: string) {
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function getSupabaseEnv(): SupabaseEnv {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

  const missing: string[] = [];
  if (!supabaseUrl) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!serviceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return { supabaseUrl, anonKey, serviceRoleKey, missing };
}

export function getBearerToken(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  return authHeader.slice(7).trim() || null;
}

export function getCookieAccessToken(req: NextApiRequest): string | null {
  const parseSupabaseAuthCookieValue = (value: string): string | null => {
    try {
      const parsed = JSON.parse(decodeURIComponent(value));
      if (Array.isArray(parsed) && typeof parsed[0] === "string" && parsed[0]) {
        return parsed[0];
      }
      if (
        parsed &&
        typeof parsed === "object" &&
        "access_token" in parsed &&
        typeof parsed.access_token === "string" &&
        parsed.access_token
      ) {
        return parsed.access_token;
      }
    } catch {
      // ignore malformed auth cookie and continue fallbacks
    }
    return null;
  };

  const token = req.cookies?.["sb-access-token"];
  if (token) return token;

  const supabaseAuthCookie = Object.entries(req.cookies ?? {}).find(
    ([name]) => name.startsWith("sb-") && name.endsWith("-auth-token")
  )?.[1];
  if (supabaseAuthCookie) {
    const parsedToken = parseSupabaseAuthCookieValue(supabaseAuthCookie);
    if (parsedToken) return parsedToken;
  }

  const chunkedSupabaseAuthCookieEntries = Object.entries(req.cookies ?? {})
    .map(([name, value]) => {
      const match = name.match(/^sb-.*-auth-token\.(\d+)$/);
      if (!match) return null;
      return { index: Number.parseInt(match[1], 10), value };
    })
    .filter((entry): entry is { index: number; value: string } => entry !== null)
    .sort((a, b) => a.index - b.index);

  if (chunkedSupabaseAuthCookieEntries.length > 0) {
    // Supabase may split large auth payloads into numbered cookie chunks.
    const combined = chunkedSupabaseAuthCookieEntries.map((entry) => entry.value).join("");
    const parsedToken = parseSupabaseAuthCookieValue(combined);
    if (parsedToken) return parsedToken;
  }

  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;

  const parts = cookieHeader.split(";").map((part) => part.trim());

  const authTokenPart = parts.find(
    (part) => part.startsWith("sb-") && part.includes("-auth-token=")
  );
  if (authTokenPart) {
    const value = authTokenPart.slice(authTokenPart.indexOf("=") + 1);
    const parsedToken = parseSupabaseAuthCookieValue(value);
    if (parsedToken) return parsedToken;
  }

  const chunkedAuthTokenParts = parts
    .map((part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex <= 0) return null;
      const name = part.slice(0, separatorIndex);
      const value = part.slice(separatorIndex + 1);
      const match = name.match(/^sb-.*-auth-token\.(\d+)$/);
      if (!match) return null;
      return { index: Number.parseInt(match[1], 10), value };
    })
    .filter((entry): entry is { index: number; value: string } => entry !== null)
    .sort((a, b) => a.index - b.index);

  if (chunkedAuthTokenParts.length > 0) {
    const combined = chunkedAuthTokenParts.map((entry) => entry.value).join("");
    const parsedToken = parseSupabaseAuthCookieValue(combined);
    if (parsedToken) return parsedToken;
  }

  const tokenPart = parts.find((part) => part.startsWith("sb-access-token="));
  if (!tokenPart) return null;
  const value = tokenPart.slice("sb-access-token=".length);
  return value ? decodeURIComponent(value) : null;
}

export function createUserClient(
  supabaseUrl: string,
  anonKey: string,
  accessToken: string
): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createServiceRoleClient(
  supabaseUrl: string,
  serviceRoleKey: string
): SupabaseClient {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getUserRoleKey(userClient: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await userClient
    .from("erp_company_users")
    .select("role_key, is_active")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.role_key ?? null;
}

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || "https://erp.bigonbuy.com";
}
