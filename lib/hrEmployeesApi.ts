import { supabase } from "./supabaseClient";

export type HrEmployee = {
  id?: string;
  employee_code?: string | null;
  full_name?: string | null;
  email?: string | null;
  user_id?: string | null;
  role_key?: string | null;
  manager_employee_id?: string | null;
  manager_name?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type HrManager = {
  id?: string;
  full_name?: string | null;
};

export type HrEmployeeUpsertInput = {
  id?: string | null;
  full_name?: string | null;
  employee_code?: string | null;
  user_id?: string | null;
  manager_employee_id?: string | null;
  is_active?: boolean | null;
};

export async function listEmployees() {
  const { data, error } = await supabase.rpc("erp_hr_employees_list");
  return { data: (data ?? []) as HrEmployee[], error };
}

export async function listManagers() {
  const { data, error } = await supabase.rpc("erp_hr_employees_managers_list");
  return { data: (data ?? []) as HrManager[], error };
}

export async function upsertEmployee(input: HrEmployeeUpsertInput) {
  const { data, error } = await supabase.rpc("erp_hr_employee_upsert", {
    p_id: input.id ?? null,
    p_full_name: input.full_name ?? null,
    p_employee_code: input.employee_code ?? null,
    p_user_id: input.user_id ?? null,
    p_manager_employee_id: input.manager_employee_id ?? null,
    p_is_active: input.is_active ?? true,
  });
  return { data: data as string | null, error };
}

export async function assignManager(employeeId: string, managerId?: string | null) {
  const { data, error } = await supabase.rpc("erp_hr_employee_assign_manager", {
    p_employee_id: employeeId,
    p_manager_employee_id: managerId ?? null,
  });
  return { data, error };
}

export async function assignUserRole(userId: string, roleKey: string) {
  const { data, error } = await supabase.rpc("erp_hr_assign_user_role", {
    p_user_id: userId,
    p_role_key: roleKey,
  });
  return { data, error };
}

export async function linkUser(employeeId: string, userId: string) {
  const { data, error } = await supabase.rpc("erp_hr_employee_link_user", {
    p_employee_id: employeeId,
    p_user_id: userId,
  });
  return { data, error };
}
