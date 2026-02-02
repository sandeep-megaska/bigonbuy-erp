export type EmployeeModuleKey = "self-service" | "inventory" | "finance";

export type EmployeeNavItem = {
  id: string;
  label: string;
  href: string;
  description: string;
  moduleKey: EmployeeModuleKey;
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

export function getEmployeeNavForModules(moduleKeys: string[]): EmployeeNavItem[] {
  const allowed = new Set(
    moduleKeys
      .map((moduleKey) => moduleKey.toLowerCase().trim())
      .filter((moduleKey) => moduleKey.length > 0)
  );

  return EMPLOYEE_NAV_ITEMS.filter((item) => allowed.has(item.moduleKey));
}
