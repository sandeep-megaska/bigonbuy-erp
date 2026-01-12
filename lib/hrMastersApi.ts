import { supabase } from "./supabaseClient";

export type BaseRow = {
  id?: string;
  name?: string;
  title?: string;
  key?: string;
  code?: string;
  level?: number | null;
  country?: string;
  state?: string;
  city?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DepartmentRow = {
  id?: string;
  name?: string;
  code?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type JobTitleRow = {
  id?: string;
  title?: string;
  level?: number | null;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type LocationRow = {
  id?: string;
  name?: string;
  country?: string;
  state?: string;
  city?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type EmploymentTypeRow = {
  id?: string;
  key?: string;
  name?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type DesignationRow = {
  id?: string;
  code?: string;
  name?: string;
  is_active?: boolean;
};

export type UpsertDepartmentInput = {
  id?: string | null;
  name?: string | null;
  code?: string | null;
  is_active?: boolean | null;
};

export type UpsertJobTitleInput = {
  id?: string | null;
  title?: string | null;
  level?: number | null;
  is_active?: boolean | null;
};

export type UpsertLocationInput = {
  id?: string | null;
  name?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  is_active?: boolean | null;
};

export type UpsertEmploymentTypeInput = {
  id?: string | null;
  key?: string | null;
  name?: string | null;
  is_active?: boolean | null;
};

function normalizeError(error: { message?: string } | null, fallback: string) {
  if (!error) return new Error(fallback);
  return new Error(error.message || fallback);
}

function resolveUpsertId(data: unknown, fallbackId?: string | null) {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const maybeId = (data as { id?: string }).id;
    if (maybeId) return maybeId;
  }
  if (Array.isArray(data) && data[0] && typeof data[0] === "object") {
    const maybeId = (data[0] as { id?: string }).id;
    if (maybeId) return maybeId;
  }
  return fallbackId || "";
}

export async function listDepartments(): Promise<DepartmentRow[]> {
  const { data, error } = await supabase.rpc("erp_hr_departments_list");
  if (error) throw normalizeError(error, "Failed to load departments");
  return Array.isArray(data) ? (data as DepartmentRow[]) : [];
}

export async function listJobTitles(): Promise<JobTitleRow[]> {
  const { data, error } = await supabase.rpc("erp_hr_job_titles_list");
  if (error) throw normalizeError(error, "Failed to load job titles");
  return Array.isArray(data) ? (data as JobTitleRow[]) : [];
}

export async function listLocations(): Promise<LocationRow[]> {
  const { data, error } = await supabase.rpc("erp_hr_locations_list");
  if (error) throw normalizeError(error, "Failed to load locations");
  return Array.isArray(data) ? (data as LocationRow[]) : [];
}

export async function listEmploymentTypes(): Promise<EmploymentTypeRow[]> {
  const { data, error } = await supabase.rpc("erp_hr_employment_types_list");
  if (error) throw normalizeError(error, "Failed to load employment types");
  return Array.isArray(data) ? (data as EmploymentTypeRow[]) : [];
}

export async function listDesignations(): Promise<DesignationRow[]> {
  const { data, error } = await supabase
    .from("erp_hr_designations")
    .select("id, name, code, is_active")
    .order("name", { ascending: true });
  if (error) throw normalizeError(error, "Failed to load designations");
  return Array.isArray(data) ? (data as DesignationRow[]) : [];
}

export async function upsertDepartment(input: UpsertDepartmentInput): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc("erp_hr_department_upsert", {
    p_id: input.id ?? null,
    p_name: input.name ?? null,
    p_code: input.code ?? null,
    p_is_active: input.is_active ?? true,
  });
  if (error) throw normalizeError(error, "Failed to save department");
  return { id: resolveUpsertId(data, input.id ?? null) };
}

export async function upsertJobTitle(input: UpsertJobTitleInput): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc("erp_hr_job_title_upsert", {
    p_id: input.id ?? null,
    p_title: input.title ?? null,
    p_level: input.level ?? null,
    p_is_active: input.is_active ?? true,
  });
  if (error) throw normalizeError(error, "Failed to save job title");
  return { id: resolveUpsertId(data, input.id ?? null) };
}

export async function upsertLocation(input: UpsertLocationInput): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc("erp_hr_location_upsert", {
    p_id: input.id ?? null,
    p_name: input.name ?? null,
    p_country: input.country ?? null,
    p_state: input.state ?? null,
    p_city: input.city ?? null,
    p_is_active: input.is_active ?? true,
  });
  if (error) throw normalizeError(error, "Failed to save location");
  return { id: resolveUpsertId(data, input.id ?? null) };
}

export async function upsertEmploymentType(
  input: UpsertEmploymentTypeInput
): Promise<{ id: string }> {
  const { data, error } = await supabase.rpc("erp_hr_employment_type_upsert", {
    p_id: input.id ?? null,
    p_key: input.key ?? null,
    p_name: input.name ?? null,
    p_is_active: input.is_active ?? true,
  });
  if (error) throw normalizeError(error, "Failed to save employment type");
  return { id: resolveUpsertId(data, input.id ?? null) };
}
