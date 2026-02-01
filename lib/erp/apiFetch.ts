const normalizeBasePath = (value: string): string => {
  if (!value || value === "/") {
    return "";
  }

  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading.slice(0, -1) : withLeading;
};

const ENV_BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH ?? "");

export const getBasePath = (): string => {
  if (ENV_BASE_PATH) {
    return ENV_BASE_PATH;
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

  if (!normalizedPath.startsWith("/api/")) {
    throw new Error(`apiFetch requires paths starting with /api/. Received: ${path}`);
  }

  if (!normalizedPath.startsWith("/api/finance/") && normalizedPath !== "/api/finance") {
    throw new Error(`apiFetch requires finance endpoints under /api/finance. Received: ${path}`);
  }

  if (basePath && normalizedPath.startsWith(`${basePath}/`)) {
    return normalizedPath;
  }

  return `${basePath}${normalizedPath}`;
};

const fetchJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const url = buildApiUrl(path);
  const response = await fetch(url, {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    const snippet = bodyText.trim().slice(0, 200);
    throw new Error(`API ${url} failed: ${response.status}${snippet ? ` ${snippet}` : ""}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw new Error(`Expected JSON but got ${contentType || "unknown"}`);
  }

  return (await response.json()) as T;
};

export const apiFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const url = buildApiUrl(path);
  return fetch(url, {
    credentials: "include",
    ...init,
  });
};

export const apiGet = async <T>(path: string, init: RequestInit = {}): Promise<T> =>
  fetchJson<T>(path, init);

export const apiPost = async <T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> => {
  let payload: BodyInit | undefined;
  const headers: Record<string, string> = {};

  if (body !== undefined) {
    if (body instanceof FormData || body instanceof URLSearchParams || body instanceof Blob) {
      payload = body;
    } else if (typeof body === "string") {
      payload = body;
    } else {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
  }

  return fetchJson<T>(path, {
    method: "POST",
    body: payload,
    headers: {
      ...headers,
      ...(init.headers || {}),
    },
    ...init,
  });
};
