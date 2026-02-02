import type { NextApiRequest, NextApiResponse } from "next";
import { authorizeHrAccess, createServiceClient, getSupabaseEnv } from "lib/hrRoleApi";

type DesignationRow = {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
};

type ApiResponse =
  | { ok: true; designations: DesignationRow[] }
  | { ok: false; error: string };

function getAccessToken(req: NextApiRequest) {
  const authHeader = req.headers.authorization || "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
}

function isAuthorizeFailure(
  x: unknown
): x is { status: number; error: string } {
  return (
    typeof x === "object" &&
    x !== null &&
    "status" in x &&
    (x as any).status !== 200 &&
    "error" in x &&
    typeof (x as any).error === "string"
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, serviceKey, missing } = getSupabaseEnv();
  if (missing.length > 0) {
    return res
      .status(500)
      .json({ ok: false, error: `Missing Supabase env vars: ${missing.join(", ")}` });
  }

  // ✅ Values guaranteed to be strings now
  const supabaseUrlValue = (supabaseUrl || "").trim();
  const anonKeyValue = (anonKey || "").trim();
  const serviceKeyValue = (serviceKey || "").trim();
  if (!supabaseUrlValue || !anonKeyValue || !serviceKeyValue) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = (getAccessToken(req) || "").trim();
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Authorization token is required" });
  }

  const authz = await authorizeHrAccess({
    supabaseUrl: supabaseUrlValue,
    anonKey: anonKeyValue,
    accessToken,
  });

  if (isAuthorizeFailure(authz)) {
    return res.status(authz.status).json({ ok: false, error: authz.error });
  }

  const adminClient = createServiceClient(supabaseUrlValue, serviceKeyValue);

  // ✅ CANONICAL: use erp_hr_designations (CEO/Director/Engineer/WA...)
  const { data, error } = await adminClient
    .from("erp_hr_designations")
    .select("id, name, code, is_active")
    .eq("company_id", authz.companyId)
    .order("name", { ascending: true });

  if (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }

  return res.status(200).json({
    ok: true,
    designations: ((data as any) ?? []) as DesignationRow[],
  });
}
