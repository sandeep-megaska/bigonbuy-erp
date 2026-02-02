export type EmployeeModuleKey = "self-service" | "inventory" | "finance";

export type EmployeeNavItem = {
  id: string;
  label: string;
  href: string;
  description: string;
  moduleKey: EmployeeModuleKey;
};

const BASE_MODULES: EmployeeModuleKey[] = ["self-service"];

const ROLE_MODULE_ACCESS: Record<string, EmployeeModuleKey[]> = {
  employee: ["self-service"],
  warehouse: ["inventory"],
  finance_view: ["finance"],
};

export const EMPLOYEE_NAV_ITEMS: EmployeeNavItem[] = [
  {
    id: "employee-profile",
    label: "My Profile",
    href: "/erp/employee/profile",
    description: "View your personal and job details.",
    moduleKey: "self-service",
  },
  {
    id: "employee-leaves",
    label: "Leave Requests",
    href: "/erp/employee/leaves",
    description: "Submit and track leave applications.",
    moduleKey: "self-service",
  },
  {
    id: "employee-attendance",
    label: "Attendance",
    href: "/erp/employee/attendance",
    description: "Review your attendance history.",
    moduleKey: "self-service",
  },
  {
    id: "employee-exit",
    label: "Exit / Resignation",
    href: "/erp/employee/exit",
    description: "Submit an exit request for HR approval.",
    moduleKey: "self-service",
  },
];

export function getEmployeeAllowedModules(roleKeys: string[]): EmployeeModuleKey[] {
  const allowed = new Set<EmployeeModuleKey>(BASE_MODULES);
  const normalized = roleKeys.map((role) => role.toLowerCase().trim()).filter(Boolean);

  if (normalized.length === 0) {
    return Array.from(allowed);
  }

  normalized.forEach((role) => {
    const modules = ROLE_MODULE_ACCESS[role];
    if (!modules) return;
    modules.forEach((moduleKey) => allowed.add(moduleKey));
  });

  return Array.from(allowed);
}

export function getEmployeeNavForRoles(roleKeys: string[]): EmployeeNavItem[] {
  const allowed = getEmployeeAllowedModules(roleKeys);
  return EMPLOYEE_NAV_ITEMS.filter((item) => allowed.includes(item.moduleKey));
}
