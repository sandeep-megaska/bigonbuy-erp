export type EmployeeSessionContext = {
  employeeId: string | null;
  companyId: string | null;
  employeeCode: string | null;
  displayName: string | null;
  mustResetPassword: boolean;
  roleKeys: string[];
};

export async function fetchEmployeeSession(): Promise<EmployeeSessionContext | null> {
  const res = await fetch("/api/erp/employee/auth/me");
  if (!res.ok) {
    return null;
  }
  const data = (await res.json()) as {
    ok: boolean;
    session?: {
      employee_id: string;
      company_id: string;
      employee_code: string;
      display_name: string;
      must_reset_password: boolean;
      role_keys: string[];
    };
  };
  if (!data.ok || !data.session) return null;
  return {
    employeeId: data.session.employee_id,
    companyId: data.session.company_id,
    employeeCode: data.session.employee_code,
    displayName: data.session.display_name,
    mustResetPassword: data.session.must_reset_password ?? false,
    roleKeys: data.session.role_keys ?? [],
  };
}
