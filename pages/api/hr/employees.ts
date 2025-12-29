import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../lib/serverSupabase";

type EmployeeRow = {
  id: string;
  employee_code: string | null;
  employee_no: string | null;
  full_name: string;
  email: string | null;
  work_email: string | null;
  personal_email: string | null;
  phone: string | null;
  joining_date: string | null;
  status: string | null;
  employment_status: string | null;
  department: string | null;
  designation: string | null;
  designation_id: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessListResponse = { ok: true; employees: EmployeeRow[] };
type SuccessUpsertResponse = { ok: true; employee: EmployeeRow };
type ApiResponse = ErrorResponse | SuccessListResponse | SuccessUpsertResponse;

type UpsertPayload = {
  id?: string | null;
  employee_no?: string | null;
  full_name?: string | null;
  work_email?: string | null;
  personal_email?: string | null;
  phone?: string | null;
  joining_date?: string | null;
  status?: string | null;
  department?: string | null;
  designation?: string | null;
  designation_id?: string | null;
};

async function handleList(
  _req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
  supabaseUrl: string,
  anonKey: string,
  accessToken: string
) {
  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const { data, error } = await userClient.rpc("erp_list_employees");
  if (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Failed to load employees",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({ ok: true, employees: (data as EmployeeRow[]) || [] });
}

async function handleUpsert(
  req: NextApiRequest,
  res: NextApiResponse<ApiResponse>,
  supabaseUrl: string,
  anonKey: string,
  accessToken: string
) {
  const payload = (req.body ?? {}) as UpsertPayload;
  const fullName = payload.full_name?.trim();
  if (!fullName) {
    return res.status(400).json({ ok: false, error: "full_name is required" });
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  const rpcInput = {
    p_employee_id: payload.id || null,
    p_employee_no: payload.employee_no ?? null,
    p_full_name: fullName,
    p_work_email: payload.work_email ?? null,
    p_personal_email: payload.personal_email ?? null,
    p_phone: payload.phone ?? null,
    p_joining_date: payload.joining_date ?? null,
    p_status: payload.status ?? null,
    p_department: payload.department ?? null,
    p_designation: payload.designation ?? null,
    p_designation_id: payload.designation_id ?? null,
  };

  const { data, error } = await userClient.rpc("erp_upsert_employee", rpcInput);
  if (error) {
    return res.status(400).json({
      ok: false,
      error: error.message || "Failed to save employee",
      details: error.details || error.hint || error.code,
    });
  }

  return res.status(200).json({ ok: true, employee: data as EmployeeRow });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
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

  try {
    if (req.method === "GET") {
      return await handleList(req, res, supabaseUrl, anonKey, accessToken);
    }

    if (req.method === "POST") {
      return await handleUpsert(req, res, supabaseUrl, anonKey, accessToken);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
