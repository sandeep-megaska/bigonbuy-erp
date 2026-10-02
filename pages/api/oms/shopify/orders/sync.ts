import type { NextApiRequest, NextApiResponse } from "next";
import { createServerSupabaseClient } from "@supabase/auth-helpers-nextjs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient, getSupabaseEnv } from "../../../../../lib/serverSupabase";
import { getOrderReconciliationCursor, reconcileShopifyOrders } from "../../../../../lib/erp/shopifyOrderContinuity";

const ALLOWED_ROLE_KEYS = new Set(["owner", "admin", "hr", "manager"]);

type SyncResponse =
  | { ok: true; from_ts: string; imported_orders: number; imported_lines: number; last_order_created_at: string | null; latest_shopify_updated_at?: string | null; errors: string[] }
  | { ok: false; error: string; details?: unknown; missing?: { domain: boolean; token: boolean } };

export default async function handler(req: NextApiRequest, res: NextApiResponse<SyncResponse>) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceRoleKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return res.status(500).json({ ok: false, error: "Missing Supabase env vars", details: missing.join(", ") || null });
  }

  const supabase = createServerSupabaseClient({ req, res });
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  let actorClient: SupabaseClient = supabase;
  let userId = sessionData?.session?.user?.id ?? null;

  if (sessionError && !bearerToken) return res.status(401).json({ ok: false, error: "Not authenticated" });
  if (!sessionData?.session && bearerToken) {
    const bearerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await bearerClient.auth.getUser(bearerToken);
    if (!userError && userData?.user?.id) {
      actorClient = bearerClient;
      userId = userData.user.id;
    }
  }
  if (!userId) return res.status(401).json({ ok: false, error: "Not authenticated" });

  const { data: companyId, error: companyError } = await actorClient.rpc("erp_current_company_id");
  if (companyError || !companyId) return res.status(400).json({ ok: false, error: companyError?.message || "Failed to determine company" });

  const serviceClient = createServiceRoleClient(supabaseUrl, serviceRoleKey);
  const { data: membership, error: membershipError } = await serviceClient
    .from("erp_company_users").select("role_key").eq("company_id", companyId).eq("user_id", userId).eq("is_active", true).limit(1).maybeSingle();
  if (membershipError) return res.status(400).json({ ok: false, error: membershipError.message });
  if (!ALLOWED_ROLE_KEYS.has((membership?.role_key ?? "").toLowerCase())) return res.status(403).json({ ok: false, error: "Only manager/admin can sync Shopify orders" });

  const { data: latestOrder, error: latestOrderError } = await serviceClient
    .from("erp_shopify_orders").select("order_created_at").eq("company_id", companyId).order("order_created_at", { ascending: false }).limit(1).maybeSingle();
  if (latestOrderError) return res.status(400).json({ ok: false, error: latestOrderError.message });

  try {
    const cursor = await getOrderReconciliationCursor(serviceClient, companyId);
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, from_ts: cursor, imported_orders: 0, imported_lines: 0, last_order_created_at: latestOrder?.order_created_at ?? null, errors: [] });
    }

    const result = await reconcileShopifyOrders(serviceClient, companyId);
    const { data: updatedLatest } = await serviceClient
      .from("erp_shopify_orders").select("order_created_at").eq("company_id", companyId).order("order_created_at", { ascending: false }).limit(1).maybeSingle();

    return res.status(200).json({ ok: true, ...result, last_order_created_at: updatedLatest?.order_created_at ?? latestOrder?.order_created_at ?? null });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Shopify sync failed" });
  }
}
