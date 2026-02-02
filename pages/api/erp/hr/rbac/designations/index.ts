import type { NextApiRequest, NextApiResponse } from "next";
import { authorizeHrAccess, createServiceClient, getSupabaseEnv } from "lib/hrRoleApi";

type DesignationRow = {
  id: string;
  code: string | null;
  name: string | null;
  department: string | null;
  is_active: boolean | null;
};

type ApiResponse =
  | { ok: true; designations: DesignationRow[] }
  | { ok: false; error: string };

function getAccessToken(req: NextApiRequest) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceKey, missing } = getSupabaseEnv();
  if (missing.length) {
    return res.status(500).json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  const accessToken = getAccessToken(req);
  const authz = await authorizeHrAccess({ supabaseUrl, anonKey, accessToken });
  if (authz.status !== 200) {
    return res.status(authz.status).json({ ok: false, error: authz.error });
  }

  const adminClient = createServiceClient(supabaseUrl, serviceKey);
  const { data, error } = await adminClient
    .from("erp_designations")
    .select("id, code, name, department, is_active")
    .order("name", { ascending: true });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({ ok: true, designations: (data as DesignationRow[]) ?? [] });
}
