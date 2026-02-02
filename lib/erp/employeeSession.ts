export type EmployeeSessionContext = {
  employeeId: string | null;
  companyId: string | null;
  employeeCode: string | null;
  displayName: string | null;
  roles: string[];
  permissions: string[];
};

export async function fetchEmployeeSession(): Promise<EmployeeSessionContext | null> {
  const res = await fetch("/api/erp/employee/me");
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
      roles: string[];
      permissions: string[];
    };
  };
  if (!data.ok || !data.session) return null;
  return {
    employeeId: data.session.employee_id,
    companyId: data.session.company_id,
    employeeCode: data.session.employee_code,
    displayName: data.session.display_name,
    roles: data.session.roles ?? [],
    permissions: data.session.permissions ?? [],
  };
}
