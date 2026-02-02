export const FIN_BYPASS_MAKER_CHECKER = process.env.NEXT_PUBLIC_FIN_BYPASS_MAKER_CHECKER === "true";

export const isOwnerOrAdmin = (roleKey?: string | null) => roleKey === "owner" || roleKey === "admin";

export const canBypassMakerChecker = (roleKey?: string | string[] | null) => {
  if (!FIN_BYPASS_MAKER_CHECKER) return false;
  if (!roleKey) return false;
  const roles = Array.isArray(roleKey) ? roleKey : [roleKey];
  return roles.some((role) => isOwnerOrAdmin(role));
};

export const isMakerCheckerBypassAllowed = canBypassMakerChecker;
