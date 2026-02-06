import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessResponse = { ok: true; employee: unknown };
type ApiResponse = ErrorResponse | SuccessResponse;

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    return res.status(500).json({
      ok: false,
      error:
        "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    return res.status(401).json({ ok: false, error: "Missing Authorization: Bearer token" });
  }

  const {
    full_name,
    email,
    phone,
    designation,
    department,
    joining_date,
    employment_status,
    dob,
    gender,
    address_json,
    salary_json,
    photo_path,
    id_proof_type,
    aadhaar_last4,
    id_proof_path,
  } = (req.body ?? {}) as Record<string, unknown>;

  const normalizedFullName = typeof full_name === "string" ? full_name.trim() : "";
  if (!normalizedFullName) {
    return res.status(400).json({ ok: false, error: "full_name is required" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const rpcInput = {
    p_full_name: normalizedFullName,
    p_email: typeof email === "string" ? email.trim().toLowerCase() : null,
    p_phone: typeof phone === "string" ? phone.trim() : null,
    p_designation: typeof designation === "string" ? designation.trim() : null,
    p_department: typeof department === "string" ? department.trim() : null,
    p_joining_date: typeof joining_date === "string" && joining_date ? joining_date : null,
    p_employment_status: typeof employment_status === "string" ? employment_status.trim() : null,
    p_dob: typeof dob === "string" && dob ? dob : null,
    p_gender: typeof gender === "string" ? gender.trim() : null,
    p_address_json: typeof address_json === "object" || address_json === null ? address_json : null,
    p_salary_json: typeof salary_json === "object" || salary_json === null ? salary_json : null,
    p_photo_path: typeof photo_path === "string" ? photo_path : null,
    p_id_proof_type: typeof id_proof_type === "string" ? id_proof_type.trim() : null,
    p_aadhaar_last4: typeof aadhaar_last4 === "string" ? aadhaar_last4.trim() : null,
    p_id_proof_path: typeof id_proof_path === "string" ? id_proof_path : null,
  };

  const { data, error } = await userClient.rpc("erp_create_employee", rpcInput);
  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Failed to create employee",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({ ok: true, employee: data });
}
