import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type MasterType = "departments" | "designations" | "grades" | "locations" | "cost-centers";

type ErrorResponse = { ok: false; error: string; details?: string | null };
type SuccessListResponse = { ok: true; rows: unknown[] };
type SuccessUpsertResponse = { ok: true; row: unknown };
type ApiResponse = ErrorResponse | SuccessListResponse | SuccessUpsertResponse;

const COMMON_SELECT = "id, name, code, description, is_active, created_at, updated_at";

const MASTER_CONFIG: Record<
  MasterType,
  {
    table: string;
    select: string;
    buildPayload: (body: Record<string, unknown>) => Record<string, unknown>;
  }
> = {
  departments: {
    table: "erp_hr_departments",
    select: COMMON_SELECT,
    buildPayload: (body) => ({
      ...buildBasePayload(body),
    }),
  },
  designations: {
    table: "erp_hr_designations",
    select: COMMON_SELECT,
    buildPayload: (body) => ({
      ...buildBasePayload(body),
    }),
  },
  grades: {
    table: "erp_hr_grades",
    select: COMMON_SELECT,
    buildPayload: (body) => ({
      ...buildBasePayload(body),
    }),
  },
  locations: {
    table: "erp_hr_locations",
    select: `${COMMON_SELECT}, country, state, city`,
    buildPayload: (body) => ({
      ...buildBasePayload(body),
      country: (body.country as string) ?? null,
      state: (body.state as string) ?? null,
      city: (body.city as string) ?? null,
    }),
  },
  "cost-centers": {
    table: "erp_hr_cost_centers",
    select: COMMON_SELECT,
    buildPayload: (body) => ({
      ...buildBasePayload(body),
    }),
  },
};

function buildBasePayload(body: Record<string, unknown>) {
  const payload: Record<string, unknown> = {
    name: (body.name as string) ?? null,
    code: (body.code as string) ?? null,
    description: (body.description as string) ?? null,
    is_active: resolveIsActive(body.is_active),
  };

  if (typeof body.id === "string" && body.id.trim()) {
    payload.id = body.id;
  }

  return payload;
}

function resolveIsActive(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined || value === "") return true;
  return String(value).toLowerCase() !== "false";
}

function resolveMasterType(value: string | string[] | undefined): MasterType | null {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) return null;
  if (normalized === "departments") return "departments";
  if (normalized === "designations") return "designations";
  if (normalized === "grades") return "grades";
  if (normalized === "locations") return "locations";
  if (
    normalized === "cost-centers" ||
    normalized === "cost_centers" ||
    normalized === "costCenters"
  ) {
    return "cost-centers";
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
      const { data, error } = await userClient
        .from(config.table)
        .select(config.select)
        .order("name", { ascending: true });
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
      const payload = config.buildPayload((req.body ?? {}) as Record<string, unknown>);
      const { data, error } = await userClient
        .from(config.table)
        .upsert(payload, { onConflict: "id" })
        .select(config.select)
        .single();
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
