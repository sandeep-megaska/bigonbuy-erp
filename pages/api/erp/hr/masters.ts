import type { NextApiRequest, NextApiResponse } from "next";
//import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../lib/serverSupabase";
type MasterType = "departments" | "job-titles" | "locations" | "employment-types";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessListResponse = { ok: true; rows: unknown[] };
type SuccessUpsertResponse = { ok: true; row: unknown };
type ApiResponse = ErrorResponse | SuccessListResponse | SuccessUpsertResponse;

const MASTER_CONFIG: Record<
  MasterType,
  {
    listRpc: string;
    upsertRpc: string;
    buildPayload: (body: Record<string, unknown>) => Record<string, unknown>;
  }
> = {
  departments: {
    listRpc: "erp_hr_departments_list",
    upsertRpc: "erp_hr_department_upsert",
    buildPayload: (body) => ({
      p_id: (body.id as string) ?? null,
      p_name: (body.name as string) ?? null,
      p_code: (body.code as string) ?? null,
      p_is_active:
        typeof body.is_active === "boolean"
          ? body.is_active
          : String(body.is_active ?? "").toLowerCase() !== "false",
    }),
  },
  "job-titles": {
    listRpc: "erp_hr_job_titles_list",
    upsertRpc: "erp_hr_job_title_upsert",
    buildPayload: (body) => ({
      p_id: (body.id as string) ?? null,
      p_title: (body.title as string) ?? null,
      p_level: Number.isFinite(body.level as number) ? (body.level as number) : null,
      p_is_active:
        typeof body.is_active === "boolean"
          ? body.is_active
          : String(body.is_active ?? "").toLowerCase() !== "false",
    }),
  },
  locations: {
    listRpc: "erp_hr_locations_list",
    upsertRpc: "erp_hr_location_upsert",
    buildPayload: (body) => ({
      p_id: (body.id as string) ?? null,
      p_name: (body.name as string) ?? null,
      p_country: (body.country as string) ?? null,
      p_state: (body.state as string) ?? null,
      p_city: (body.city as string) ?? null,
      p_is_active:
        typeof body.is_active === "boolean"
          ? body.is_active
          : String(body.is_active ?? "").toLowerCase() !== "false",
    }),
  },
  "employment-types": {
    listRpc: "erp_hr_employment_types_list",
    upsertRpc: "erp_hr_employment_type_upsert",
    buildPayload: (body) => ({
      p_id: (body.id as string) ?? null,
      p_key: (body.key as string) ?? null,
      p_name: (body.name as string) ?? null,
      p_is_active:
        typeof body.is_active === "boolean"
          ? body.is_active
          : String(body.is_active ?? "").toLowerCase() !== "false",
    }),
  },
};

function resolveMasterType(value: string | string[] | undefined): MasterType | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) return null;
  if (normalized === "departments") return "departments";
  if (normalized === "job-titles" || normalized === "job_titles" || normalized === "jobTitles") {
    return "job-titles";
  }
  if (normalized === "locations") return "locations";
  if (
    normalized === "employment-types" ||
    normalized === "employment_types" ||
    normalized === "employmentTypes"
  ) {
    return "employment-types";
  }
  return null;
}

async function ensureAuthenticatedClient(req: NextApiRequest) {
  const { supabaseUrl, anonKey, missing } = getSupabaseEnv();
  if (!supabaseUrl || !anonKey || missing.length > 0) {
    throw new Error(
      "Missing Supabase env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"
    );
  }

  const accessToken = getBearerToken(req);
  if (!accessToken) {
    const err = new Error("401");
    err.name = "UNAUTHORIZED";
    throw err;
  }

  const userClient = createUserClient(supabaseUrl, anonKey, accessToken);
  const { data: userData, error: sessionError } = await userClient.auth.getUser();
  if (sessionError || !userData?.user) {
    const err = new Error("401");
    err.name = "UNAUTHORIZED";
    throw err;
  }

  return { userClient };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const masterType = resolveMasterType(req.query.type);
  const config = masterType ? MASTER_CONFIG[masterType] : null;
  if (!config) {
    return res.status(400).json({ ok: false, error: "Invalid master type" });
  }

  try {
    const { userClient } = await ensureAuthenticatedClient(req);

    if (req.method === "GET") {
      const { data, error } = await userClient.rpc(config.listRpc);
      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to load records",
          details: error.details || error.hint || error.code,
        });
      }
      return res.status(200).json({ ok: true, rows: Array.isArray(data) ? data : [] });
    }

    if (req.method === "POST") {
      const rpcInput = config.buildPayload((req.body ?? {}) as Record<string, unknown>);
      const { data, error } = await userClient.rpc(config.upsertRpc, rpcInput);
      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || "Failed to save record",
          details: error.details || error.hint || error.code,
        });
      }
      return res.status(200).json({ ok: true, row: data as unknown });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    if (err instanceof Error && err.name === "UNAUTHORIZED") {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
