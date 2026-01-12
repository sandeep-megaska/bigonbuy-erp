import type { NextApiRequest, NextApiResponse } from "next";
import { createUserClient, getBearerToken, getSupabaseEnv } from "../../../../../lib/serverSupabase";

type MasterKey = "departments" | "designations" | "grades" | "locations" | "cost-centers";

type ErrorResponse = { ok: false; error: string; details?: string | null };

type SuccessListResponse = { ok: true; rows: Record<string, unknown>[] };

type SuccessUpsertResponse = { ok: true; row: Record<string, unknown> | null };

type ApiResponse = ErrorResponse | SuccessListResponse | SuccessUpsertResponse;

type MasterConfig = {
  table: string;
  label: string;
};

const MASTER_CONFIG: Record<MasterKey, MasterConfig> = {
  departments: { table: "erp_hr_departments", label: "department" },
  designations: { table: "erp_hr_designations", label: "designation" },
  grades: { table: "erp_hr_grades", label: "grade" },
  locations: { table: "erp_hr_locations", label: "location" },
  "cost-centers": { table: "erp_hr_cost_centers", label: "cost center" },
};

function normalizeMasterKey(value: string | string[] | undefined): MasterKey | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized === "departments") return "departments";
  if (normalized === "designations") return "designations";
  if (normalized === "grades") return "grades";
  if (normalized === "locations") return "locations";
  if (normalized === "cost-centers" || normalized === "cost_centers" || normalized === "costcenters") {
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

function sanitizeName(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function sanitizeCode(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ApiResponse>) {
  const masterKey = normalizeMasterKey(req.query.master);
  if (!masterKey) {
    return res.status(400).json({ ok: false, error: "Invalid master type" });
  }

  const config = MASTER_CONFIG[masterKey];

  try {
    const { userClient } = await ensureAuthenticatedClient(req);

    if (req.method === "GET") {
      const { data, error } = await userClient
        .from(config.table)
        .select("id, name, code, is_active, updated_at")
        .order("name", { ascending: true });

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || `Failed to load ${config.label}s`,
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, rows: (data ?? []) as Record<string, unknown>[] });
    }

    if (req.method === "POST") {
      const name = sanitizeName(req.body?.name);
      if (!name) {
        return res.status(400).json({ ok: false, error: "Name is required" });
      }

      const payload: Record<string, unknown> = {
        name,
        code: sanitizeCode(req.body?.code),
      };

      const recordId = typeof req.body?.id === "string" ? req.body.id : null;
      if (recordId) {
        const { data, error } = await userClient
          .from(config.table)
          .update(payload)
          .eq("id", recordId)
          .select("id, name, code, is_active, updated_at")
          .single();

        if (error) {
          return res.status(400).json({
            ok: false,
            error: error.message || `Failed to update ${config.label}`,
            details: error.details || error.hint || error.code,
          });
        }

        return res.status(200).json({ ok: true, row: data as Record<string, unknown> });
      }

      const { data, error } = await userClient
        .from(config.table)
        .insert({ ...payload, is_active: true })
        .select("id, name, code, is_active, updated_at")
        .single();

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || `Failed to create ${config.label}`,
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, row: data as Record<string, unknown> });
    }

    if (req.method === "PATCH") {
      const recordId = typeof req.body?.id === "string" ? req.body.id : null;
      const isActive = typeof req.body?.is_active === "boolean" ? req.body.is_active : null;

      if (!recordId || isActive === null) {
        return res.status(400).json({ ok: false, error: "id and is_active are required" });
      }

      const { data, error } = await userClient
        .from(config.table)
        .update({ is_active: isActive })
        .eq("id", recordId)
        .select("id, name, code, is_active, updated_at")
        .single();

      if (error) {
        return res.status(400).json({
          ok: false,
          error: error.message || `Failed to update ${config.label}`,
          details: error.details || error.hint || error.code,
        });
      }

      return res.status(200).json({ ok: true, row: data as Record<string, unknown> });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  } catch (err) {
    if (err instanceof Error && err.name === "UNAUTHORIZED") {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ ok: false, error: message });
  }
}
