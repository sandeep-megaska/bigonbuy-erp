import type { NextApiRequest, NextApiResponse } from "next";
import { authorizeHrAccess, createServiceClient, getSupabaseEnv } from "lib/hrRoleApi";

type DesignationRow = {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
};

type ApiResponse =
  | { ok: true; designations: DesignationRow[] }
  | { ok: false; error: string };

function getAccessToken(req: NextApiRequest): string | null {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  return token ? token : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceKey, missing } = getSupabaseEnv();

  const supabaseUrlValue = typeof supabaseUrl === "string" ? supabaseUrl.trim() : "";
  const anonKeyValue = typeof anonKey === "string" ? anonKey.trim() : "";
  const serviceKeyValue = typeof serviceKey === "string" ? serviceKey.trim() : "";

  if (!supabaseUrlValue || !anonKeyValue || !serviceKeyValue || (missing?.length ?? 0) > 0) {
    return res.status(500).json({
      ok: false,
      error: `Missing Supabase env vars: ${
        missing && missing.length
          ? missing.join(", ")
          : "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
      }`,
    });
  }

  const accessToken = getAccessToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Authorization token is required" });
  }

  const authz = await authorizeHrAccess({
    supabaseUrl: supabaseUrlValue,
    anonKey: anonKeyValue,
    accessToken,
  });

  // ✅ Deterministic: authorizeHrAccess MUST return { ok: true/false, ... }
  if (!authz.ok) {
    return res.status(authz.status).json({ ok: false, error: authz.error });
  }

  const adminClient = createServiceClient(supabaseUrlValue, serviceKeyValue);

  const { data, error } = await adminClient
    .from("erp_designations")
    .select("id, code, name, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, designations: (data as DesignationRow[]) ?? [] });
}
