const normalizeBasePath = (value: string): string => {
  if (!value || value === "/") {
    return "";
  }

  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
};

export const ERP_BASE_PATH = normalizeBasePath(
  process.env.NEXT_PUBLIC_ERP_BASE_PATH ?? process.env.NEXT_PUBLIC_BASE_PATH ?? ""
);

export const getBasePath = (): string => {
  if (ERP_BASE_PATH) {
    return ERP_BASE_PATH;
  }

  if (typeof window !== "undefined") {
    const { pathname } = window.location;
    if (pathname.startsWith("/erp")) {
      return "/erp";
    }
  }

  return "";
};

export const buildApiUrl = (path: string): string => {
  if (!path) {
    throw new Error("apiFetch requires a URL path");
  }

  if (/^https?:\/\//i.test(path)) {
    throw new Error(`apiFetch must use a relative URL. Received: ${path}`);
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = getBasePath();

  if (basePath && normalizedPath.startsWith(`${basePath}/`)) {
    return normalizedPath;
  }

  return `${basePath}${normalizedPath}`;
};

export const apiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const url = buildApiUrl(path);
  const response = await fetch(url, {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const snippet = bodyText.trim().slice(0, 200);
    throw new Error(
      `Request failed (${response.status} ${response.statusText})${snippet ? `: ${snippet}` : ""}`
    );
  }

  return response;
};
