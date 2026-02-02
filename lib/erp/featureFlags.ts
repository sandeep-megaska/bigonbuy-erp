export const FIN_BYPASS_MAKER_CHECKER =
  process.env.NEXT_PUBLIC_FIN_BYPASS_MAKER_CHECKER === "true";

type RoleInput = string | string[] | null | undefined;

export const canBypassMakerChecker = (roles: RoleInput): boolean => {
  if (!FIN_BYPASS_MAKER_CHECKER) return false;
  if (!roles) return false;
  if (Array.isArray(roles)) {
    return roles.includes("owner") || roles.includes("admin");
  }
  return roles === "owner" || roles === "admin";
};
