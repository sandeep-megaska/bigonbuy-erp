import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken } from "../../../../lib/serverSupabase";

const isDev = process.env.NODE_ENV !== "production";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  if (!isDev) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null;

  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({
      ok: false,
      error: "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY",
    });
  }

  const bearerToken = getBearerToken(req);
  if (!bearerToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, bearerToken);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { data: membership, error: membershipError } = await userClient
    .from("erp_company_users")
    .select("role_key, is_active")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    return res.status(500).json({ ok: false, error: membershipError.message });
  }

  if (!membership || !["owner", "admin"].includes(membership.role_key)) {
    return res.status(403).json({ ok: false, error: "Not authorized" });
  }

  const { data, error } = await userClient
    .from("information_schema.columns")
    .select("table_name, column_name, data_type, is_nullable, ordinal_position")
    .eq("table_schema", "public")
    .like("table_name", "erp_%")
    .order("table_name", { ascending: true })
    .order("ordinal_position", { ascending: true });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, columns: data || [] });
}
