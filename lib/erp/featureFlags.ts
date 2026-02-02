export const FIN_BYPASS_MAKER_CHECKER = process.env.NEXT_PUBLIC_FIN_BYPASS_MAKER_CHECKER === "true";

export const isOwnerOrAdmin = (roleKey?: string | null) => roleKey === "owner" || roleKey === "admin";

export const isMakerCheckerBypassAllowed = (roleKey?: string | null) =>
  isOwnerOrAdmin(roleKey) &&
  (process.env.NODE_ENV === "development" || FIN_BYPASS_MAKER_CHECKER);
