export type EmployeeAccessContext = {
  permissionKeys: string[];
  moduleKeys: string[];
};

export async function fetchEmployeeAccess(): Promise<EmployeeAccessContext | null> {
  const res = await fetch("/api/erp/employee/access");
  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    ok: boolean;
    permission_keys?: string[];
    module_keys?: string[];
  };

  if (!data.ok) return null;

  return {
    permissionKeys: data.permission_keys ?? [],
    moduleKeys: data.module_keys ?? [],
  };
}
