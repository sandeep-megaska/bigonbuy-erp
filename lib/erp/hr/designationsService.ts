import type { SupabaseClient } from "@supabase/supabase-js";

export type DesignationRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
};

type ListResult =
  | { rows: DesignationRow[]; error: null }
  | { rows: null; error: { message: string; details?: string | null; hint?: string | null; code?: string } };

export async function listDesignations(
  userClient: SupabaseClient,
  includeInactive: boolean
): Promise<ListResult> {
  const { data, error } = await userClient.rpc("erp_hr_designations_list", {
    p_include_inactive: includeInactive,
  });

  if (error) {
    return { rows: null, error };
  }

  return { rows: Array.isArray(data) ? (data as DesignationRow[]) : [], error: null };
}
