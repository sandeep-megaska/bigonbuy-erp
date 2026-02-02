const extractMessage = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof (error as { message?: string }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
};

export const humanizeApiError = (error: unknown): string => {
  const message = extractMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes("period is locked") || normalized.includes("period locked")) {
    return "This period is locked. Request unlock approval or choose an open date.";
  }
  if (normalized.includes("approval required") || normalized.includes("requires approval")) {
    return "This action requires approval. Submit for approval first.";
  }
  if (normalized.includes("not authenticated") || normalized.includes("missing authorization")) {
    return "Please log in again.";
  }
  if (normalized.includes("not authorized") || normalized.includes("permission denied")) {
    return "You don’t have permission for this action.";
  }

  return message;
};
