export type HumanizedErrorKind =
  | "period_locked"
  | "approval_required"
  | "permission_denied"
  | "not_authenticated"
  | "not_found_html"
  | "unknown";

export type HumanizedError = {
  kind: HumanizedErrorKind;
  message: string;
  rawMessage: string;
};

const DEFAULT_ERROR_MESSAGE = "Something went wrong. Please try again.";

export const humanizeApiError = (error: unknown): HumanizedError => {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === "string" ? error : DEFAULT_ERROR_MESSAGE;
  const message = rawMessage || DEFAULT_ERROR_MESSAGE;
  const normalized = message.toLowerCase();

  if (normalized.includes("period") && normalized.includes("lock")) {
    return {
      kind: "period_locked",
      message: "This period is locked. Request an unlock to continue.",
      rawMessage,
    };
  }

  if (normalized.includes("approval") && normalized.includes("require")) {
    return {
      kind: "approval_required",
      message: "Approval is required before this action can continue.",
      rawMessage,
    };
  }

  if (normalized.includes("permission denied") || normalized.includes("not authorized")) {
    return {
      kind: "permission_denied",
      message: "You don’t have permission to perform this action.",
      rawMessage,
    };
  }

  if (
    normalized.includes("not authenticated") ||
    normalized.includes("missing authorization") ||
    normalized.includes("unauthorized")
  ) {
    return {
      kind: "not_authenticated",
      message: "Your session has expired. Please sign in again.",
      rawMessage,
    };
  }

  if (
    normalized.includes("expected json") ||
    normalized.includes("text/html") ||
    normalized.includes("api /api") ||
    normalized.includes("failed: 404")
  ) {
    return {
      kind: "not_found_html",
      message: "We couldn’t reach the server. Please refresh and try again.",
      rawMessage,
    };
  }

  return { kind: "unknown", message, rawMessage };
};
