export type EmployeeModuleLink = {
  id: string;
  title: string;
  href: string;
  description: string;
};

export type EmployeeModule = {
  moduleKey: string;
  title: string;
  links: EmployeeModuleLink[];
};

export type EmployeeModulesContext = {
  permissions: { permKey: string; moduleKey: string }[];
  modules: EmployeeModule[];
};

export async function fetchEmployeeModules(): Promise<EmployeeModulesContext | null> {
  const res = await fetch("/api/hr/employee/modules");
  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as {
    ok: boolean;
    permissions?: { perm_key: string; module_key: string }[];
    modules?: { module_key: string; title: string; links: EmployeeModuleLink[] }[];
  };

  if (!data.ok) return null;

  return {
    permissions:
      data.permissions?.map((permission) => ({
        permKey: permission.perm_key,
        moduleKey: permission.module_key,
      })) ?? [],
    modules:
      data.modules?.map((moduleItem) => ({
        moduleKey: moduleItem.module_key,
        title: moduleItem.title,
        links: moduleItem.links ?? [],
      })) ?? [],
  };
}
